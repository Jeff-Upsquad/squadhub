import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, logActivity } = vi.hoisted(() => ({ from: vi.fn(), logActivity: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from } }));
vi.mock('../utils/taskActivity', () => ({ logTaskActivity: logActivity }));
import { ensureAssigneeOnTimeLogged } from '../utils/taskTime';

describe('time-tracked assignee fallback', () => {
  let update: ReturnType<typeof vi.fn>;
  let guard: ReturnType<typeof vi.fn>;
  let updatedRows: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows = vi.fn().mockResolvedValue({ data: [{ id: 'task' }], error: null });
    guard = vi.fn().mockReturnValue({ select: updatedRows });
    update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ or: guard }) });
    from.mockImplementation((table) => table === 'tasks'
      ? { update }
      : { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { display_name: 'Asha' } }),
        }) }) });
  });

  it.each([null, []])('attributes automatic assignment to the logger and explains it in activity (%s)', async (assignees) => {
    await ensureAssigneeOnTimeLogged('task', 'logger', assignees);
    // The DB notification trigger excludes recipients matching last_modified_by.
    expect(update).toHaveBeenCalledWith({ assignee_ids: ['logger'], last_modified_by: 'logger' });
    expect(guard).toHaveBeenCalledWith('assignee_ids.is.null,assignee_ids.eq.{}');
    expect(logActivity).toHaveBeenCalledWith('task', 'logger', [{
      event_type: 'assignee_added',
      new_value: { id: 'logger', name: 'Asha', source: 'time_tracked' },
    }]);
  });

  it('preserves existing assignees', async () => {
    await ensureAssigneeOnTimeLogged('task', 'logger', ['owner']);
    expect(from).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('does not log a duplicate when another assignment wins the race', async () => {
    updatedRows.mockResolvedValue({ data: [], error: null });
    await ensureAssigneeOnTimeLogged('task', 'logger', []);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('does not report an assignment when the update fails', async () => {
    updatedRows.mockResolvedValue({ data: null, error: { message: 'failed' } });
    await ensureAssigneeOnTimeLogged('task', 'logger', []);
    expect(logActivity).not.toHaveBeenCalled();
  });
});
