# Working on topic-do

## Purpose and scope

A small, code-first MQTT automation library, not a standalone service. Keep the
plain-JavaScript `{ topic, do }` / `{ schedule, do }` API lightweight. Avoid adding
frameworks, configuration languages, or large dependencies without a concrete need.

## Repository map

- `src/index.js`: MQTT connection, subscriptions, rule dispatch, scheduling, publishing.
- `src/schedules.js`: `combine`, `once`, `DAYS`, `daily`, `at`, `between`.
- `src/util.js`: topic matching, in-memory cache, debounce and trigger helpers.
- `README.md`: current public API, examples, and migration instructions.
- `CHANGELOG.md`: unreleased API changes; package version remains `0.4.2`.
- `package.json` / `package-lock.json`: npm metadata and dependency graph.
- `REVIEW.md`: baseline review findings and proposed maintenance priorities.

## Current API (describe reality, not presumed intent)

- Node.js ES modules (`"type": "module"`), with explicit `.js` relative imports.
- The entry point exports **named** `broker(url, mqttOptions, options)`; no default export.
- `broker()` returns an object with chainable `.add(ruleOrArray)` only.
- Topic handlers receive `(topic, message, cache, publish)`; scheduled handlers receive
  `(cache, publish)`. The last argument is a function, not a broker/client object.
- Handlers can return `[topic, payload]`, arrays of such pairs, promises of either,
  or nothing. The publisher takes the same pair/array format.
- Cache interface: synchronous `get(key)` / `set(key, value)`; injectable via `options.cache`.
- A schedule returns milliseconds until execution; negative values disable it.
  It is evaluated again after the timer fires, without awaiting async handler completion.
- `at()` returns a same-day offset (possibly negative); use `daily(at(...))` for recurrence.
- Schedules use local dates/time. The exported one-shot helper is `once`, not `scheduleOnce`.
- MQTT options are forwarded to mqtt.js. Parsing behavior, error handling, timer
  composition, and lifecycle have known issues; see `REVIEW.md` before relying on them.

## Commands and validation

```sh
npm ci                          # Reproduce the lockfile; replaces node_modules
npm test                        # Currently a placeholder that deliberately fails
for file in src/*.js; do node --check "$file" || exit; done
npm ls --depth=0
npm audit                       # Requires registry access; assess applicability too
npm pack --dry-run              # Inspect the prospective published package
```

There is no build step, linter, test suite, CI workflow, or declared Node engine range.
Do not report syntax checks as functional tests. Prefer Node's built-in `node:test`
and `assert` when introducing coverage, with mocked MQTT clients and controlled time.
Agree/document the supported Node versions before choosing version-specific test APIs.

## Safety and change discipline

- Never connect to a real home MQTT broker or publish device commands during checks
  without explicit approval. Examples can actuate real devices.
- Use mocks or an explicitly isolated local test broker. Keep credentials out of
  source, fixtures, logs, and documentation.
- Add regression coverage before fixing behavior; keep code, exports, and README
  examples consistent. Distinguish compatibility fixes from intentional API changes.
- Test synchronous throws and rejected promises, disconnect/reconnect, cancellation,
  malformed input, MQTT wildcards/shared subscriptions, and scheduler boundaries.
- Use explicit timestamps/time zones for scheduler tests, including midnight and DST;
  avoid timing-sensitive sleeps and network-dependent unit tests.
- Preserve the existing two-space, semicolon-oriented ESM style; avoid unrelated reformatting.
- Keep dependency updates deliberate, update the lockfile together with metadata,
  inspect audit results, and do not use `npm audit fix --force` blindly.
- Do not edit generated `node_modules` or add installation artifacts to git.
- Check `git diff --check` and inspect the diff before finishing. State exactly what
  was verified, what failed, and what could not be tested.
