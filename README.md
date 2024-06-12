# {topic, do} - Hi-code automation for mqtt junkies

Get your coding fingers dirty and get rid of yaml-based drag-and-drop solutions.

*{topic, do}* is a thin layer above the mqtt.js-client that allows for easier automation based on events or scheduling.

## The route to epic automation success
1. Connect all your devices to one mqtt broker, e.g. through [zigbee2mqtt](https://www.zigbee2mqtt.io/), [zwave-js-ui](https://github.com/zwave-js/zwave-js-ui), and alike
2. Install {topic, do} and configure it to use your mqtt broker
3. Automate away using plain ol' JavaScript

Here's how to set up {topic, do}:

Create a broker connection with the broker function, using the same arguments as [mqtt.js Client](https://github.com/mqttjs/MQTT.js?tab=readme-ov-file#client)

The broker function returns an object with an add function.

The add function expects a single, or an array of objects on the format:

```js
{
  topic: string|[string],
  do: (topic, message, cache, broker) => [string, <any>]|Promise([string, <any>])
}
```

or

```js
{
  schedule: () => Number,  // time in ms until the do function should execute
  do: (cache, broker) => [string, <any>]|Promise[string|any]
}
```

Anything returned from a do function on the format [topic, message], [[topic, message],...] or a promise that resolves to one
of these two will be posted to the broker.

The add function returns the broker object, so that it can be chained.

See this example for inspiration and more details:

```js
import broker from 'topic-do';
import { scheduleOnce } from 'topic-do/src/schedules.js';
import madeUpDB from 'made-up-db'; // Just replace with your favorite non-made up one
import myAPI from 'made-up-api'; // Just replace with your favorite non-made up one
import { magicColorTempFunction } from './my-magic-utils.js';
import { remoteControl, nuclearLaunchButton } from './my-automations.js';

broker(
  'ws://my.mqtt.broker:8081', // The URL to the broker
  {
    // These options are passed on to mqtt.js, see [their docs](https://github.com/mqttjs/MQTT.js?tab=readme-ov-file#client) for more info
    user: 'mqtt',
    password: 'secret'
  },
  {
    // These are options for {topic, do}
    debug: false,    // Logs misc useful stuff to the console
    cacheTopics: [], // Topics that are subsribed to on connection and that
                     // are available in the cache object passed to all events
                     // and timers
    parseJson: true  // Attempt to parse all MQTT messages as JSON objects
  }
)
  .add({
    topic: 'home/zigbee2mqtt/temperature_sensor', // Listen to this topic
    do: (topic, message, cache, client) => {   // Do this on incoming messages
      // Indicate indoor temperature using lights

      const light = 'home/zigbee2mqtt/color_light';

      if (cache.get(light).state !== 'ON') {
        return;
      }

      const hex = (message.temperature < 20) ? '#0000ff' : '#ff0000';

      // To post responses back to the broker, simply return a single or
      // an array of [topic, message]

      return [
        light,
        {color: { hex }}
      ];
      }
    })
  .add({
    topic: [ // It can haz array of topics
      'home/zigbee2mqtt/facade_motion_sensor',
      'home/zigbee2mqtt/garden_motion_sensor'
    ],
    do: (topic, message, cache, broker) => {
      // Log outdoor motion to database
      const sensor = topic.split('/').pop().replace('_motion_sensor', '');

      // Made up DBs are always connected and never fail
      // Return a promise that resolves into an array of topic, message
      // or an array of the same
      return madeUpDB
        .save(
          'motion_log',
          { sensor },
          {motion: message.occupancy}
        )
        .then(() => {
          return [
            'topic-do/messages',
            {aync_supported: true}
          ];
        });
    }
  })
  .add({
    // It can also be triggered by a timeout function
    // The schedule function should at any invocation return the number of 
    // milliseconds until next invocation of the do function
    // It is called initially, then typically after the do function has been
    // executed.
    schedule: () => { return 30000; },  // Every 30 seconds (sort of...)
    do: (cache, broker) => { // Obviously timeouts have no topic or message
      return [
        'home/zigbee2mqtt/color_temp_controlled', // Zigbee group
        {color_temp: magicColorTempFunction()}
      ];
    }
  })
  .add({
    schedule: scheduleOnce(), // Util function from {topic, do} that executes once
    do: (cache, broker) => {
      // In case you want to run something once when we're connected to the
      // broker

      return [
        'topic-do/message',
        'Hello broker!'
      ];
    }
  })
  // This would be how you'd add your custom integrations from things outside of MQTT
  // Interal-based polling
  .add({
    schedule: () => 60000,
    do: (cache, broker) => {
      const {reading, error} = myAPI.get('currentReading');
    
      return (error == null) 
        ? null
        : ['home/myintegration/interval_reading', {reading}];
    }
  })
  // Event-based publishing
  .add({
    schedule: scheduleOnce(), // Run once when the broker has connected
    do: (cache, broker) => {
      const connection = myAPI.connect();

      connection.on('reading', (reading) => {
        broker.publish(['home/myintegration/reading', {reading}])
      });
    }
  })
  .add([
    // Add an array of mix-and-match topic/schedule actions
    {
      topic: 'home/zigbee2mqtt/master_bedroom_switch',
      do: (topic, message, cache) => {
        return [
          'home/zigbee2mqtt/master_bedroom_light/set',
          { state: (message.action === 'on') ? 'ON' : 'OFF' }
        ];
      }
    },
    {
      schedule: () => { return 30000; },
      do: () => (['topic-do/ping'], {alive: true})
    },
    // This is also possible, yet not recommended. Note that the arguments of
    // the do-function will be different when triggered by a topic than when
    // triggered on a schedule
    {
      topic: 'topic-do/pong',
      schedule: () => { return 30000; },
      do: () => (['topic-do/ping'], {alive: true})
    }
  ])

  // The above could be imported as an object from a separate file
  .add(remoteControl) // remoteControl = [{topic, do}, {schedule, do}, ...]

  // Or if you want to reuse an automation across multiple...things, export
  // generator functions from your imports
  .add(nuclearLaunchButton({activation_code: 'KENSENTME'}))
  .add(nuclearLaunchButton({activation_code: '54321'}));
```

Please open issues to request better documentation or clarifications.

## This solution is better than...
- **homeassistant** because no yaml. Full stop.
- **node-red** because no messy wires, because no wrapper-libraries left to rot, because can edit source. But yeah, node-red is also prettty sweet.
- **Google home** because you're kidding right?
