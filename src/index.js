import * as mqtt from 'mqtt';
import { matchTopic } from './util.js';

class Cache {
  constructor() {
    this._items = {};
  }

  set(key, value) {
    this._items[key] = value;
  }

  get(key) {
    return this._items[key];
  }
}

class Broker {
  constructor(url, mqttOptions, options = {parseJson: true}) {
    this.client = mqtt.connect(
      url,
      {manualConnect: true, ...mqttOptions}
    );
    this.client.on('connect', () => {  this._onConnected() });
    this.client.on('message', (t, m) => { this._onMessage(t, m) });

    this.cache = new Cache();

    this._options = options;
    this._tickTimeout = null;
    this._pendingSubscriptions = [];
    this._pendingScheduling = [];
    this._callbacks = {};
  }

  topicDo(topics, callback) {
    if (Array.isArray(topics) === false) {
      topics = [topics];
    }

    for (let topic of topics) {
      if (Array.isArray(this._callbacks[topic])) {
        this._callbacks[topic].push(callback);
      } else {
        this._callbacks[topic] = [callback];
        this._pendingSubscriptions.push(topic);
      }
    }

    this._tick();

    return this;
  }

  scheduleDo(timeoutFunc, callback) {
    this._pendingScheduling.push([timeoutFunc, callback]);

    this._tick();

    return this;
  }

  _tick() {
    this._tickTimeout = this._tickTimeout || setTimeout(() => {
      if (this.client.connected === false) {
        this.client.connect();
      } else {
        this._processPendingSubscriptions();
        this._processScheduling();
      }

      this._tickTimeout = null;
    });
  }

  _onConnected() {
    this._log(`Connected to broker`);

    if (this._options.cacheAll === true) {
      this.client.subscribe('#');
    } else {
      this._processPendingSubscriptions();
    }

    this._processScheduling();
  }

  _onMessage(topic, message) {
    this._log(`Got topic: ${topic} with message: ${message}`);

    const parsedMessage = this._parseMessageIfNeeded(message);

    this.cache.set(topic, parsedMessage);

    for (let t in this._callbacks) {
      if (matchTopic(t, topic) === false) {
        continue;
      }

      for (let callback of this._callbacks[t]) {
        this._processCallbackAndPublish(
          callback,
          topic,
          parsedMessage,
          this.cache,
          this.client
        );
      }
    }
  }

  _processPendingSubscriptions() {
    for (let t of this._pendingSubscriptions) {
      this._log(`Subscribing to topic ${t}`);
      this.client.subscribe(t);
    }

    this._pendingSubscriptions = [];
  }

  _processScheduling() {
    for (let [timeoutFunc, callback] of this._pendingScheduling) {
      const timeout = timeoutFunc();

      if (timeout < 0) continue;

      setTimeout(() => {
        this._processCallbackAndPublish(callback, this.cache, this.client);
        this.scheduleDo(timeoutFunc, callback);
      }, timeout);
    }

    this._pendingScheduling = [];
  }

  _parseMessageIfNeeded(message) {
    try {
      return (this._options.parseJson === true)
        ? JSON.parse(message)
        : message;
    } catch (e) {
      return message;
    }
  }

  _processCallbackAndPublish(callback, ...args) {
    let messages = callback(...args);

    if (Array.isArray(messages)) {
      if (Array.isArray(messages[0]) === false) {
        messages = [messages];
      }

      for (let message of messages) {
        this.client.publish(
          message[0],
          (typeof message[1] === "object")
          ? JSON.stringify(message[1])
          : message[1]
        );
      }
    }
  }


  _log() {
    if (this._options.debug === true) {
      console.debug('DEBUG: ', ...arguments);
    }
  }
}

export const broker = (url, mqttOptions, options) => {
  return new Broker(url, mqttOptions, options);
}
