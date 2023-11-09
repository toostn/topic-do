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
        cacheAll: true, // Whether to keep a local cache of *all* topics on
                        // broker, or only those subscribed to. Could be
                        // painful to use if there are loooots of topics
        parseJson: true // Attempt to parse all messages as JSON objects
    }
)
    .topicDo(
        'home/zigbee2mqtt/temperature_sensor', // Listen to this topic
        (topic, message, client, cache) => {   // Do this on incoming messages
            // Indicate indoor temperature using lights

            const light = 'home/zigbee2mqtt/color_light';

            if (cache.get(light).state !== 'ON') {
                return;
            }

            const hex = (message.temperature < 20) ? '#0000ff' : '#ff0000';

            client.publish(light, JSON.stringify({color: { hex }}));
        }
    )
    .topicDo(
        [ // It can haz array of topics
            'home/zigbee2mqtt/facade_motion_sensor',
            'home/zigbee2mqtt/garden_motion_sensor'
        ],
        (topic, message, client, cache) => {
            // Log outdoor motion to database
            const sensor = topic.split('/').pop().replace('_motion_sensor', '');

            // Made up DBs are always connected and never fail
            madeUpDB.save(
                'motion_log',
                { sensor },
                {motion: message.occupancy}
            );
        }
    )
    .scheduleDo( // It can also haz an timeout generator function
        () => { return 30000; },  // Every 30 seconds (sort of...)
        (client, cache) => { // Obviously timeouts have no topic or message
            client.publish(
                'home/zigbee2mqtt/color_temp_controlled', // Zigbee group
                JSON.stringify({
                    color_temp: magicColorTempFunction()
                })
            );
        }
    )
    .scheduleDo(
        scheduleOnce(),
        (client, cache) => {
            // In case you want to run something once when we're connected to the
            // broker

            client.publish('topic-do/message', 'Hello broker!');
        }
    )
    // If you don't like putting it all in one file:
    .topicDo(...remoteControl())
    .topicDo(...nuclearLaunchButton());
```

## This solution is better than...
- **homeassistant** because no yaml. Full stop.
- **node-red** because no messy wires, because no wrapper-libraries left to rot, because can edit source. But yeah, node-red is also prettty sweet.
- **Google home** because you're kidding right?
