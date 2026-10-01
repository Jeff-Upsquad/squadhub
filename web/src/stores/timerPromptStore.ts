import { create } from 'zustand';

interface TimerPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

export const useTimerPromptStore = create<{
  prompt: TimerPrompt | null;
  resolve: ((accepted: boolean) => void) | null;
}>(() => ({ prompt: null, resolve: null }));

export function askTimerPrompt(prompt: TimerPrompt): Promise<boolean> {
  // Ignore repeated clicks while the current decision is pending.
  if (useTimerPromptStore.getState().prompt) return Promise.resolve(false);
  return new Promise((resolve) => {
    useTimerPromptStore.setState({ prompt, resolve: (accepted) => {
      useTimerPromptStore.setState({ prompt: null, resolve: null });
      resolve(accepted);
    } });
  });
}
