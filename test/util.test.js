import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { cache, matchTopic, singleTimer, triggerTimer } from '../src/util.js';

for (const [filter, topic, expected] of [
  ['home/light', 'home/light', true],
  ['home/light', 'home/lights', false],
  ['home/light', 'other/home/light', false],
  ['home/+', 'home/light', true],
  ['home/+', 'home/room/light', false],
  ['home/+/state', 'home/light/state', true],
  ['home/#', 'home', true],
  ['home/#', 'home/room/light', true],
  ['home/#', 'house/light', false],
  ['#', 'home/light', true],
  ['$SYS/#', '$SYS/status', true],
  ['$share/workers/home/+', 'home/light', true],
  ['home/a.b', 'home/axb', false],
  ['home/[a](b)?^$*|', 'home/[a](b)?^$*|', true]
]) {
  test(`matchTopic(${JSON.stringify(filter)}, ${JSON.stringify(topic)}) = ${expected}`, () => {
    assert.equal(matchTopic(filter, topic), expected);
  });
}

test('cache stores the latest value, retains references, and isolates instances', () => {
  const first = cache();
  const second = cache();
  assert.equal(first.get('missing'), undefined);
  const message = { state: 'ON' };
  first.set('light', message);
  assert.equal(first.get('light'), message);
  assert.equal(second.get('light'), undefined);
  first.set('light', null);
  assert.equal(first.get('light'), null);
  first.set('light', false);
  assert.equal(first.get('light'), false);
});

for (const delay of [NaN, Infinity, -Infinity, -1, undefined, null, '100', 2147483648]) {
  test(`timer helpers reject invalid delay ${String(delay)}`, () => {
    assert.throws(() => singleTimer(delay), { name: typeof delay !== 'number' || !Number.isFinite(delay) ? 'TypeError' : 'RangeError' });
    assert.throws(() => triggerTimer(null, ['light'], 'on', 'off', delay));
  });
}

test('singleTimer accepts zero and the maximum Node timeout', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const immediate = t.mock.fn();
  singleTimer(0)(immediate);
  t.mock.timers.tick(1);
  assert.equal(immediate.mock.callCount(), 1);
  const delayed = t.mock.fn();
  singleTimer(2147483647)(delayed);
  t.mock.timers.tick(2147483646);
  assert.equal(delayed.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(delayed.mock.callCount(), 1);
});

test('singleTimer debounces to the most recent callback and can be reused', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timer = singleTimer(100);
  const first = t.mock.fn();
  const latest = t.mock.fn();
  timer(first);
  t.mock.timers.tick(75);
  timer(latest);
  t.mock.timers.tick(99);
  assert.equal(first.mock.callCount(), 0);
  assert.equal(latest.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(latest.mock.callCount(), 1);
  timer(first);
  t.mock.timers.tick(100);
  assert.equal(first.mock.callCount(), 1);
});

test('triggerTimer returns on messages and debounces off messages across topics', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const publish = t.mock.fn();
  const handler = triggerTimer(null, ['a', 'b'], { state: 'ON' }, { state: 'OFF' }, 100);
  const on = [['a', { state: 'ON' }], ['b', { state: 'ON' }]];
  assert.deepEqual(handler('motion', {}, cache(), publish), on);
  t.mock.timers.tick(75);
  assert.deepEqual(handler('motion', {}, cache(), publish), on);
  t.mock.timers.tick(99);
  assert.equal(publish.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.deepEqual(publish.mock.calls[0].arguments, [
    [['a', { state: 'OFF' }], ['b', { state: 'OFF' }]]
  ]);
  t.mock.timers.tick(100);
  assert.equal(publish.mock.callCount(), 1);
});

test('triggerTimer forwards filter arguments and ignores non-matching events', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const filter = t.mock.fn((topic, message) => message.active === true);
  const publish = t.mock.fn();
  const memory = cache();
  const message = { active: false };
  const handler = triggerTimer(filter, ['light'], 'on', 'off', 100);
  assert.equal(handler('motion', message, memory, publish), undefined);
  assert.deepEqual(filter.mock.calls[0].arguments, ['motion', message, memory]);
  t.mock.timers.tick(100);
  assert.equal(publish.mock.callCount(), 0);
});

test('triggerTimer can omit either on or off messages', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const publish = t.mock.fn();
  const offOnly = triggerTimer(null, ['light'], null, 'off', 100);
  assert.deepEqual(offOnly('motion', {}, cache(), publish), []);
  t.mock.timers.tick(100);
  assert.deepEqual(publish.mock.calls[0].arguments, [[['light', 'off']]]);
  const onOnly = triggerTimer(null, ['light'], 'on', null, 100);
  assert.deepEqual(onOnly('motion', {}, cache(), publish), [['light', 'on']]);
  t.mock.timers.tick(100);
  assert.equal(publish.mock.callCount(), 1);
});

for (const [name, filter, topic, expected] of [
  ['+ matches empty topic levels', 'home/+/state', 'home//state', true],
  ['# excludes system topics', '#', '$SYS/status', false],
  ['+ excludes leading system levels', '+/status', '$SYS/status', false],
  ['shared catch-all matches ordinary topics', '$share/workers/#', 'home/light', true],
  ['+ matches a trailing empty level', 'home/+', 'home/', true],
  ['+ still requires a level', 'home/+', 'home', false],
  ['# matches an empty trailing level', 'home/#', 'home/', true],
  ['+ can match an empty first level', '+/state', '/state', true],
  ['explicit system filter matches', '$SYS/+', '$SYS/status', true],
  ['system-topic exclusion applies after stripping shared prefix', '$share/workers/#', '$SYS/status', false],
  ['shared explicit system filter matches', '$share/workers/$SYS/#', '$SYS/status', true],
  ['dollar signs in non-leading levels are ordinary', 'home/+', 'home/$status', true],
  ['literal share-like topic is not a shared subscription', '$shared/status', '$shared/status', true],
  ['shared + matches empty levels', '$share/workers/home/+', 'home/', true],
  ['# must be the last level', 'home/#/state', 'home/light/state', false],
  ['+ must occupy a whole level', 'home/light+', 'home/light1', false],
  ['# must occupy a whole level', 'home/light#', 'home/light#', false],
  ['shared group cannot be empty', '$share//home/#', 'home/light', false],
  ['shared group cannot contain wildcards', '$share/+/home/#', 'home/light', false],
  ['shared filter cannot be empty', '$share/workers/', 'home/light', false]
]) {
  test(name, () => {
    assert.equal(matchTopic(filter, topic), expected);
  });
}

for (const [name, fail] of [
  ['throw', error => { throw error; }],
  ['rejected promise', error => Promise.reject(error)],
  ['rejected thenable', error => ({ then: (_, reject) => reject(error) })],
  ['throwing then getter', error => ({ get then() { throw error; } })]
]) {
  test(`singleTimer reports a callback ${name} and remains reusable`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const error = new Error('delayed callback failed');
    const report = t.mock.method(console, 'error', () => {});
    const timer = singleTimer(100);
    const otherTimer = singleTimer(100);
    const healthy = t.mock.fn();
    for (let run = 1; run <= 2; run++) {
      timer(() => fail(error));
      otherTimer(healthy);
      assert.doesNotThrow(() => t.mock.timers.tick(100));
      // Allow promise callbacks and Node's unhandled-rejection checks to run.
      await setImmediate();
      assert.equal(healthy.mock.callCount(), run);
      assert.equal(report.mock.callCount(), run);
      assert.deepEqual(report.mock.calls.at(-1).arguments, ['topic-do: timer callback failed', error]);
    }
    timer(healthy);
    t.mock.timers.tick(100);
    assert.equal(healthy.mock.callCount(), 3);
  });
}

test('singleTimer observes a resolved async callback without publishing its result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const report = t.mock.method(console, 'error', () => {});
  const callback = t.mock.fn(async () => ['light', 'off']);
  assert.equal(singleTimer(100)(callback), undefined);
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(callback.mock.callCount(), 1);
  assert.equal(report.mock.callCount(), 0);
});

for (const asynchronous of [false, true]) {
  test(`triggerTimer reports ${asynchronous ? 'rejected' : 'throwing'} delayed publishers and can run again`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const error = new Error('delayed publication failed');
    const report = t.mock.method(console, 'error', () => {});
    const publish = t.mock.fn(asynchronous
      ? async () => { throw error; }
      : () => { throw error; });
    const handler = triggerTimer(null, ['light'], 'on', 'off', 100);
    for (let run = 1; run <= 2; run++) {
      assert.deepEqual(handler('motion', {}, cache(), publish), [['light', 'on']]);
      assert.doesNotThrow(() => t.mock.timers.tick(100));
      await setImmediate();
      assert.equal(publish.mock.callCount(), run);
      assert.deepEqual(publish.mock.calls.at(-1).arguments, [[['light', 'off']]]);
      assert.equal(report.mock.callCount(), run);
      assert.deepEqual(report.mock.calls.at(-1).arguments, ['topic-do: timer callback failed', error]);
    }
  });
}

test('cancelled timer callbacks are not invoked or reported', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const report = t.mock.method(console, 'error', () => {});
  const timer = singleTimer(100);
  const failing = t.mock.fn(() => { throw new Error('cancelled callback ran'); });
  const healthy = t.mock.fn();
  timer(failing);
  t.mock.timers.tick(50);
  timer(healthy);
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(failing.mock.callCount(), 0);
  assert.equal(healthy.mock.callCount(), 1);
  assert.equal(report.mock.callCount(), 0);
});

test('singleTimer close cancels pending callbacks and prevents rearming', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timer = singleTimer(100);
  const callback = t.mock.fn();
  timer(callback);
  await timer.close();
  timer(callback);
  t.mock.timers.tick(100);
  assert.equal(callback.mock.callCount(), 0);
});

test('singleTimer close waits for an already running async callback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timer = singleTimer(100);
  let finish;
  timer(() => new Promise(resolve => { finish = resolve; }));
  t.mock.timers.tick(100);
  let closed = false;
  const closing = timer.close().then(() => { closed = true; });
  await setImmediate();
  assert.equal(closed, false);
  finish();
  await closing;
});

test('triggerTimer close cancels delayed publications and ignores new triggers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handler = triggerTimer(null, ['light'], 'on', 'off', 100);
  const publish = t.mock.fn();
  handler('motion', {}, cache(), publish);
  await handler.close();
  assert.equal(handler('motion', {}, cache(), publish), undefined);
  t.mock.timers.tick(100);
  assert.equal(publish.mock.callCount(), 0);
});

test('cache supports special keys without inherited values', () => {
  const memory = cache();
  for (const key of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
    assert.equal(memory.get(key), undefined);
    memory.set(key, { key });
    assert.deepEqual(memory.get(key), { key });
    memory.set(key, 'updated');
    assert.equal(memory.get(key), 'updated');
  }
  assert.equal(cache().get('__proto__'), undefined);
});
