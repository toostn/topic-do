# Working on topic-do

## Purpose

A small, code-first MQTT home-automation library, not a standalone service. Preserve
the plain-JavaScript `{ topic, do }` / `{ schedule, do }` API. Avoid frameworks,
configuration languages, and large dependencies without a concrete need.

## Repository map

- `src/index.js`: MQTT connection, subscriptions, dispatch, schedules, publishing.
- `src/schedules.js`: `combine`, `once`, `DAYS`, `daily`, `at`, `between`.
- `src/util.js`: topic matching, cache, debounce, and trigger helpers.
- `src/timers.js`: shared Node-safe timer delay validation.
- `test/*.test.js`: unit tests using `node:test` and `node:assert/strict`.
- `test/integration/reconnect.test.js`: real-client reconnect test with isolated Mosquitto.
- `test/fixtures/automation.js`: child-process automation for integration checks.
- `README.md`: public API, examples, limitations, and migration from 0.x.
- `CHANGELOG.md`: release history.
- `package.json` / `package-lock.json`: package metadata and dependency graph.

## Runtime and API contract

- Target Node 26 LTS only, starting at 26.13.0 (`engines.node: ^26.13.0`). `.nvmrc`
  selects this major. Adopt future LTS majors explicitly; no multi-major test matrix.
- ES modules with explicit `.js` relative imports; no build step.
- The entry point exports named `broker(url, mqttOptions, options)`, not a default.
- `broker()` returns an object with chainable `.add(ruleOrArray)`. With default
  connection options, `.add()` starts the manual MQTT connection.
- `broker.close({ timeoutMs = 5000 })` is idempotent: stop dispatch/scheduling,
  ignore late publications, invoke unique rule/handler close hooks, drain returned
  work, and end MQTT. Cleanup/deadline failures reject and force-end the client.
  Timer helpers expose `.close()`; `triggerTimer` hooks are registered by `.add()`.
  The application owns process signals, cache persistence and process exit.
- Topic handlers receive `(topic, payload, cache, publish)`; scheduled handlers
  receive `(cache, publish)`. `publish` is a function, not a client/broker object.
- Return `[topic, payload]`, arrays of pairs, promises of either, or nothing.
- Incoming `parsePayload` defaults to true, including with partial options: strict
  UTF-8 decoding, then JSON when valid, otherwise text; invalid UTF-8 remains the
  original Buffer. False preserves raw Buffers. No `parseJson` compatibility alias.
- Publish strings/Buffers unchanged, Uint8Array view bytes as Buffers, and other
  supported values as JSON. Reject unsupported or non-serializable payloads.
- Synchronous handler errors, rejected promises, and handler-returned publication
  errors are logged to `console.error`; other rules continue. `singleTimer` also
  reports callback throws and rejections of returned promises/thenables;
  `triggerTimer` uses that boundary for delayed publications. Other direct
  publishers, raw timers, external event callbacks, and detached promises must
  handle their own errors. Helper failures are not automatically retried.
- Cache interface is synchronous `get(key)` / `set(key, value)`, injectable through
  `options.cache`. The default cache is unbounded, in-memory, and keyed by exact
  received topic; subscriptions do not guarantee an initial value.
- Schedulers return milliseconds. Finite negatives stop a rule; non-negative delays
  must be finite numbers no larger than 2147483647. Invalid/throwing schedulers are
  reported and disabled. Timer helpers reject invalid delays immediately.
- Scheduling does not await async handlers, so executions may overlap. Dates use
  local time. `at()` is a same-day offset; use `daily(at(...))` for recurrence.
- Do not combine `once()` with `combine()`: evaluating a non-winning one-shot child
  still consumes it. Use separate rules. One-shot helper instances are stateful;
  create a fresh one for each independent rule.
- QoS/retain/delivery acknowledgments are not exposed by the publishing wrapper.
  Keep documented limitations explicit rather than promising delivery guarantees.
- Preserve existing helper deep imports under `topic-do/src/`; do not add an
  `exports` map that accidentally blocks them.

## Commands

```sh
nvm install && nvm use           # If using nvm
npm ci                          # Install exactly the lockfile
npm test                        # Unit suite; no broker or network needed
npm run test:coverage            # Built-in unit coverage
npm run test:integration         # Requires local Mosquitto; loopback only
npm audit                       # Registry access required
npm pack --dry-run              # Inspect package contents
```

The unit scripts enable `--experimental-test-module-mocks`; Node warnings are
expected. Keep MQTT mocked before importing the entry point. Use test-context mock
timers, not sleeps. Broker tests are sequential within their file because the fake
client is shared. Scheduler tests set their own timezone in an isolated test process.
Test midnight, DST, exact boundaries, malformed input, and synchronous/async errors.

Integration tests require Mosquitto (`MOSQUITTO_BIN` can override the executable),
create an ephemeral loopback-only broker, and run automation in an owned child
process. Never connect to a household broker or publish real device commands during
checks without explicit approval. Keep credentials out of files and logs.

## Change discipline

- Add failing regression coverage before behavior fixes; keep all tests required.
- Keep code, public exports, README examples, and changelog consistent. Identify
  intentional breaking changes rather than disguising them as internal cleanup.
- Follow the existing two-space, semicolon-oriented ESM style; avoid unrelated formatting.
- Keep dependency updates deliberate and metadata/lockfile synchronized. Assess
  audit applicability; never blindly run `npm audit fix --force`.
- Do not edit generated `node_modules` or commit install artifacts or tarballs.
- Inspect `git diff`, run `git diff --check`, and state precisely what was verified.
- There is no linter or CI workflow. Do not equate coverage or syntax checks with
  end-to-end correctness.

## Release checklist

1. Finalize README and changelog; bump package and lockfile versions together.
2. Run unit tests, coverage, isolated integration tests, audit, and diff checks on Node 26.
3. Inspect the npm tarball and smoke-test its imports in a clean temporary project.
   The package `files` allowlist includes runtime source and changelog; README,
   license, and package metadata are included by npm. Tests/repository notes stay out.
4. Create the release commit, then an annotated `v<version>` tag pointing to it.
5. Push commits/tags and publish to npm only with explicit user authorization.
   A local tag does not mean the release has been published to the registry.
