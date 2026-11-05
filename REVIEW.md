# Repository review

## Baseline

Reviewed HEAD `6410dbd` (last commit: 2024-12-22), package version `0.4.2`.
The working tree was clean. This is a compact ESM library with three source files,
one direct dependency (`mqtt`), and no build tooling. The narrow scope remains a
strength: maintenance does not require a rewrite or a large automation framework.

The initial review added documentation only; it did not repair runtime behavior.
During consolidation onto `main`, the README was rewritten and `CHANGELOG.md` added.
Finding 2 below records the original defects; its documentation fixes are now applied.
The remaining runtime findings are still open. Package metadata remains at `0.4.2`.

## Findings, in suggested priority order

### 1. High: handler failures are not contained

`src/index.js:78-83` evaluates `callback(...args)` before `Promise.resolve`, so a
synchronous throw escapes MQTT event dispatch or the timer callback. Rejected async
handlers and publishing failures have no rejection handler either. With normal Node
settings these failures can terminate the automation process. A synchronous scheduled
handler failure also prevents its rescheduling (`src/index.js:54-57`).

Introduce a documented error-reporting policy that handles both synchronous and async
errors, isolates rules, and explicitly defines whether failed schedules continue.
Test that one failing rule does not prevent other rules from running.

### 2. Resolved in documentation: the original README example could not run

- README imports a default `broker`, but `src/index.js:4` exports only a named function.
- README imports `scheduleOnce`, but `src/schedules.js:12` exports `once`.
- README treats the handler's last argument as an object with `.publish`; the actual
  argument is the publishing function (`src/index.js:30,55`).
- Ping examples use `(['topic-do/ping'], {alive: true})`, a comma expression returning
  an object rather than a publishable pair.
- MQTT credentials use `user` rather than mqtt.js's `username`.
- The polling example suppresses a successful reading and publishes on error.
- The first example assumes a cached light value exists without subscribing to it or
  checking for a cache miss.

The rewritten README follows the existing runtime contract, corrects these examples,
and documents migration from the old rule and daily-scheduler APIs. No exports or
handler arguments were changed. Public-import smoke checks and mocked execution of
the quick-start example passed during consolidation; committed automated coverage
is still needed.

### 3. High maintenance priority: dependency security refresh

The installed direct dependency is `mqtt@5.2.1` (declared `^5.1.4`). `npm audit`
reports **three high-severity vulnerable transitive packages**: `brace-expansion`,
`minimatch`, and `ws`, with fixes available. Advisory severity is not proof of
exploitability through this library: inspect dependency paths and whether affected
functionality is reachable, especially server-side WebSocket advisories.

Update and validate the dependency graph/lockfile after adding basic tests. Do not
blindly force upgrades. No dependencies were changed during the review.

### 4. Medium: MQTT matching is not fully MQTT-compliant

`src/util.js:1-10` has confirmed counterexamples:

| Filter | Topic | Actual | Expected |
| --- | --- | --- | --- |
| `a/+/b` | `a//b` | false | true |
| `#` | `$SYS/status` | true | false |
| `$share/group/#` | `home/light` | false | true |

`+` can match an empty level; leading wildcards must not match `$` system topics;
shared subscriptions need their prefix stripped before applying normal matching.
Incorrect matching loses valid events or dispatches events to unintended handlers
when other subscriptions deliver them. Add a spec-based fixture table and consider
using a small established matcher rather than extending a fragile regex.

### 5. Medium: scheduler composition and delay validation

`combine()` (`src/schedules.js:2-8`) takes the minimum including negative stop
sentinels. An exhausted `once()` combined with a recurring schedule returns `-1`,
disabling the entire rule. Empty composition returns `Number.MAX_VALUE`, which is
not a valid Node timeout. Stateful schedulers are also consumed when evaluated,
even if a different member wins; define composition semantics before fixing it.

`src/index.js:49-58` validates only negative delays. `NaN`, infinity, and delays
beyond Node's maximum timeout can become rapid timers rather than the intended
wait. Async scheduled handlers can overlap because rescheduling does not await them.
Define accepted delays, stopping behavior, and async overlap policy, with fake-time
coverage for exact boundaries, weekly recurrence, midnight, and DST.

### 6. Medium: options and storage have surprising behavior

- `src/index.js:4,68-72`: the default `parseJson: true` applies only when the entire
  options argument is omitted. Passing `{debug: false}` unexpectedly disables it.
  Merge option defaults and test partial option objects.
- `src/index.js:5,130`: pending subscriptions initially alias the caller's
  `cacheTopics` array, so registering rules can mutate caller-owned configuration.
- `src/index.js:7,129` and `src/util.js:14-17`: plain objects treat keys such as
  `__proto__` specially and expose inherited cache values (e.g. `get('toString')`
  returns a function on an empty cache). Use `Map` or null-prototype dictionaries.
- All received topics are cached without expiry or a size bound. Document this or
  offer a bounded policy for wildcard-heavy or dynamic-topic installations.

### 7. Medium: no controllable lifecycle or delivery/error contract

The returned object exposes only `.add()` (`src/index.js:112-144`). There is no way
to close the MQTT client, cancel scheduled jobs, remove rules, or gracefully shut
down. Timer handles are discarded. Errors and subscription/publication acknowledgments
are not surfaced. Adding work while disconnected calls `connect()` without an
explicit connecting-state guard; test its interaction with mqtt.js auto-reconnect
before changing it. `broker()` without `.add()` does not start the manual connection.

Add a small explicit lifecycle API and track timers. Test reconnect/resubscription
behavior, no duplicate jobs, shutdown, and publish failures with a fake client and
then an isolated broker. Specify supported payload types: numbers/booleans currently
pass through to mqtt.js, while Buffers are JSON-stringified as objects. Consider
whether users need QoS/retain options before expanding the publishing API.

## Recommended implementation sequence

1. Add `node:test` coverage and a working `npm test`; use mocked MQTT and controlled
   timers, not a household broker. Capture the confirmed regressions above.
2. Fix error containment and keep public API/docs aligned. A corrected minimal example
   and migration guide were added during consolidation.
3. Refresh dependencies and re-run audit, unit tests, and isolated integration checks.
4. Correct matching, composition, option defaults, and dictionary storage.
5. Add shutdown/cancellation and settle reconnect, scheduling, and delivery semantics.
6. Declare supported Node versions, add CI, and add package metadata (`repository`,
   `engines`, a `files` allowlist; consider `exports` without accidentally blocking
   existing deep imports). Document all scheduler/util helpers and release changes.

## Checks performed

- `node --check` passed for all three source files on Node `v26.13.0`, npm `11.20.0`.
- `npm test` failed as expected: it is the placeholder script, not a test suite.
- `npm ls --depth=0` resolved `mqtt@5.2.1`.
- `npm pack --dry-run` succeeded for the original six-file package; npm warned that
  it falls back to `.gitignore` for package exclusions.
- `npm audit --json` completed with the three high-severity package findings above.
- Ad hoc checks with actual utility exports and a VM-loaded broker using a mocked
  MQTT client/timers reproduced the import/API mismatches, partial-options behavior,
  escaping synchronous handler error, matcher failures, inherited cache lookup,
  and negative-sentinel composition failure. These checks are not a committed suite.
- No real broker connection, device publication, dependency install/update, or
  end-to-end/reconnect test was performed.
