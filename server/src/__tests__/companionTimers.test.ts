import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { installCompanionTimers } from '../sockets/companionTimers';
import type { CompanionTaskTimer, CompanionTimerReply, CompanionTimerSnapshot } from '@squadhub/shared';

let http: HttpServer;
let server: Server;
let url: string;
let clients: Socket[];
const timer: CompanionTaskTimer = {
  taskId: randomUUID(), taskTitle: 'Review comps', listId: randomUUID(), status: 'running',
  elapsedSeconds: 1799, sampledAt: Date.now(), sessionId: 'session-1',
};
const state = (socket: Socket) => new Promise<CompanionTimerSnapshot>(resolve => socket.once('companion_timer_state', resolve));
async function client(userId: string) {
  const socket = connect(url, { auth: { userId }, transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise<void>(resolve => socket.on('connect', resolve));
  return socket;
}
async function publish(socket: Socket, timers = [timer]) {
  const next = state(socket);
  socket.emit('companion_timer_watch');
  await next;
  const update = state(socket);
  socket.emit('companion_timer_publish', timers);
  return update;
}
function control(socket: Socket, taskId = timer.taskId, requestId = randomUUID()) {
  return new Promise<CompanionTimerReply>(resolve => socket.emit('companion_timer_control', { requestId, action: 'stop', taskId }, resolve));
}
beforeEach(async () => {
  clients = [];
  http = createServer();
  server = new Server(http);
  server.use((socket, next) => { (socket as any).userId = socket.handshake.auth.userId; next(); });
  installCompanionTimers(server, 100);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as any).port}`;
});
afterEach(async () => {
  clients.forEach(socket => socket.disconnect());
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('authenticated companion task timer relay', () => {
  it('keeps timer titles and control isolated to the authenticated user', async () => {
    const owner = await client('alice');
    await publish(owner);
    const stranger = await client('bob');
    const snapshot = state(stranger);
    stranger.emit('companion_timer_watch');
    expect(await snapshot).toEqual({ available: false, timers: [] });
    expect((await control(stranger)).success).toBe(false);
  });
  it('executes a stop in only one browser and reuses its result on retries', async () => {
    const first = await client('alice');
    const second = await client('alice');
    await publish(first);
    await publish(second);
    let executions = 0;
    for (const socket of [first, second]) socket.on('companion_timer_command', (_command, reply) => {
      executions++;
      reply({ success: true });
    });
    const companion = await client('alice');
    const id = randomUUID();
    const results = await Promise.all([control(companion, timer.taskId, id), control(companion, timer.taskId, id)]);
    expect(results).toEqual([{ success: true }, { success: true }]);
    expect(executions).toBe(1);
  });
  it('does not resurrect a stopped session from a delayed peer snapshot', async () => {
    const first = await client('alice');
    const peer = await client('alice');
    await publish(first);
    await publish(peer);
    await publish(first, []);
    expect(await publish(peer)).toEqual({ available: true, timers: [] });
  });
  it('keeps a timer on a list-less task visible instead of dropping the publish', async () => {
    // The web sends `listId: task.list_id || ''`; one invalid timer used to
    // invalidate the whole array and unregister the browser as publisher.
    const owner = await client('alice');
    await publish(owner);
    const update = state(owner);
    owner.emit('companion_timer_publish', [{ ...timer, listId: '' }]);
    const snapshot = await update;
    expect(snapshot.available).toBe(true);
    expect(snapshot.timers).toEqual([{ ...timer, listId: '' }]);
  });
  it('still rejects structurally invalid publishes without registering the socket', async () => {
    const owner = await client('alice');
    const next = state(owner);
    owner.emit('companion_timer_watch');
    expect(await next).toEqual({ available: false, timers: [] });
    const afterInvalid = state(owner);
    owner.emit('companion_timer_publish', [{ ...timer, taskId: 'not-a-uuid' }]);
    // A dropped publish emits nothing; give the server a beat to prove it.
    const silence = await Promise.race([afterInvalid, new Promise(r => setTimeout(() => r('silence'), 250))]);
    expect(silence).toBe('silence');
    expect((await control(owner)).success).toBe(false);
  });
  it('rejects stale task selections without sending a command', async () => {
    const owner = await client('alice');
    await publish(owner);
    let executions = 0;
    owner.on('companion_timer_command', () => executions++);
    const companion = await client('alice');
    expect((await control(companion, randomUUID())).success).toBe(false);
    expect(executions).toBe(0);
  });
  it('reports disconnects and never claims that an unacknowledged stop succeeded', async () => {
    const owner = await client('alice');
    await publish(owner);
    const companion = await client('alice');
    expect((await control(companion)).success).toBe(false);
    const initial = state(companion);
    companion.emit('companion_timer_watch');
    await initial;
    const offline = state(companion);
    owner.disconnect();
    expect(await offline).toEqual({ available: false, timers: [] });
    expect((await control(companion)).success).toBe(false);
  });
});
