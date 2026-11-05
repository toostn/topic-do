import assert from 'node:assert/strict';
import { test } from 'node:test';
import { at, between, combine, daily, DAYS, once } from '../src/schedules.js';

// node:test isolates files in separate processes. Fix local time for reproducible
// wall-clock and DST checks, independent of the machine running the suite.
process.env.TZ = 'America/New_York';
const time = value => new Date(value).getTime();
const hour = 60 * 60 * 1000;

test('once returns its delay exactly once; instances are independent', () => {
  const first = once(50);
  const second = once();
  assert.equal(first(), 50);
  assert.equal(first(), -1);
  assert.equal(first(), -1);
  assert.equal(second(), 0);
  assert.equal(second(), -1);
});

test('at returns positive, zero, and negative same-day offsets', () => {
  const now = time('2025-01-06T07:30:15-05:00');
  assert.equal(at(8, 30, 15)(now), hour);
  assert.equal(at(7, 30, 15)(now), 0);
  assert.equal(at(6, 30, 15)(now), -hour);
});

test('helpers default to Date.now when no timestamp is passed', t => {
  t.mock.timers.enable({ apis: ['Date'], now: time('2025-01-06T06:00:00-05:00') });
  assert.equal(at(7)(), hour);
  assert.equal(daily(at(7))(), hour);
});

for (const [name, now, days, expected] of [
  ['later today', '2025-01-06T06:00:00-05:00', DAYS.all, 1.5 * hour],
  ['exact boundary', '2025-01-06T07:30:00-05:00', DAYS.all, 0],
  ['tomorrow after target', '2025-01-06T08:00:00-05:00', DAYS.all, 23.5 * hour],
  ['Friday to Monday', '2025-01-10T08:00:00-05:00', DAYS.weekdays, 71.5 * hour],
  ['weekend to Monday', '2025-01-12T06:00:00-05:00', DAYS.weekdays, 25.5 * hour],
  ['Saturday weekend', '2025-01-11T06:00:00-05:00', DAYS.weekends, 1.5 * hour],
  ['custom Sunday only', '2025-01-12T08:00:00-05:00', [0], 167.5 * hour]
]) {
  test(`daily: ${name}`, () => {
    assert.equal(daily(at(7, 30), days)(time(now)), expected);
  });
}

test('daily defaults to every day and disables an empty day selection', () => {
  const now = time('2025-01-06T06:00:00-05:00');
  assert.equal(daily(at(7, 30))(now), 1.5 * hour);
  assert.equal(daily(at(7, 30), [])(now), -1);
});

test('daily passes candidate local midnight to a custom scheduler', () => {
  const candidates = [];
  const schedule = daily(midnight => {
    candidates.push(midnight);
    return 9 * hour;
  });
  assert.equal(schedule(time('2025-01-06T10:00:00-05:00')), 23 * hour);
  assert.deepEqual(candidates, [
    time('2025-01-06T00:00:00-05:00'), time('2025-01-07T00:00:00-05:00')
  ]);
});

for (const [name, now, expected] of [
  ['spring forward', '2025-03-08T09:00:00-05:00', 22 * hour],
  ['fall back', '2025-11-01T09:00:00-04:00', 24 * hour]
]) {
  test(`daily preserves local target across DST: ${name}`, () => {
    assert.equal(daily(at(8))(time(now)), expected);
  });
}

test('combine selects the earliest delay and forwards the timestamp', () => {
  const seen = [];
  const schedule = combine(now => { seen.push(now); return 200; }, now => { seen.push(now); return 50; });
  assert.equal(schedule(1234), 50);
  assert.deepEqual(seen, [1234, 1234]);
});

test('between calls its callback only when start() > end()', () => {
  let calls = 0;
  const callback = () => { calls++; return 'result'; };
  assert.equal(between(() => 10, () => 5, callback), 'result');
  assert.equal(between(() => 5, () => 10, callback), undefined);
  assert.equal(between(() => 5, () => 5, callback), undefined);
  assert.equal(calls, 1);
});

test('combine ignores exhausted schedulers', () => {
  const oneShot = once();
  oneShot();
  assert.equal(combine(oneShot, () => 1000)(), 1000);
});

test('empty combine disables scheduling', () => {
  assert.equal(combine()(), -1);
});

test('combine disables scheduling when all children are disabled', () => {
  assert.equal(combine(() => -1, () => -100)(), -1);
});

test('combine preserves immediate execution alongside disabled children', () => {
  assert.equal(combine(() => -1, () => 100, () => 0)(), 0);
});
