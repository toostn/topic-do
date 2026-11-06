import * as mqtt from 'mqtt';
import { matchTopic, cache } from './util.js';
import { validateDelay } from './timers.js';

export const broker = (url, mqttOptions, options = {}) => {
  const _options = {parsePayload: true, ...options};
  const _decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  let _pendingSubscriptions = [...(_options.cacheTopics || [])];
  let _pendingScheduling = [];
  const _callbacks = Object.create(null);
  const _scheduleTimers = new Set();
  const _inFlight = new Set();
  const _closeHooks = new Map();
  let _closing = false;
  let _closePromise;

  const _cache = _options.cache || cache();
  const _client = mqtt.connect(url, {manualConnect: true, ...mqttOptions});

  const _onConnect = () => {
    if (_closing) return;
    _log('Connected to broker');
    _tick();
  };
  _client.on('connect', _onConnect);

  const _onMessage = (topic, message) => {
    if (_closing) return;
    _log(`Got topic: ${topic} with message: ${message}`);

    const parsedMessage = _parsePayloadIfNeeded(message);

    _cache.set(topic, parsedMessage);

    for (let t in _callbacks) {
      if (matchTopic(t, topic) === false) {
        continue;
      }

      for (let callback of _callbacks[t]) {
        _callbackAndPublish(callback, topic, parsedMessage, _cache, publish);
      }
    }
  };
  _client.on('message', _onMessage);

  let _tickTimeout = null;

  const _tick = () => {
    if (_closing) return;
    _tickTimeout = _tickTimeout || setTimeout(() => {
      if (_client.connected === false) {
        _client.connect();
      } else {
        for (let t of _pendingSubscriptions) {
          _log(`Subscribing to topic ${t}`);
          _client.subscribe(t);
        }

        _pendingSubscriptions = [];

        for (let [timeoutFunc, callback] of _pendingScheduling) {
          let timeout;
          try {
            timeout = validateDelay(timeoutFunc(), true);
          } catch (error) {
            _reportRuleError(error);
            continue;
          }

          if (timeout < 0) continue;

          const timer = setTimeout(() => {
            _scheduleTimers.delete(timer);
            if (_closing) return;
            _callbackAndPublish(callback, _cache, publish);
            if (!_closing) {
              _pendingScheduling.push([timeoutFunc, callback]);
              _tick();
            }
          }, timeout);
          _scheduleTimers.add(timer);
        }

        _pendingScheduling = [];
      }

      _tickTimeout = null;
    });
  };

  const _parsePayloadIfNeeded = (message) => {
    if (_options.parsePayload !== true) {
      return message;
    }

    let text;
    try {
      // Decode strictly before JSON parsing so invalid bytes cannot be replaced silently.
      text = _decoder.decode(message);
    } catch {
      return message;
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const _reportRuleError = (error) => {
    if (_closing && error?.name === 'AbortError') return;
    console.error('topic-do: rule execution failed', error);
  };

  const _callbackAndPublish = (callback, ...args) => {
    if (_closing) return Promise.resolve();
    let pending;
    try {
      pending = Promise.resolve(callback(...args))
        .then(publish)
        .catch(_reportRuleError);
    } catch (error) {
      _reportRuleError(error);
      pending = Promise.resolve();
    }
    _inFlight.add(pending);
    pending.then(() => _inFlight.delete(pending));
    return pending;
  };

  const publish = (messages) => {
    if (_closing) return;
    if (Array.isArray(messages) === false || messages.length === 0) {
      return;
    }

    if (Array.isArray(messages[0]) === false) {
      messages = [messages];
    }

    for (let [topic, message] of messages) {
      let payload;
      if (Buffer.isBuffer(message) || typeof message === 'string') {
        payload = message;
      } else if (message instanceof Uint8Array) {
        payload = Buffer.from(message.buffer, message.byteOffset, message.byteLength);
      } else {
        if (typeof message === 'number' && !Number.isFinite(message)) {
          throw new TypeError('Publishing non-finite numbers is not supported');
        }
        payload = JSON.stringify(message);
        if (typeof payload !== 'string') {
          throw new TypeError('Payload must be a string, Buffer, Uint8Array, or JSON-serializable value');
        }
      }

      _log(`Publishing message: ${payload} to topic: ${topic}`);

      _client.publish(topic, payload);
    }
  };

  const _log = (...messages) => {
    if (_options.debug === true) {
      console.debug(...messages);
    }
  };

  return {
    close: function ({ timeoutMs = 5000 } = {}) {
      if (_closePromise) return _closePromise;
      validateDelay(timeoutMs);
      _closing = true;
      clearTimeout(_tickTimeout);
      _tickTimeout = null;
      for (const timer of _scheduleTimers) clearTimeout(timer);
      _scheduleTimers.clear();
      _pendingScheduling = [];
      _pendingSubscriptions = [];
      _client.off('connect', _onConnect);
      _client.off('message', _onMessage);

      let deadline;
      const expired = new Promise((resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('topic-do: shutdown timed out')), timeoutMs);
      });
      // Defer cleanup one microtask so a handler that initiated shutdown has had
      // its returned work registered in _inFlight before we snapshot it.
      const draining = Promise.resolve().then(async () => {
        const hooks = [..._closeHooks].map(([owner, hook]) => Promise.resolve().then(() => hook.call(owner)));
        const ending = new Promise((resolve, reject) => {
          _client.end(false, {}, error => error ? reject(error) : resolve());
        });
        const results = await Promise.allSettled([...hooks, ..._inFlight, ending]);
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, 'topic-do: shutdown failed');
      });
      _closePromise = Promise.race([draining, expired]).catch(error => {
        try { _client.end(true); } catch { /* Preserve the original shutdown error. */ }
        throw error;
      }).finally(() => clearTimeout(deadline));
      return _closePromise;
    },
    add: function (rule) {
      if (_closing) throw new Error('topic-do: broker is closed');
      if (Array.isArray(rule) === true) {
        for (let r of rule) {
          this.add(r);
        }

        return this;
      }

      if (typeof rule.close === 'function') _closeHooks.set(rule, rule.close);
      if (typeof rule.do?.close === 'function') _closeHooks.set(rule.do, rule.do.close);

      if ('topic' in rule && 'do' in rule) {
        const topics = Array.isArray(rule.topic) ? rule.topic : [rule.topic];

        for (let topic of topics) {
          if (Array.isArray(_callbacks[topic])) {
            _callbacks[topic].push(rule.do);
          } else {
            _callbacks[topic] = [rule.do];
            _pendingSubscriptions.push(topic);
          }
        }
      }

      if ('schedule' in rule && 'do' in rule) {
        _pendingScheduling.push([rule.schedule, rule.do]);
      }

      _tick();

      return this;
    }
  }
};
