import type { Server } from 'socket.io';
import { reconcileHuddles } from '../routes/huddles';

/**
 * Huddle presence backstop. Members report join/leave themselves, but a tab
 * that crashes or loses its network never calls leave — so every 30s we ask
 * LiveKit who is really in each live room, mark the missing ones as left, and
 * end huddles that have gone empty. No-ops when LiveKit isn't configured.
 */
const SWEEP_INTERVAL_MS = 30_000;

export function startHuddleSweeper(io: Server): void {
  let running = false;
  const sweep = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await reconcileHuddles(io);
    } catch (err) {
      console.error('[huddles] sweep failed:', err);
    } finally {
      running = false;
    }
  };
  setInterval(sweep, SWEEP_INTERVAL_MS);
  console.log('[Huddles] presence sweeper initialized (30s interval)');
}
