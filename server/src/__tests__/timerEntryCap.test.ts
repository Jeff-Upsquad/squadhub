import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabaseAdmin: {} }));

import { capTimerSeconds, MAX_TIMER_ENTRY_SECONDS } from '../utils/taskTime';

describe('capTimerSeconds', () => {
  it('caps timer time at 6 hours', () => {
    expect(MAX_TIMER_ENTRY_SECONDS).toBe(21600);
    expect(capTimerSeconds(406380, 'timer')).toBe(21600);
    expect(capTimerSeconds(2340, 'timer')).toBe(2340);
  });
  it('leaves manually logged time alone', () => {
    expect(capTimerSeconds(406380, 'manual')).toBe(406380);
  });
});
