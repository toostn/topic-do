import * as mqtt from 'mqtt';
import { matchTopic, cache } from './util.js';

export const broker = (url, mqttOptions, _options = {parseJson: true}) => {
  let _pendingSubscriptions = _options.cacheTopics || [];
  let _pendingScheduling = [];
  let _callbacks = {};

  const _cache = _options.cache || cache();
  const _client = mqtt.connect(url, {manualConnect: true, ...mqttOptions});

  _client.on('connect', () => {
    _log('Connected to broker');
    _tick();
  });

  _client.on('message', (topic, message) => {
    _log(`Got topic: ${topic} with message: ${message}`);

    const parsedMessage = _parseMessageIfNeeded(message);

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

  const _parseMessageIfNeeded = (message) => {
    try {
      return (_options.parseJson === true)
        ? JSON.parse(message)
        : message;
    } catch (e) {
      return message;
    }
  };

  const _callbackAndPublish = (callback, ...args) => {
    return Promise
      .resolve(callback(...args))
      .then((messages) => {
        publish(messages);
      });
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
    topicDo: function (topics, callback) {
      if (Array.isArray(topics) === false) {
        topics = [topics];
      }

      for (let topic of topics) {
        if (Array.isArray(_callbacks[topic])) {
          _callbacks[topic].push(callback);
        } else {
          _callbacks[topic] = [callback];
          _pendingSubscriptions.push(topic);
        }
      }

      _tick();

      return this;
    },

    scheduleDo: function (timeoutFunc, callback) {
      _pendingScheduling.push([timeoutFunc, callback]);
      _tick();
      return this;
    },

    use: function (config) {
      if (Array.isArray(config?.topicDo)) {
        config.topicDo.forEach(([t, c]) => this.topicDo(t, c));
      }

      if (Array.isArray(config?.scheduleDo)) {
        config.scheduleDo.forEach(([t, c]) => this.scheduleDo(t, c));
      }

      return this;
    }
  }
};
