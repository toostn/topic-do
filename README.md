# {topic, do} — Hi-code automation for MQTT junkies

Get your coding fingers dirty and get rid of YAML-based drag-and-drop solutions.

*{topic, do}* is a thin layer above [mqtt.js](https://github.com/mqttjs/MQTT.js)
for home automation using plain JavaScript event handlers and schedules. It is a
library, not a standalone service or device integration.

## Getting started

1. Connect your devices to an MQTT broker, for example through
   [zigbee2mqtt](https://www.zigbee2mqtt.io/) or
   [zwave-js-ui](https://github.com/zwave-js/zwave-js-ui).
2. Use **Node 26 LTS, version 26.13.0 or newer within Node 26**, and install the library:
   `npm install topic-do`.
3. Create an ES module (`automation.mjs`, or use `"type": "module"` in your project).
4. Configure your broker and add rules.

The latest release is **1.0.0**; changes pending release are listed under
**Unreleased** in [CHANGELOG.md](CHANGELOG.md). Upgrading from 0.x? Read
[Migration from 0.x](#migration-from-0x).

```js
import { broker } from 'topic-do';
import { once, daily, at, DAYS } from 'topic-do/src/schedules.js';

const light = 'home/zigbee2mqtt/master_bedroom_light';

const automation = broker(
  process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
  },
  {
    debug: false,
    parsePayload: true,
    cacheTopics: [light]
  }
);

automation
  .add({
    topic: 'home/zigbee2mqtt/master_bedroom_switch',
    do: (topic, payload, cache, publish) => {
      return [
        `${light}/set`,
        { state: payload.action === 'on' ? 'ON' : 'OFF' }
      ];
    }
  })
  .add({
    schedule: once(),
    do: () => ['topic-do/status', { alive: true }]
  })
  .add({
    schedule: daily(at(22, 30), DAYS.weekdays),
    do: () => [`${light}/set`, { state: 'OFF' }]
  });
```

Run it with `node automation.mjs`. Adapt all topics to your own devices: **this
example publishes commands and can operate real lights**. Use mocks or an isolated
broker when experimenting. Never commit broker credentials.

## Connection and options

`broker(url, mqttOptions, options)` creates an automation object. `url` and
`mqttOptions` are passed to [mqtt.js `connect`](https://github.com/mqttjs/MQTT.js#connect).
The library requests manual connection and starts connecting when `.add()` is called;
creating the object alone does not initiate the default connection.

The third argument accepts:

| Option | Behavior |
| --- | --- |
| `debug` | Set to `true` for incoming-message, publishing, subscription, and connection logs. Logs may contain sensitive payloads. |
| `parsePayload` | Defaults to `true`: parse JSON, otherwise return valid UTF-8 text, otherwise preserve the original Buffer. Set to `false` for raw Buffers. |
| `cacheTopics` | Array of additional topic filters to subscribe to, even without handlers. |
| `cache` | Optional custom synchronous cache implementing `get(key)` and `set(key, value)`. |

Defaults apply even when you supply only some options. `parsePayload` replaces the
old `parseJson` option (no compatibility alias); rename it in existing configurations.
UTF-8 decoding is strict so invalid bytes are preserved as a Buffer rather than
silently replaced. Valid UTF-8 binary data is indistinguishable from text; use
`parsePayload: false` when you require raw bytes.

## Rules and publishing

`.add(rule)` and `.add([rule, ...])` both return the automation object for chaining.

A topic rule accepts one MQTT filter or an array of filters. `+`, `#`, and shared
subscriptions (`$share/group/filter`) are supported; leading wildcards do not match
`$` system topics. A handler runs for each matching registered filter, so overlapping
filters may invoke it more than once for a single incoming publication.

```js
{
  topic: ['home/sensor_a', 'home/sensor_b'],
  do: (topic, payload, cache, publish) => { /* ... */ }
}
```

A scheduled rule has a function returning milliseconds until the next execution:

```js
{
  schedule: () => 30000,
  do: (cache, publish) => ['topic-do/ping', { alive: true }]
}
```

Handlers may return:

- One `[topic, payload]` pair.
- An array of pairs: `[[topicA, payloadA], [topicB, payloadB]]`.
- A promise resolving to either of those.
- Nothing (`undefined`, `null`, or an empty array) to publish nothing.

Strings and Buffers are published unchanged; `Uint8Array` views are converted to
Buffers containing only the view's bytes. Objects, arrays, finite numbers, booleans,
and `null` are JSON-encoded. Unsupported values (such as `undefined`, functions,
symbols, BigInts, non-finite numbers, and circular objects) raise an error rather
than being sent to mqtt.js. Errors in handler-returned publications are logged by
the rule wrapper. Outside a guarded rule or timer-helper callback, direct
`publish()` callers must handle thrown errors themselves.
The API does not expose per-message QoS/retain options or delivery acknowledgments.

The last handler argument is a **publishing function**, not a broker or mqtt.js
client. Call `publish([topic, payload])` to publish directly, for example from an
external event callback. Do not call `publish.publish(...)`. Returning messages is
usually simpler; avoid both returning and directly publishing the same message.

Handlers may be async. Thrown errors and rejected promises are logged to
`console.error` without interrupting other rules; failed handlers may run again
on their next trigger.

### Shutdown

`await automation.close({ timeoutMs: 5000 })` stops new dispatch, subscriptions,
reconnection ticks and scheduled work immediately. Later direct publications and
handler-returned messages are ignored. It cancels pending `triggerTimer` callbacks,
invokes optional `rule.close()` and `rule.do.close()` hooks once per owner, and waits
for returned handler work and cleanup promises while ending the MQTT connection.
Previously queued MQTT writes are given an opportunity to drain, not a delivery
or device-acknowledgment guarantee.

Repeated calls return the same promise. Adding rules after close throws. If a
cleanup fails, close rejects with an `AggregateError`; if the deadline expires it
force-ends MQTT and rejects. Expected `AbortError` handler rejections during shutdown
are not logged as rule failures; other errors are still reported. The application owns logging, exit policy, and final
cache persistence. Hooks should cancel external I/O and timers; detached work
cannot be discovered or cancelled automatically. The library installs no process
signal handlers and never calls `process.exit()`.

### Cache

All received messages are stored by exact topic before handlers run. `cache.get(topic)`
returns the latest received value, or normally `undefined` if not received yet.
Subscriptions come from rules and `cacheTopics`; reading the cache does not subscribe.
Always handle missing values, for example `cache.get(light)?.state`.

The default cache is in memory, has no expiry or size limit, and is not persistent.
A subscription does not guarantee an initial value unless the broker has a retained
message or the device publishes one. Special keys such as `__proto__` are stored
as ordinary cache keys.

### Reusable rules

Export a rule or an array from another module, then pass it to `.add()`:

```js
export const remoteControl = [
  {
    topic: 'home/remote',
    do: () => ['home/light/set', { state: 'TOGGLE' }]
  },
  {
    schedule: () => 60000,
    do: () => ['topic-do/ping', { alive: true }]
  }
];
```

Rule-generator functions work too: `.add(makeRemoteControl({ room: 'kitchen' }))`.
A rule can contain both `topic` and `schedule`, but its handler then receives
**different arguments** depending on the trigger; separate rules are clearer.

## Scheduling helpers

Import helpers from `topic-do/src/schedules.js`.

| Helper | Meaning |
| --- | --- |
| `once(initialDelay = 0)` | Run once after connection, optionally delayed. Create a separate instance per independent rule. |
| `at(hours, minutes = 0, seconds = 0)` | Offset to that time on the supplied/current local day; negative if already past. Not recurring by itself. |
| `daily(scheduler, on = DAYS.all)` | Find the next eligible local day using the supplied scheduler. |
| `DAYS.weekdays` / `DAYS.weekends` / `DAYS.all` | Day-number arrays; Sunday is `0`, Saturday is `6`. Custom arrays also work. |
| `combine(...schedulers)` | Choose the smallest non-negative delay, or `-1` if none remain. Do not use with `once()` schedulers; see below. |
| `between(start, end, callback)` | Immediately call the callback if `start() > end()`. It is a conditional helper, not a recurring schedule. |

For example, `daily(at(7, 30))` runs daily at 07:30 and
`daily(at(9), DAYS.weekdays)` runs on weekdays at 09:00. A custom daily scheduler
receives the candidate day's local midnight as a timestamp and returns an offset
in milliseconds from that timestamp.

**Do not use `combine()` with `once()` schedulers.** Composition evaluates every
child, so a one-shot scheduler can be consumed even when another child wins. Use
separate rules for one-shot and recurring work.

Finite negative schedule results disable that rule. Otherwise, delays must be
numbers between **0 and 2,147,483,647 ms** (about 24.8 days). Invalid values,
oversized delays, and throwing schedulers are logged and disable only that rule;
they are not clamped into rapid timers. `singleTimer()` and `triggerTimer()` reject
invalid delays immediately, including negative values. Zero runs as soon as the
event loop permits. Timers are reconsidered after firing, without awaiting async
handler completion, so async runs may overlap.
Wall-clock schedules use local time, including daylight-saving changes; they are
not precision or real-time scheduling guarantees.

## Utility helpers

Import from `topic-do/src/util.js`:

| Helper | Meaning |
| --- | --- |
| `matchTopic(filter, topic)` | Test a topic against an MQTT filter, including shared subscriptions. |
| `cache()` | Create an independent in-memory store with synchronous `get(key)` and `set(key, value)`. |
| `singleTimer(delay)` | Return a function accepting a callback; each call replaces the pending callback and restarts the delay (debounce). |
| `triggerTimer(filter, topics, messageOn, messageOff, delay)` | Create a topic handler that returns on-messages and debounces direct publication of off-messages. |

For example, keep a light on until a motion sensor has been quiet for one minute:

```js
import { triggerTimer } from 'topic-do/src/util.js';

const motionLight = {
  topic: 'home/motion',
  do: triggerTimer(
    (topic, payload, cache) => payload.occupancy === true,
    ['home/light/set'],
    { state: 'ON' },
    { state: 'OFF' },
    60000
  )
};
// Add to an existing automation: automation.add(motionLight);
```

`topics` must be an array. A `null` filter accepts every trigger; otherwise it must
return exactly `true`. A `null` or `undefined` on/off message omits that action.
Rejected triggers do not reset the timer.

`singleTimer()` reports synchronous callback errors and rejections of returned
promises/thenables to `console.error`. `triggerTimer()` uses the same boundary for
its delayed off-publication, including failures thrown by `publish()`. Failures do
not prevent other timers from firing or the helper from being triggered again;
failed actions are not automatically retried.

Return asynchronous work from a timer callback so its rejection can be observed.
A callback's return value is not automatically published. Debouncing replaces only
pending callbacks; it does not cancel asynchronous work that has already started.
The function returned by `singleTimer()` or `triggerTimer()` has a `.close()` method:
it cancels pending callbacks, prevents rearming, and waits for already-running
callback promises. A `triggerTimer` handler's close hook is automatically registered
by `automation.add()`. For a `singleTimer` hidden inside a rule factory, expose it
through that rule's `close` hook.
External event callbacks, raw `setTimeout` callbacks, and detached promises remain
outside these boundaries and must handle their own errors.

## Migration from 0.x

| Before | 1.0.0 |
| --- | --- |
| `app.topicDo(topics, handler)` | `app.add({ topic: topics, do: handler })` |
| `app.scheduleDo(timer, handler)` | `app.add({ schedule: timer, do: handler })` |
| `app.use({ topicDo: [[topic, handler]], scheduleDo: [[timer, task]] })` | `app.add([{ topic, do: handler }, { schedule: timer, do: task }])` |
| `daily(7, 30)` | `daily(at(7, 30))` |
| `parseJson: false` | `parsePayload: false` |

Update your runtime to Node 26.13.0+ within the Node 26 LTS line. Payload parsing
now defaults to enabled even with partial options; non-JSON text becomes a string
rather than a Buffer. Set `parsePayload: false` to keep all incoming payloads raw.

The daily scheduler also has a breaking change:

```js
// Before: daily(7, 30)
// Now:
const morning = daily(at(7, 30));
```

Import `broker` as a named export and the one-shot helper as `once`; there is no
default broker export, `scheduleOnce`, or `dailyAt` compatibility helper. The last
handler argument remains a publishing function, not an object with `.publish()`.
Outgoing binary data is now preserved, finite numbers/booleans are JSON-encoded,
and unsupported payloads or unsafe timer delays are rejected as described above.

## Project status and development

There is no build step. Runtime and development target **Node 26 LTS**, starting
at **26.13.0** (`engines.node: ^26.13.0`). Only this major version is supported and
tested. `.nvmrc` selects the Node 26 line; with nvm, run `nvm install` and `nvm use`
before installing dependencies. Future LTS majors will be adopted explicitly.

```sh
npm ci
npm test
npm run test:coverage
```

Tests use Node's built-in `node:test` and `assert`, with no added dependencies.
The npm scripts enable experimental module mocking to replace mqtt.js before the
entry point is imported; Node's experimental warnings are expected. Unit-test MQTT
clients are mocked, timers are controlled, and no broker credentials or network
connection are needed. Scheduler tests use an explicit timezone and include DST boundaries.
The single test target is Node 26 LTS; the suite has been checked on 26.13.0.

Run `npm run test:integration` separately for a real-client reconnect test. It
requires a locally installed Mosquitto executable (`mosquitto`, `/usr/sbin/mosquitto`,
or an explicit `MOSQUITTO_BIN` path). It creates a temporary broker bound only to
`127.0.0.1` on an ephemeral port, restarts it, and verifies payload round-trips,
restored subscriptions, rules added offline, and no duplicated rule/schedule setup.
It does not connect to your home broker or require another npm dependency.

Unit tests live in `test/broker.test.js`, `test/schedules.test.js`, and `test/util.test.js`;
the integration test is in `test/integration/reconnect.test.js`.
All tests are required to pass, including regression coverage for handler errors,
MQTT topic matching, scheduler composition, and special cache keys.

Run `npm audit` as advisories change. See
[AGENTS.md](https://github.com/toostn/topic-do/blob/main/AGENTS.md) for repository
and release guidance. Please [open an issue](https://github.com/toostn/topic-do/issues)
for bugs or documentation requests.

## This solution is better than...

- **Home Assistant** because no YAML. Full stop.
- **Node-RED** because no messy wires, because you can edit source. But yeah,
  Node-RED is also pretty sweet.
- **Google Home** because you're kidding right?
