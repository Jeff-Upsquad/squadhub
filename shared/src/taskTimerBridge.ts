/** Live task clocks are owned by the web app, which also owns split-time logging. */
export interface CompanionTaskTimer {
  taskId: string;
  taskTitle: string;
  listId: string;
  listName?: string;
  estimateSeconds?: number;
  status: 'running' | 'paused';
  /** Wall-clock session time at sampledAt; paused time never advances. */
  elapsedSeconds: number;
  sampledAt: number;
  /** Stable across pause/resume; used to seed 30-minute reminders. */
  sessionId: string;
}

export interface CompanionTimerSnapshot {
  available: boolean;
  timers: CompanionTaskTimer[];
}

export interface CompanionTimerCommand {
  requestId: string;
  action: 'pause' | 'resume' | 'stop' | 'pause_all';
  taskId?: string;
}

export interface CompanionTimerReply {
  success: boolean;
  error?: string;
}
