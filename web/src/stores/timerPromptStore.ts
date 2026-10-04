import { create } from 'zustand';

interface ConfirmPrompt {
  kind: 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

interface KeepStopPrompt {
  kind: 'keep-stop';
  title: string;
  message: string;
  keepLabel: string;
  stopLabel: string;
}

export type TimerPrompt = ConfirmPrompt | KeepStopPrompt;
export type TimerChoice = 'confirm' | 'cancel' | 'keep' | 'stop' | null;

export const useTimerPromptStore = create<{
  prompt: TimerPrompt | null;
  resolve: ((choice: TimerChoice) => void) | null;
}>(() => ({ prompt: null, resolve: null }));

function showPrompt<T>(prompt: TimerPrompt, map: (choice: TimerChoice) => T): Promise<T> {
  // Ignore repeated clicks while the current decision is pending.
  if (useTimerPromptStore.getState().prompt) {
    return Promise.resolve(map(null));
  }
  return new Promise((resolve) => {
    useTimerPromptStore.setState({ prompt, resolve: (choice) => {
      useTimerPromptStore.setState({ prompt: null, resolve: null });
      resolve(map(choice));
    } });
  });
}

export function askTimerPrompt(prompt: Omit<ConfirmPrompt, 'kind'>): Promise<boolean> {
  return showPrompt({ ...prompt, kind: 'confirm' }, (choice) => choice === 'confirm');
}

export function askTaskBreakChoice(prompt: Omit<KeepStopPrompt, 'kind'>): Promise<'keep' | 'stop' | null> {
  return showPrompt({ ...prompt, kind: 'keep-stop' }, (choice) =>
    choice === 'keep' ? 'keep' : choice === 'stop' ? 'stop' : null,
  );
}
