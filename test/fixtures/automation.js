// Runs in a child process so the integration test can own its process lifetime.
import { broker } from '../../src/index.js';
import { once } from '../../src/schedules.js';

let handled = 0;
let onceRuns = 0;
let scheduled = 0;
const echo = (topic, payload) => {
  handled++;
  return ['test/output', payload];
};

const app = broker(process.env.TEST_MQTT_URL, {
  clientId: 'topic-do-under-test',
  reconnectPeriod: 100,
  connectTimeout: 1000
}).add([
  { topic: 'test/input', do: echo },
  { schedule: once(20), do: () => { onceRuns++; process.send({ type: 'once' }); } },
  { schedule: () => { scheduled++; return 60000; }, do: () => {} }
]);

process.on('message', command => {
  if (command === 'add-offline') {
    app.add({ topic: 'test/offline', do: echo });
    process.send({ type: 'added' });
  } else if (command === 'snapshot') {
    process.send({ type: 'snapshot', handled, onceRuns, scheduled });
  } else if (command === 'shutdown') {
    app.close().then(() => {
      process.send({ type: 'closed' }, () => process.disconnect());
    }).catch(error => {
      console.error(error);
      process.exit(1);
    });
  }
});
