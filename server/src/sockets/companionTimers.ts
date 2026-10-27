import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { CompanionTaskTimer, CompanionTimerCommand, CompanionTimerReply } from '@squadhub/shared';

const timersSchema = z.array(z.object({
  // Tasks can live outside any list; the web sends `task.list_id || ''` then.
  // Requiring a UUID here silently dropped the whole publish, leaving the
  // companion stuck on "Connect your task timers" for list-less tasks.
  taskId: z.string().uuid(), taskTitle: z.string().max(500),
  listId: z.string().uuid().or(z.literal('')),
  listName: z.string().max(500).optional(), estimateSeconds: z.number().finite().nonnegative().optional(),
  status: z.enum(['running', 'paused']), elapsedSeconds: z.number().finite().nonnegative(),
  sampledAt: z.number().finite().nonnegative(), sessionId: z.string().max(100),
})).max(100);
const commandSchema = z.object({
  requestId: z.string().uuid(), action: z.enum(['pause', 'resume', 'stop', 'pause_all']),
  taskId: z.string().uuid().optional(),
}).refine(c => c.action === 'pause_all' || !!c.taskId);

/** Relay only within the authenticated user's sockets. One browser executes each
 * command; broadcasting a stop to every tab would log the same segment twice. */
export function installCompanionTimers(io: Server<any, any>, commandTimeoutMs = 12_000) {
  const publishers = new Map<string, Map<string, { socket: Socket; timers: CompanionTaskTimer[]; at: number }>>();
  const replies = new Map<string, Map<string, Promise<CompanionTimerReply>>>();
  const busy = new Set<string>();
  const owners = new Map<string, string>();
  const seenSessions = new Map<string, Set<string>>();
  const dropLoggedAt = new Map<string, number>();
  const ownerCounts = new Map<string, number>();
  const room = (userId: string) => `companion_timers:${userId}`;
  const owner = (userId: string) => {
    const pinned = publishers.get(userId)?.get(owners.get(userId) || '');
    if (pinned?.socket.connected && Date.now() - pinned.at < 90_000) return pinned;
    return [...(publishers.get(userId)?.values() || [])]
    .filter(p => p.socket.connected && Date.now() - p.at < 90_000)
    .sort((a, b) => Number(b.timers.length > 0) - Number(a.timers.length > 0) || b.at - a.at)[0];
  };
  const publish = (userId: string) => {
    const current = owner(userId);
    // Log relay-state transitions only: publisher appearing/leaving or its
    // timer count changing. A steady 10s publish stream must not spam logs.
    const count = current ? current.timers.length : -1;
    if (count !== ownerCounts.get(userId)) {
      ownerCounts.set(userId, count);
      console.log(`[companion] relay state: user ${userId} → ${current
        ? `${current.timers.length} timer(s) from socket ${current.socket.id}`
        : 'no publisher'}`);
    }
    io.to(room(userId)).emit('companion_timer_state', { available: !!current, timers: current?.timers || [] });
  };

  io.on('connection', (socket: Socket) => {
    const userId = (socket as Socket & { userId: string }).userId;
    if (!userId) return;
    socket.on('companion_timer_watch', () => {
      void socket.join(room(userId));
      console.log(`[companion] watcher joined: user ${userId} socket ${socket.id}`);
      publish(userId);
    });
    socket.on('companion_timer_publish', (raw: unknown) => {
      const parsed = timersSchema.safeParse(raw);
      if (!parsed.success) {
        // A dropped publish makes the user's companion claim the browser is
        // closed. Surface why, rate-limited — publishes retry every 10s.
        const at = Date.now();
        if (at - (dropLoggedAt.get(userId) || 0) > 60_000) {
          dropLoggedAt.set(userId, at);
          console.warn(`[companion] dropped invalid timer publish from ${userId}:`,
            parsed.error.issues[0]?.path.join('.') || 'payload', parsed.error.issues[0]?.message);
        }
        return;
      }
      if (!publishers.has(userId)) publishers.set(userId, new Map());
      const prior = owner(userId);
      const seen = seenSessions.get(userId) || new Set<string>();
      const hasNewSession = parsed.data.some(timer => !seen.has(timer.sessionId));
      if (!prior || (!prior.timers.length && hasNewSession)) owners.set(userId, socket.id);
      parsed.data.forEach(timer => seen.add(timer.sessionId));
      while (seen.size > 200) seen.delete(seen.values().next().value!);
      seenSessions.set(userId, seen);
      publishers.get(userId)!.set(socket.id, { socket, timers: parsed.data, at: Date.now() });
      publish(userId);
    });
    const unpublish = () => {
      publishers.get(userId)?.delete(socket.id);
      if (!publishers.get(userId)?.size) { publishers.delete(userId); owners.delete(userId); seenSessions.delete(userId); replies.delete(userId); }
      publish(userId);
    };
    socket.on('companion_timer_unpublish', unpublish);
    socket.on('disconnect', unpublish);
    socket.on('companion_timer_control', async (raw: unknown, reply: unknown) => {
      if (typeof reply !== 'function') return;
      const respond = reply as (result: CompanionTimerReply) => void;
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) { respond({ success: false, error: 'Invalid timer action.' }); return; }
      const command: CompanionTimerCommand = parsed.data;
      const existing = replies.get(userId)?.get(command.requestId);
      if (existing) { respond(await existing); return; }
      const current = owner(userId);
      if (!current) { respond({ success: false, error: 'Open SquadHub in your browser to control task timers.' }); return; }
      if (busy.has(userId)) { respond({ success: false, error: 'A timer action is still in progress.' }); return; }
      if (command.taskId && !current.timers.some(t => t.taskId === command.taskId)) {
        respond({ success: false, error: 'This task timer has changed. Try again.' }); return;
      }
      busy.add(userId);
      const result = new Promise<CompanionTimerReply>(resolve => {
        current.socket.timeout(commandTimeoutMs).emit('companion_timer_command', command,
          (error: Error | null, value: CompanionTimerReply) => {
            busy.delete(userId);
            resolve(error ? { success: false, error: 'The browser did not respond. Check SquadHub before retrying.' }
              : { success: value?.success === true, ...(value?.error ? { error: String(value.error).slice(0, 300) } : {}) });
          });
      });
      if (!replies.has(userId)) replies.set(userId, new Map());
      const cache = replies.get(userId)!;
      cache.set(command.requestId, result);
      // Bounded retry cache; duplicate requests reuse the original result.
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
      respond(await result);
    });
  });
  const sweep = setInterval(() => {
    for (const [userId, clients] of publishers) {
      for (const [id, client] of clients) if (Date.now() - client.at >= 90_000) clients.delete(id);
      if (!clients.size) { publishers.delete(userId); replies.delete(userId); owners.delete(userId); seenSessions.delete(userId); }
      publish(userId);
    }
  }, 15_000);
  sweep.unref();
  io.engine.on('close', () => clearInterval(sweep));
}
