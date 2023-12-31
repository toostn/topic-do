# topic-do - Hi-code automation for mqtt junkies

Get your coding fingers dirty and get rid of yaml-based drag-and-drop solutions.

*topic-do* is a thin layer above the mqtt.js-client that allows for easier automation based on events or scheduling.

## The roadmap to epic automation success
1. Connect all your devices to one mqtt broker, e.g. through zigbee2mqtt
2. Install topic-do and configure it to use your mqtt broker
3. Automate away using plain ol' JavaScript

Here's how it works:

```js
import broker from 'topic-do';
import { scheduleOnce } from 'topic-do/src/schedules.js';
import madeUpDB from 'made-up-db'; // Just replace with your favorite non-made up one
import { magicColorTempFunction } from './my-magic-utils.js';
import { remoteControl, nuclearLaunchButton } from './my-automations.js';

broker(
    'ws://my.mqtt.broker:8081', // The URL to the broker
    {
        // These options are passed on to mqtt.js, see their docs for more info
        user: 'mqtt',
        password: 'secret'
    },
    {
        // These are options for topic-do
        debug: false,   // Logs misc useful stuff to the console
        cacheTopics: [], // Topics that are subsribed to on connection and that
                        // are available in the cache
        parseJson: true // Attempt to parse all messages as JSON objects
    }
)
    .topicDo(
        'home/zigbee2mqtt/temperature_sensor', // Listen to this topic
        (topic, message, cache, client) => {   // Do this on incoming messages
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
    )
    .topicDo(
        [ // It can haz array of topics
            'home/zigbee2mqtt/facade_motion_sensor',
            'home/zigbee2mqtt/garden_motion_sensor'
        ],
        (topic, message, cache, client) => {
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
    )
    .scheduleDo( // It can also haz an timeout generator function
        () => { return 30000; },  // Every 30 seconds (sort of...)
        (cache, client) => { // Obviously timeouts have no topic or message
            return [
                'home/zigbee2mqtt/color_temp_controlled', // Zigbee group
                {color_temp: magicColorTempFunction()}
            ];
        }
    )
    .scheduleDo(
        scheduleOnce(),
        (cache, client) => {
            // In case you want to run something once when we're connected to the
            // broker

            return [
                'topic-do/message',
                'Hello broker!'
            ];
        }
    )
    // If you don't like putting it all in one file:
    .topicDo(...remoteControl())
    .topicDo(...nuclearLaunchButton())
    // Or to add puzzle pieces that both use schedules and listen to events:
    .use((configThing) => {
       // Do things, setup and stuff
       // You'd typically put this function in a separate file and import it

       return {
           topicDo: [
               [
                   'home/sensors/my-switch',
                   (topic, {action}) => {
                       return (action === 'arrow_up')
                         ? ['home/lights/living-room/set', {state: 'ON'}]
                         : [];
                   }
                ],
                [
                   'home/sensors/my-other-switch',
                   (topic, {action}) => {
                       return (action === 'arrow_up')
                         ? ['home/lights/bedroom/set', {state: 'ON'}]
                         : [];
                   }
                ]
           ],

           scheduleDo: [
                [
                    () => 30000,
                    () => {
                        return [
                            'topic-do/ping',
                            {alive: true}
                        ];
                    }
                ]
            ]
       };
    });
```

## This solution is better than...
- **homeassistant** because no yaml. Full stop.
- **node-red** because no messy wires, because no wrapper-libraries left to rot, because can edit source. But yeah, node-red is also prettty sweet.
- **Google home** because you're kidding right?
