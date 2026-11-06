# Changelog

## Unreleased

### Features

- Add bounded, idempotent `broker.close({ timeoutMs = 5000 })`: stop dispatch and
  scheduling, suppress late publications, run rule/handler close hooks, drain
  returned work and end MQTT. Failed cleanup/deadline expiry rejects and force-ends
  MQTT. No signal handlers or process exit are installed by the library.
- Add `.close()` to timer-helper functions so shutdown can cancel pending callbacks
  and wait for returned asynchronous callback work.

### Fixes

- Do not log expected `AbortError` handler rejections as rule failures during
  shutdown. Other errors and cancellation outside shutdown are still reported.
- Report synchronous `singleTimer()` callback errors and rejected returned
  promises/thenables to `console.error`, without interrupting other timers or
  preventing subsequent triggers. Callback return values are not auto-published.
- Return `triggerTimer()`'s delayed publication result to that error boundary so
  throwing and rejecting publishers are both observed. Debouncing and delay
  validation are unchanged; failures are not automatically retried.

## 1.0.0

The first stable rule-object API, consolidating the former `feature/new-syntax`
branch onto `main`. See the README for migration from 0.x.

### Breaking changes

- Replace `.topicDo(topics, handler)` with `.add({ topic: topics, do: handler })`.
- Replace `.scheduleDo(schedule, handler)` with `.add({ schedule, do: handler })`.
- Replace `.use({ topicDo: [...], scheduleDo: [...] })` with `.add([...rules])`.
  Arrays may mix topic and schedule rules; `.add()` remains chainable.
- Change `daily(hour, minute, second)` to `daily(scheduler, days = DAYS.all)`.
  Use `daily(at(hour, minute, second))` for a fixed local time.
- Rename `parseJson` to `parsePayload`, with no compatibility alias. Parsing defaults
  to enabled even with partial options: valid JSON becomes a JavaScript value,
  other valid UTF-8 becomes text, and invalid UTF-8 remains the original Buffer.
  Set `parsePayload: false` to preserve all incoming Buffers.
- Target Node 26 LTS only, starting at 26.13.0 (`engines.node: ^26.13.0`).
- Reject unsafe timer delays and unsupported outgoing payloads instead of allowing
  timer clamping or passing invalid values to mqtt.js.

### Features and fixes

- Add `at()` and `DAYS.weekdays`, `DAYS.weekends`, and `DAYS.all`; allow custom daily
  schedulers and correct next-eligible-day selection. Remove unconditional logging.
- Report synchronous handler errors, rejected promises, and handler-returned
  publication errors to `console.error` without interrupting other rules.
- Make `combine()` ignore negative stop values and return `-1` when no active
  children remain. Its use with `once()` is unsupported and documented.
- Correct MQTT matching for empty levels, system topics, shared subscriptions,
  and malformed wildcard filters.
- Safely support special cache/topic keys and avoid mutating caller-owned
  `cacheTopics` arrays.
- Validate scheduler/helper delays against Node's finite timeout range. Invalid or
  throwing schedulers are reported and disabled without interrupting other rules.
- Preserve published Buffers and Uint8Array view bytes. JSON-encode supported scalar
  and object values; reject unsupported or non-serializable payloads.

### Documentation, testing, and packaging

- Correct public examples to use named `broker`, `once`, mqtt.js `username`, and
  publishing callbacks. Document API behavior, limitations, utilities, and migration.
- Add `AGENTS.md` for repository and release guidance; remove the superseded review.
- Add Node's built-in unit tests and coverage with mocked MQTT clients/controlled
  timers, including DST boundaries and synchronous/async error cases.
- Add a separate Mosquitto-backed integration test for broker restart, subscription
  recovery, offline rule registration, binary/scalar round-trips, and duplicate checks.
- Add `.nvmrc`, repository metadata, and an npm package file allowlist. Existing
  helper deep imports remain available; no restrictive `exports` map is introduced.

### Security

- Refresh transitive lockfile dependencies: `brace-expansion` 2.0.1 → 2.1.7,
  `minimatch` 5.1.6 → 5.1.9, and `ws` 8.14.2 → 8.22.1. The direct dependency
  remains `mqtt@5.2.1`, declared as `^5.1.4`; no forced upgrades or overrides.

## 0.4.2

Previous baseline before the rule-object API and daily-scheduler changes.
