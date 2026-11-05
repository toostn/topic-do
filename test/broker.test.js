import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { beforeEach, mock, test } from 'node:test';
import { once } from '../src/schedules.js';

// Mock before importing the entry point. No real MQTT client can be constructed.
let connect;
mock.module('mqtt', { namedExports: { connect: (...args) => connect(...args) } });
const { broker } = await import('../src/index.js');

let client;
beforeEach(t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  client = new EventEmitter();
  client.connected = false;
  client.connect = t.mock.fn();
  client.subscribe = t.mock.fn();
  client.publish = t.mock.fn();
  connect = t.mock.fn(() => client);
});

const calls = fn => fn.mock.calls.map(call => call.arguments);
const receive = (topic, payload) => client.emit('message', topic, Buffer.from(payload));

function connected(t, app) {
  t.mock.timers.tick(1);
  assert.equal(client.connect.mock.callCount(), 1);
  client.connected = true;
  client.emit('connect');
  t.mock.timers.tick(1);
  return app;
}

test('forwards MQTT options, requests manual connection, and waits for add()', () => {
  const app = broker('mqtt://test.invalid', { username: 'test', reconnectPeriod: 123 });
  assert.deepEqual(calls(connect), [[
    'mqtt://test.invalid', { manualConnect: true, username: 'test', reconnectPeriod: 123 }
  ]]);
  assert.equal(typeof app.add, 'function');
  assert.equal(client.connect.mock.callCount(), 0);
});

test('add is chainable, accepts mixed arrays, and subscribes once per filter', t => {
  const app = broker('mqtt://test.invalid', {}, { cacheTopics: ['cached'], parsePayload: true });
  assert.equal(app.add([
    { topic: ['sensor/a', 'sensor/b'], do: () => {} },
    { topic: 'sensor/a', do: () => {} },
    { schedule: () => -1, do: () => {} }
  ]), app);
  connected(t, app);
  assert.deepEqual(calls(client.subscribe), [['cached'], ['sensor/a'], ['sensor/b']]);
  app.add({ topic: 'sensor/c', do: () => {} });
  t.mock.timers.tick(1);
  assert.deepEqual(calls(client.subscribe).at(-1), ['sensor/c']);
});

test('dispatches exact and wildcard rules, updates cache first, and passes publish', async t => {
  const events = [];
  const app = broker('mqtt://test.invalid').add([
    { topic: 'sensor/a', do: (...args) => { events.push(args); } },
    { topic: 'sensor/+', do: (...args) => { events.push(args); } },
    { topic: 'other', do: () => assert.fail('unrelated rule fired') }
  ]);
  connected(t, app);
  receive('sensor/a', '{"temperature":21}');
  assert.equal(events.length, 2);
  for (const [topic, message, cache, publish] of events) {
    assert.equal(topic, 'sensor/a');
    assert.deepEqual(message, { temperature: 21 });
    assert.equal(cache.get(topic), message);
    assert.equal(typeof publish, 'function');
  }
  events[0][3](['output', { state: 'ON' }]);
  await setImmediate();
  assert.deepEqual(calls(client.publish), [['output', '{"state":"ON"}']]);
});

test('uses an injected cache, including messages subscribed only for caching', t => {
  const items = new Map();
  const cache = { get: key => items.get(key), set: t.mock.fn((key, value) => items.set(key, value)) };
  const handler = t.mock.fn();
  const app = broker('mqtt://test.invalid', {}, { cache, cacheTopics: ['cached'], parsePayload: true })
    .add({ topic: 'sensor', do: handler });
  connected(t, app);
  receive('cached', '{"state":"ON"}');
  receive('sensor', '42');
  assert.deepEqual(cache.get('cached'), { state: 'ON' });
  assert.equal(cache.get('sensor'), 42);
  assert.equal(handler.mock.calls[0].arguments[2], cache);
  assert.equal(cache.set.mock.callCount(), 2);
});

for (const [name, options, payload, expected] of [
  ['plain text becomes a UTF-8 string', undefined, 'ON', 'ON'],
  ['malformed JSON remains text', undefined, '{broken', '{broken'],
  ['Unicode text is preserved', undefined, 'Küche 🌡️', 'Küche 🌡️'],
  ['empty payload becomes an empty string', undefined, '', ''],
  ['invalid UTF-8 remains a Buffer', undefined, Buffer.from([0xff]), Buffer.from([0xff])],
  ['truncated UTF-8 remains a Buffer', undefined, Buffer.from([0xe2, 0x82]), Buffer.from([0xe2, 0x82])],
  ['invalid UTF-8 inside JSON remains a Buffer', undefined, Buffer.from([0x22, 0xff, 0x22]), Buffer.from([0x22, 0xff, 0x22])],
  ['payload parsing can be disabled for JSON', { parsePayload: false }, '{"a":1}', Buffer.from('{"a":1}')],
  ['payload parsing can be disabled for text', { parsePayload: false }, 'ON', Buffer.from('ON')],
  ['valid JSON scalars are parsed', undefined, 'false', false],
  ['explicit payload parsing parses JSON', { parsePayload: true }, '{"a":1}', { a: 1 }]
]) {
  test(name, t => {
    const handler = t.mock.fn();
    const app = broker('mqtt://test.invalid', {}, options).add({ topic: 'input', do: handler });
    connected(t, app);
    const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    client.emit('message', 'input', raw);
    const [, message, cache] = handler.mock.calls[0].arguments;
    assert.deepEqual(message, expected);
    assert.deepEqual(cache.get('input'), expected);
    if (Buffer.isBuffer(expected)) {
      assert.equal(message, raw, 'raw fallback must preserve the original Buffer');
    }
  });
}

for (const [name, result, expected] of [
  ['single pair', ['output', { state: 'ON' }], [['output', '{"state":"ON"}']]],
  ['multiple pairs', [['a', 'one'], ['b', { value: 2 }]], [['a', 'one'], ['b', '{"value":2}']]],
  ['undefined', undefined, []],
  ['null', null, []],
  ['empty array', [], []]
]) {
  test(`publishes handler result: ${name}`, async t => {
    const app = broker('mqtt://test.invalid').add({ topic: 'input', do: () => result });
    connected(t, app);
    receive('input', '{}');
    await setImmediate();
    assert.deepEqual(calls(client.publish), expected);
  });
}

test('publishes only after an async handler resolves', async t => {
  let resolve;
  const result = new Promise(done => { resolve = done; });
  const app = broker('mqtt://test.invalid').add({ topic: 'input', do: () => result });
  connected(t, app);
  receive('input', '{}');
  assert.equal(client.publish.mock.callCount(), 0);
  resolve([['output/a', 'ok'], ['output/b', { ok: true }]]);
  await setImmediate();
  assert.deepEqual(calls(client.publish), [['output/a', 'ok'], ['output/b', '{"ok":true}']]);
});

test('schedules wait for connection, receive cache/publish, and can stop', async t => {
  const handler = t.mock.fn(() => ['output', 'scheduled']);
  const app = broker('mqtt://test.invalid').add({ schedule: once(100), do: handler });
  t.mock.timers.tick(500);
  assert.equal(handler.mock.callCount(), 0);
  client.connected = true;
  client.emit('connect');
  t.mock.timers.tick(1);
  t.mock.timers.tick(99);
  assert.equal(handler.mock.callCount(), 0);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(handler.mock.callCount(), 1);
  const [cache, publish] = handler.mock.calls[0].arguments;
  assert.equal(typeof cache.get, 'function');
  assert.equal(typeof publish, 'function');
  assert.deepEqual(calls(client.publish), [['output', 'scheduled']]);
  t.mock.timers.tick(1000);
  assert.equal(handler.mock.callCount(), 1);
  assert.equal(typeof app.add, 'function');
});

test('recurring schedules re-evaluate their delay and stop on a negative result', t => {
  const delays = [100, 200, -1];
  const schedule = t.mock.fn(() => delays.shift());
  const handler = t.mock.fn();
  connected(t, broker('mqtt://test.invalid').add({ schedule, do: handler }));
  t.mock.timers.tick(100);
  assert.equal(handler.mock.callCount(), 1);
  // Flush any immediate scheduling tick, then advance to just before the next job.
  t.mock.timers.tick(0);
  t.mock.timers.tick(199);
  assert.equal(handler.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(handler.mock.callCount(), 2);
  t.mock.timers.tick(1000);
  assert.equal(handler.mock.callCount(), 2);
  assert.equal(schedule.mock.callCount(), 3);
});

test('repeated connect events do not duplicate already-installed schedules', t => {
  const handler = t.mock.fn();
  connected(t, broker('mqtt://test.invalid').add({ schedule: once(100), do: handler }));
  client.emit('connect');
  client.emit('connect');
  t.mock.timers.tick(100);
  assert.equal(handler.mock.callCount(), 1);
});

test('partial options preserve default JSON parsing', t => {
  const handler = t.mock.fn();
  connected(t, broker('mqtt://test.invalid', {}, { debug: false }).add({ topic: 'input', do: handler }));
  receive('input', '{"value":1}');
  assert.equal(handler.mock.callCount(), 1);
  const [, message, cache] = handler.mock.calls[0].arguments;
  assert.deepEqual(message, { value: 1 });
  assert.deepEqual(cache.get('input'), { value: 1 });
});

test('adding rules does not mutate cacheTopics', t => {
  const cacheTopics = ['cached'];
  const app = broker('mqtt://test.invalid', {}, { cacheTopics })
    .add({ topic: 'input', do: () => {} });
  assert.deepEqual(cacheTopics, ['cached']);
  connected(t, app);
  assert.deepEqual(calls(client.subscribe), [['cached'], ['input']]);
});

test('a synchronous handler failure is reported without preventing other rules from running', async t => {
  const error = new Error('test failure');
  const report = t.mock.method(console, 'error', () => {});
  const handler = t.mock.fn(() => ['output', 'still running']);
  connected(t, broker('mqtt://test.invalid').add([
    { topic: 'input', do: () => { throw error; } },
    { topic: 'input', do: handler }
  ]));
  assert.doesNotThrow(() => receive('input', '{}'));
  assert.equal(handler.mock.callCount(), 1);
  await setImmediate();
  assert.deepEqual(calls(report), [['topic-do: rule execution failed', error]]);
  assert.deepEqual(calls(client.publish), [['output', 'still running']]);
});

for (const trigger of ['topic', 'schedule']) {
  test(`rejected async ${trigger} handlers are reported and later executions continue`, async t => {
    const error = new Error('async test failure');
    const report = t.mock.method(console, 'error', () => {});
    const failing = t.mock.fn(async () => { throw error; });
    const healthy = t.mock.fn(() => ['output', 'still running']);
    const app = broker('mqtt://test.invalid').add(trigger === 'topic'
      ? [{ topic: 'input', do: failing }, { topic: 'input', do: healthy }]
      : [{ schedule: () => 100, do: failing }, { schedule: () => 100, do: healthy }]);
    connected(t, app);

    for (let run = 1; run <= 2; run++) {
      if (trigger === 'topic') {
        receive('input', '{}');
      } else {
        t.mock.timers.tick(100);
      }
      // Let promise callbacks and Node's unhandled-rejection checks run. The test
      // runner itself fails on unhandled rejections; do not install a listener.
      await setImmediate();
      assert.equal(failing.mock.callCount(), run);
      assert.equal(healthy.mock.callCount(), run);
      assert.equal(report.mock.callCount(), run);
      assert.equal(client.publish.mock.callCount(), run);
    }
    assert.deepEqual(calls(report), [
      ['topic-do: rule execution failed', error],
      ['topic-do: rule execution failed', error]
    ]);
    assert.deepEqual(calls(client.publish), [['output', 'still running'], ['output', 'still running']]);
  });
}

test('special topic names are subscribed, dispatched, and cached safely', t => {
  const topics = ['__proto__', 'constructor', 'toString'];
  const handler = t.mock.fn();
  connected(t, broker('mqtt://test.invalid').add({ topic: topics, do: handler }));
  assert.deepEqual(calls(client.subscribe), topics.map(topic => [topic]));
  for (const topic of topics) {
    receive(topic, '{"value":1}');
  }
  assert.equal(handler.mock.callCount(), topics.length);
  for (const [index, [topic, payload, cache]] of calls(handler).entries()) {
    assert.equal(topic, topics[index]);
    assert.deepEqual(payload, { value: 1 });
    assert.deepEqual(cache.get(topic), payload);
  }
});
