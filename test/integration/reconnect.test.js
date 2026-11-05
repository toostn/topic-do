import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { connect } from 'mqtt';

const mosquitto = process.env.MOSQUITTO_BIN ??
  (existsSync('/usr/sbin/mosquitto') ? '/usr/sbin/mosquitto' : 'mosquitto');

// Keep event history so fast child-process events cannot race an assertion.
function inbox(emitter, event) {
  const history = [];
  const updates = new EventEmitter();
  emitter.on(event, value => { history.push(value); updates.emit('update'); });
  return async predicate => {
    const signal = AbortSignal.timeout(5000);
    while (true) {
      const found = history.find(predicate);
      if (found !== undefined) return found;
      await once(updates, 'update', { signal });
    }
  };
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

async function startBroker(config) {
  const child = spawn(mosquitto, ['-c', config, '-v']);
  let log = '';
  let error;
  const updates = new EventEmitter();
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { log += data; updates.emit('update'); });
  }
  child.on('error', value => { error = value; updates.emit('update'); });
  child.on('exit', () => updates.emit('update'));
  const waitFor = async text => {
    const signal = AbortSignal.timeout(5000);
    while (!log.includes(text)) {
      if (error) throw new Error('Install Mosquitto or set MOSQUITTO_BIN to run integration tests', { cause: error });
      if (child.exitCode !== null) throw new Error(`Mosquitto exited: ${log}`);
      await once(updates, 'update', { signal });
    }
  };
  try {
    await waitFor('mosquitto version');
    await waitFor('running');
  } catch (error) {
    if (child.pid) await stop(child);
    throw error;
  }
  return { child, waitFor };
}

test('real MQTT reconnect restores subscriptions without duplicate rules or schedules', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'topic-do-mqtt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Reserve an ephemeral loopback port, then hand it to the isolated broker.
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const config = join(directory, 'mosquitto.conf');
  await writeFile(config, `listener ${port} 127.0.0.1\nallow_anonymous true\npersistence false\n`);

  let server = await startBroker(config);
  t.after(() => stop(server.child));
  const url = `mqtt://127.0.0.1:${port}`;
  const observer = connect(url, { clientId: 'test-observer', reconnectPeriod: 100, connectTimeout: 1000 });
  t.after(() => observer.endAsync(true));
  await once(observer, 'connect', { signal: AbortSignal.timeout(5000) });
  await observer.subscribeAsync('test/output');

  const worker = fork(fileURLToPath(new URL('../fixtures/automation.js', import.meta.url)), {
    env: { ...process.env, TEST_MQTT_URL: url },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  let workerErrors = '';
  worker.stderr.on('data', data => { workerErrors += data; });
  t.after(() => stop(worker));
  const waitForWorker = inbox(worker, 'message');
  await server.waitFor('Sending SUBACK to topic-do-under-test');
  await waitForWorker(message => message.type === 'once');

  const roundTrip = async (topic, payload) => {
    const reply = once(observer, 'message', { signal: AbortSignal.timeout(5000) });
    await observer.publishAsync(topic, payload);
    const [output, received] = await reply;
    assert.equal(output, 'test/output');
    assert.deepEqual(received, Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
  };
  const payloads = ['42', 'false', '{"state":"ON"}', Buffer.from([0xff, 0, 0x80])];
  for (const payload of payloads) await roundTrip('test/input', payload);

  const disconnected = once(observer, 'close');
  await stop(server.child);
  await disconnected;
  worker.send('add-offline');
  await waitForWorker(message => message.type === 'added');

  const reconnected = once(observer, 'connect', { signal: AbortSignal.timeout(5000) });
  server = await startBroker(config);
  await reconnected;
  // Confirm both mqtt.js's restored subscription and the newly queued rule.
  await server.waitFor('Sending SUBACK to topic-do-under-test');
  await server.waitFor('test/offline');
  await observer.subscribeAsync('test/output');
  for (const payload of payloads) await roundTrip('test/input', payload);
  await roundTrip('test/offline', 'hello');

  worker.send('snapshot');
  const snapshot = await waitForWorker(message => message.type === 'snapshot');
  assert.deepEqual(snapshot, { type: 'snapshot', handled: 9, onceRuns: 1, scheduled: 1 });
  assert.equal(worker.exitCode, null, workerErrors);
  assert.equal(workerErrors, '', 'automation emitted an error during reconnection');
});
