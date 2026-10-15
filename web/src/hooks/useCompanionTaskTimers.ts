import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CompanionTaskTimer, CompanionTimerCommand, CompanionTimerReply } from '@squadhub/shared';
import { usePMStore, broadcastTimerState, type TimerState } from '../stores/pmStore';
import { useAuthStore } from '../stores/authStore';
import { connectSocket } from '../services/socket';
import api from '../services/api';
import { useParallelTimers } from './useParallelTimers';

type Details = { list?: { name?: string }; time_estimate?: number; time_tracked?: number };
const elapsed = (timer: TimerState, now: number, running: boolean) =>
  (timer.elapsedBefore || 0) + (running ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0);

/** The native companion controls the browser owner so every stop still goes
 * through normal segment splitting, work-block closing and offline time sync. */
export function useCompanionTaskTimers(userId: string | undefined, workspaceId: string | undefined) {
  const controls = useParallelTimers();
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId || !workspaceId) return;
    const socket = connectSocket();
    const details = new Map<string, Details>();
    const loading = new Set<string>();
    let disposed = false;
    let executing = false;
    const completed = new Map<string, Promise<CompanionTimerReply>>();
    const publish = () => {
      if (disposed || !socket.connected) return;
      const state = usePMStore.getState();
      const now = Date.now();
      const mapTimer = (timer: TimerState, running: boolean): CompanionTaskTimer => {
        if (!details.has(timer.taskId) && !loading.has(timer.taskId)) {
          loading.add(timer.taskId);
          void api.get(`/pm/tasks/${timer.taskId}`).then(({ data }) => {
            if (!disposed) details.set(timer.taskId, data.data || {});
          }).catch(() => {}).finally(() => { loading.delete(timer.taskId); });
        }
        const detail = details.get(timer.taskId);
        return {
          taskId: timer.taskId, taskTitle: timer.taskTitle, listId: timer.listId,
          ...(detail?.list?.name ? { listName: detail.list.name } : {}),
          ...(detail?.time_estimate ? { estimateSeconds: detail.time_estimate * 60 } : {}),
          status: running ? 'running' : 'paused', elapsedSeconds: elapsed(timer, now, running),
          sampledAt: now, sessionId: timer.sessionId || `${timer.taskId}:${timer.startedAt}`,
        };
      };
      socket.emit('companion_timer_publish', [
        ...state.timers.map(t => mapTimer(t, true)),
        ...state.pausedTimers.filter(t => !state.timers.some(r => r.taskId === t.taskId)).map(t => mapTimer(t, false)),
      ]);
    };
    const broadcast = () => {
      const state = usePMStore.getState();
      broadcastTimerState(state.timers, state.timerSegmentStart);
      publish();
    };
    const pause = async (timer: TimerState) => {
      const state = usePMStore.getState();
      usePMStore.setState({ pausedTimers: [...state.pausedTimers.filter(t => t.taskId !== timer.taskId), {
        ...timer, elapsedBefore: elapsed(timer, Date.now(), true),
        sessionId: timer.sessionId || `${timer.taskId}:${timer.startedAt}`,
      }] });
      await controlsRef.current.stopTimer(timer.taskId);
    };
    const execute = async (command: CompanionTimerCommand): Promise<CompanionTimerReply> => {
      if (disposed || useAuthStore.getState().user?.id !== userId) return { success: false, error: 'Sign in again to control task timers.' };
      if (executing) return { success: false, error: 'A timer action is still in progress.' };
      executing = true;
      try {
        const state = usePMStore.getState();
        if (command.action === 'pause_all') {
          for (const timer of [...state.timers]) await pause(timer);
        } else if (command.action === 'pause') {
          const timer = state.timers.find(t => t.taskId === command.taskId);
          if (!timer) throw new Error('This task is no longer running.');
          await pause(timer);
        } else if (command.action === 'stop') {
          if (state.timers.some(t => t.taskId === command.taskId)) await controlsRef.current.stopTimer(command.taskId!);
          usePMStore.setState({ pausedTimers: usePMStore.getState().pausedTimers.filter(t => t.taskId !== command.taskId) });
        } else {
          const paused = state.pausedTimers.find(t => t.taskId === command.taskId);
          if (!paused) throw new Error('This task is no longer paused.');
          // Explicit resume means return to Work; avoid opening a browser-only prompt.
          const userType = useAuthStore.getState().user?.user_type;
          const context = userType === 'partner' || userType === 'partner_employee' ? 'partners' : 'teammates';
          const active = await api.get('/timer/active', { params: { workspace_id: workspaceId, context } });
          if (disposed || useAuthStore.getState().user?.id !== userId) throw new Error('Your account changed. Try again.');
          if (active.data?.data?.session?.timer_type !== 'work') {
            await api.post('/timer/start', { timer_type: 'work', workspace_id: workspaceId, context });
            void qc.invalidateQueries({ queryKey: ['timer-active'] });
            void qc.invalidateQueries({ queryKey: ['timer-stats'] });
          }
          const fresh = await api.get(`/pm/tasks/${paused.taskId}`);
          if (disposed || useAuthStore.getState().user?.id !== userId) throw new Error('Your account changed. Try again.');
          const started = await controlsRef.current.startTimer({
            taskId: paused.taskId, taskTitle: paused.taskTitle, listId: paused.listId,
            baseTracked: fresh.data?.data?.time_tracked ?? paused.baseTracked,
          });
          if (!started) throw new Error('Could not resume. Check the task timers in SquadHub.');
          usePMStore.setState(s => ({ timers: s.timers.map(t => t.taskId === paused.taskId
            ? { ...t, elapsedBefore: paused.elapsedBefore, sessionId: paused.sessionId } : t) }));
        }
        broadcast();
        return { success: true };
      } catch (error) {
        broadcast();
        return { success: false, error: error instanceof Error ? error.message : 'Could not update the task timer.' };
      } finally { executing = false; }
    };
    const onCommand = (command: CompanionTimerCommand, reply: (result: CompanionTimerReply) => void) => {
      if (!completed.has(command.requestId)) {
        completed.set(command.requestId, execute(command));
        if (completed.size > 50) completed.delete(completed.keys().next().value!);
      }
      void completed.get(command.requestId)!.then(reply);
    };
    socket.on('connect', publish);
    socket.on('companion_timer_command', onCommand);
    const unsubscribe = usePMStore.subscribe((state, previous) => {
      if (state.timers !== previous.timers || state.pausedTimers !== previous.pausedTimers) publish();
    });
    const interval = window.setInterval(publish, 10_000);
    publish();
    return () => {
      disposed = true;
      clearInterval(interval);
      unsubscribe();
      socket.off('connect', publish);
      socket.off('companion_timer_command', onCommand);
      if (socket.connected) socket.emit('companion_timer_unpublish');
    };
  }, [userId, workspaceId, qc]);
}
