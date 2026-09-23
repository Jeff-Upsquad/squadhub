import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabaseAdmin: {}, supabaseAuth: {}, supabase: {} }));

import { checkLoggedTimeChange, highestSkillLevel } from '../utils/skills';

describe('highestSkillLevel', () => {
  it('picks the highest known level across grants', () => {
    expect(highestSkillLevel('edit_logged_time', ['reduce', 'full'])).toBe('full');
    expect(highestSkillLevel('edit_logged_time', ['full', 'reduce'])).toBe('full');
    expect(highestSkillLevel('edit_logged_time', ['reduce'])).toBe('reduce');
  });

  it('ignores unknown levels and returns null with no grants', () => {
    expect(highestSkillLevel('edit_logged_time', [])).toBeNull();
    expect(highestSkillLevel('edit_logged_time', ['bogus'])).toBeNull();
    expect(highestSkillLevel('edit_logged_time', ['bogus', 'reduce'])).toBe('reduce');
  });
});

describe('checkLoggedTimeChange', () => {
  it('blocks every change without the skill', () => {
    expect(checkLoggedTimeChange(null, 3600, 1800)).toMatch(/skill/);
    expect(checkLoggedTimeChange(null, 3600, 3600)).toMatch(/skill/);
  });

  it('lets "reduce" lower or remove time but never raise it', () => {
    expect(checkLoggedTimeChange('reduce', 3600, 1800)).toBeNull();
    expect(checkLoggedTimeChange('reduce', 3600, 0)).toBeNull(); // delete
    expect(checkLoggedTimeChange('reduce', 0, -1800)).toBeNull(); // negative log
    expect(checkLoggedTimeChange('reduce', 3600, 3600)).toBeNull(); // note/start only
    expect(checkLoggedTimeChange('reduce', 3600, 3601)).toMatch(/only reduce/);
    // Deleting a negative adjustment would put time back on.
    expect(checkLoggedTimeChange('reduce', -1800, 0)).toMatch(/only reduce/);
  });

  it('lets "full" change time either way', () => {
    expect(checkLoggedTimeChange('full', 3600, 7200)).toBeNull();
    expect(checkLoggedTimeChange('full', 3600, 60)).toBeNull();
    expect(checkLoggedTimeChange('full', -1800, 0)).toBeNull();
  });
});
