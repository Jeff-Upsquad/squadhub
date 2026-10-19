import { supabaseAdmin } from '../supabase';

/** The database locks due tasks and inserts the inbox rows atomically. */
export function startTaskRemindersCron() {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const { error } = await supabaseAdmin.rpc('deliver_due_task_reminders');
      if (error) throw error;
    } catch (err) {
      console.error('[Task reminders] delivery failed:', err);
    } finally { running = false; }
  };
  void sweep();
  setInterval(() => void sweep(), 5_000);
}
