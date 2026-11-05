import * as mqtt from 'mqtt';
import { matchTopic, cache } from './util.js';

export const broker = (url, mqttOptions, options = {}) => {
  const _options = {parsePayload: true, ...options};
  const _decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  let _pendingSubscriptions = [...(_options.cacheTopics || [])];
  let _pendingScheduling = [];
  const _callbacks = Object.create(null);

  const _cache = _options.cache || cache();
  const _client = mqtt.connect(url, {manualConnect: true, ...mqttOptions});

  _client.on('connect', () => {
    _log('Connected to broker');
    _tick();
  });

  _client.on('message', (topic, message) => {
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
  });

  let _tickTimeout = null;

  const _tick = () => {
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
          const timeout = timeoutFunc();

          if (timeout < 0) continue;

          setTimeout(() => {
            _callbackAndPublish(callback, _cache, publish);
            _pendingScheduling.push([timeoutFunc, callback]);
            _tick();
          }, timeout);
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
    console.error('topic-do: rule execution failed', error);
  };

  const _callbackAndPublish = (callback, ...args) => {
    try {
      return Promise.resolve(callback(...args))
        .then(publish)
        .catch(_reportRuleError);
    } catch (error) {
      _reportRuleError(error);
      return Promise.resolve();
    }
  };

  const publish = (messages) => {
    if (Array.isArray(messages) === false || messages.length === 0) {
      return;
    }

    if (Array.isArray(messages[0]) === false) {
      messages = [messages];
    }

    for (let [topic, message] of messages) {
      const stringMessage =  (typeof message === "object")
        ? JSON.stringify(message)
        : message;

      _log(`Publishing message: ${stringMessage} to topic: ${topic}`);

      _client.publish(topic, stringMessage);
    }
  };

  const _log = (...messages) => {
    if (_options.debug === true) {
      console.debug(...messages);
    }
  };

  return {
    add: function (rule) {
      if (Array.isArray(rule) === true) {
        for (let r of rule) {
          this.add(r);
        }

        return this;
      }

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
