import type { QueryClient } from '@tanstack/react-query';
import api from './api';
import { askTimerPrompt } from '../stores/timerPromptStore';

export async function offerWorkTimer(qc: QueryClient, scope: { workspaceId: string | undefined; context: string }) {
  const { workspaceId, context } = scope;
  if (!workspaceId) return;
  const queryKey = ['timer-active', workspaceId, context];
  let active = qc.getQueryData<any>(queryKey);
  try {
    const response = await api.get('/timer/active', { params: { workspace_id: workspaceId, context } });
    active = response.data;
    qc.setQueryData(queryKey, active);
  } catch {
    // Preserve offline task tracking; use the last known session for the prompt.
  }
  const mode = active?.data?.session?.timer_type;
  if (mode !== 'break' && mode !== 'no_work') return;
  const accepted = await askTimerPrompt({
    title: 'Switch back to work?',
    message: `Your ${mode === 'break' ? 'break' : 'no work'} timer is running. Would you like to switch back to the work timer for this task?`,
    confirmLabel: 'Switch to work',
    cancelLabel: 'Keep current timer',
  });
  if (accepted) {
    await api.post('/timer/start', { timer_type: 'work', workspace_id: workspaceId, context });
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['timer-stats', workspaceId, context] });
  }
}
