# {topic, do} — Hi-code automation for MQTT junkies

Get your coding fingers dirty and get rid of YAML-based drag-and-drop solutions.

*{topic, do}* is a thin layer above [mqtt.js](https://github.com/mqttjs/MQTT.js)
for home automation using plain JavaScript event handlers and schedules. It is a
library, not a standalone service or device integration.

## Getting started

1. Connect your devices to an MQTT broker, for example through
   [zigbee2mqtt](https://www.zigbee2mqtt.io/) or
   [zwave-js-ui](https://github.com/zwave-js/zwave-js-ui).
2. Install the library: `npm install topic-do`.
3. Create an ES module (`automation.mjs`, or use `"type": "module"` in your project).
4. Configure your broker and add rules.

**Checkout versus npm:** this README describes the new API on `main`. The package
metadata still says `0.4.2`; these changes have not been versioned for a new release
in this repository. Existing users of the previous API should read
[Migration from the previous API](#migration-from-the-previous-api) and
[CHANGELOG.md](CHANGELOG.md). Do not assume an existing npm release contains this API.

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
    parseJson: true,
    cacheTopics: [light]
  }
);

automation
  .add({
    topic: 'home/zigbee2mqtt/master_bedroom_switch',
    do: (topic, message, cache, publish) => {
      return [
        `${light}/set`,
        { state: message.action === 'on' ? 'ON' : 'OFF' }
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
| `parseJson` | Set to `true` to attempt JSON parsing; failed parses remain raw MQTT Buffers. |
| `cacheTopics` | Array of additional topic filters to subscribe to, even without handlers. |
| `cache` | Optional custom synchronous cache implementing `get(key)` and `set(key, value)`. |

Currently JSON parsing defaults to `true` **only if the whole third argument is
omitted**. If you supply an options object, include `parseJson: true` explicitly
when you want it enabled.

## Rules and publishing

`.add(rule)` and `.add([rule, ...])` both return the automation object for chaining.

A topic rule accepts one filter or an array of filters:

```js
{
  topic: ['home/sensor_a', 'home/sensor_b'],
  do: (topic, message, cache, publish) => { /* ... */ }
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

Use string payloads or JSON-serializable objects. Objects are JSON-stringified
before publication. The current API does not expose per-message QoS/retain options
or delivery acknowledgments.

The last handler argument is a **publishing function**, not a broker or mqtt.js
client. Call `publish([topic, payload])` to publish directly, for example from an
external event callback. Do not call `publish.publish(...)`. Returning messages is
usually simpler; avoid both returning and directly publishing the same message.

Handlers may be async. Currently the library does not contain thrown errors or
rejected promises: handle failures in your own handlers until this is repaired.

### Cache

All received messages are stored by exact topic before handlers run. `cache.get(topic)`
returns the latest received value, or normally `undefined` if not received yet.
Subscriptions come from rules and `cacheTopics`; reading the cache does not subscribe.
Always handle missing values, for example `cache.get(light)?.state`.

The default cache is in memory, has no expiry or size limit, and is not persistent.
A subscription does not guarantee an initial value unless the broker has a retained
message or the device publishes one. There are also known special-key issues with
the current plain-object storage; see [REVIEW.md](REVIEW.md).

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
| `combine(...schedulers)` | Choose the smallest returned delay. Currently negative stop values also win, so do not combine an exhausted `once()` with recurring schedules. |
| `between(start, end, callback)` | Immediately call the callback if `start() > end()`. It is a conditional helper, not a recurring schedule. |

For example, `daily(at(7, 30))` runs daily at 07:30 and
`daily(at(9), DAYS.weekdays)` runs on weekdays at 09:00. A custom daily scheduler
receives the candidate day's local midnight as a timestamp and returns an offset
in milliseconds from that timestamp.

Negative schedule results disable that rule. Use finite delays within Node's timer
range; the implementation does not yet validate them. Timers are reconsidered
after firing, without awaiting async handler completion, so async runs may overlap.
Wall-clock schedules use local time, including daylight-saving changes; they are
not precision or real-time scheduling guarantees.

## Migration from the previous API

The new API removes `.topicDo()`, `.scheduleDo()`, and `.use()` in favor of `.add()`.

```js
// Before                         // Now
// app.topicDo(topic, handler);    app.add({ topic, do: handler });
// app.scheduleDo(timer, handler); app.add({ schedule: timer, do: handler });

// Old reusable configuration:
// app.use({ topicDo: [[topic, handler]], scheduleDo: [[timer, task]] });
// New equivalent:
// app.add([{ topic, do: handler }, { schedule: timer, do: task }]);
```

The daily scheduler also has a breaking change:

```js
// Before: daily(7, 30)
// Now:
const morning = daily(at(7, 30));
```

There is no `dailyAt` compatibility export, despite an intermediate commit message
mentioning one. Import `broker` as a named export and the one-shot helper as `once`;
older README examples using a default import or `scheduleOnce` were incorrect.
The publishing callback's type has not changed: it remains a function.

## Project status and development

There is no build step. Run `npm ci` to install the locked dependencies. `npm test`
is currently a failing placeholder, not a working test suite. Syntax can be checked
with `for file in src/*.js; do node --check "$file" || exit; done`.

Known maintenance work includes error containment, MQTT wildcard edge cases,
scheduler composition, dependency updates, and a shutdown/cancellation API. There
is currently no public method to close the client or cancel timers. See
[REVIEW.md](REVIEW.md) for the baseline findings and [AGENTS.md](AGENTS.md) for
repository guidance. Please open issues for bugs or documentation requests.

## This solution is better than...

- **Home Assistant** because no YAML. Full stop.
- **Node-RED** because no messy wires, because you can edit source. But yeah,
  Node-RED is also pretty sweet.
- **Google Home** because you're kidding right?
