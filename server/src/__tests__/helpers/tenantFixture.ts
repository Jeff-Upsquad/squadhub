import type { Tables } from './fakeSupabase';

export const ALICE = '00000000-0000-4000-8000-0000000000a1';
export const BOB = '00000000-0000-4000-8000-0000000000b1';
export const ACME = '00000000-0000-4000-8000-00000000aaaa';
export const BOLT = '00000000-0000-4000-8000-00000000bbbb';
// Shared workspace S (Slack-Connect style, hosted by Acme): Tina (a talent with
// her own account T) is a direct member; Bob reaches S as owner of Bolt, a
// participant account linked through shared_workspace_links; Ron WAS a member
// of S and has been removed — only stale resource_memberships remain.
export const TINA = '00000000-0000-4000-8000-0000000000c1';
export const RON = '00000000-0000-4000-8000-0000000000d1';
export const SHARED = '00000000-0000-4000-8000-00000000cccc';
export const TALENT = '00000000-0000-4000-8000-00000000dddd';
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const db: Tables = {
  users: [
    { id: ALICE, email: 'alice@example.test', display_name: 'Alice', status: 'active', user_type: 'client' },
    { id: BOB, email: 'bob@example.test', display_name: 'Bob', status: 'active', user_type: 'client' },
    { id: TINA, email: 'tina@example.test', display_name: 'Tina', status: 'active', user_type: 'partner' },
    { id: RON, email: 'ron@example.test', display_name: 'Ron', status: 'active', user_type: 'partner' },
  ],
  workspaces: [
    { id: ACME, name: 'Acme', kind: 'business', status: 'active', created_at: '2026-01-01' },
    { id: BOLT, name: 'Bolt', kind: 'business', status: 'active', created_at: '2026-01-02' },
    { id: SHARED, name: 'Acme x Tina', kind: 'shared', status: 'active', host_workspace_id: ACME, created_at: '2026-01-03' },
    { id: TALENT, name: 'Tina', kind: 'talent', status: 'active', created_at: '2026-01-04' },
  ],
  workspace_members: [
    { id: id(1), workspace_id: ACME, user_id: ALICE, role: 'owner' },
    { id: id(2), workspace_id: BOLT, user_id: BOB, role: 'owner' },
    { id: id(3), workspace_id: SHARED, user_id: TINA, role: 'member' },
    { id: id(4), workspace_id: TALENT, user_id: TINA, role: 'owner' },
  ],
  shared_workspace_links: [
    { id: id(5), shared_workspace_id: SHARED, participant_workspace_id: BOLT, status: 'active' },
  ],
  spaces: [
    { id: id(10), workspace_id: ACME, name: 'Acme space', created_by: ALICE, kind: 'normal' },
    { id: id(11), workspace_id: BOLT, name: 'Bolt space', created_by: BOB, kind: 'normal' },
    { id: id(12), workspace_id: SHARED, name: 'Shared design space', created_by: ALICE, kind: 'normal', status: 'active' },
  ],
  folders: [
    { id: id(15), workspace_id: BOLT, space_id: id(11), name: 'Bolt folder', created_by: BOB, status: 'active' },
  ],
  lists: [
    { id: id(20), workspace_id: ACME, space_id: id(10), name: 'Acme list', created_by: ALICE },
    { id: id(21), workspace_id: BOLT, space_id: id(11), name: 'Bolt list', created_by: BOB },
    { id: id(22), workspace_id: SHARED, space_id: id(12), name: 'Shared list', created_by: ALICE, status: 'active' },
    { id: id(23), workspace_id: SHARED, space_id: id(12), name: 'Locked shared list', created_by: ALICE, is_locked: true, status: 'active' },
  ],
  tasks: [
    { id: id(30), workspace_id: ACME, list_id: id(20), title: 'Acme task', status: 'todo', assignee_ids: [ALICE], created_by: ALICE, recurrence: null },
    // A Bolt task that (wrongly) lists Alice as assignee — e.g. she was removed
    // from Bolt. It must never surface for her.
    { id: id(31), workspace_id: BOLT, list_id: id(21), title: 'Bolt secret task', status: 'todo', assignee_ids: [ALICE, BOB], created_by: BOB, recurrence: null },
    { id: id(32), workspace_id: SHARED, list_id: id(22), title: 'Shared task', status: 'todo', assignee_ids: [TINA], created_by: ALICE, recurrence: null },
  ],
  channels: [
    { id: id(40), workspace_id: ACME, name: 'general', is_private: false, created_by: ALICE },
    { id: id(41), workspace_id: BOLT, name: 'general', is_private: false, created_by: BOB },
    { id: id(42), workspace_id: SHARED, name: 'design-room', is_private: true, created_by: ALICE },
    { id: id(43), workspace_id: SHARED, name: 'shared-lobby', is_private: false, created_by: ALICE },
  ],
  dm_conversations: [{ id: id(50), workspace_id: BOLT }],
  dm_participants: [{ conversation_id: id(50), user_id: BOB }],
  messages: [
    { id: id(60), workspace_id: ACME, channel_id: id(40), sender_id: ALICE, content: 'hello acme', is_deleted: false, created_at: '2026-02-01' },
    { id: id(61), workspace_id: BOLT, channel_id: id(41), sender_id: BOB, content: 'bolt only', is_deleted: false, created_at: '2026-02-01' },
    { id: id(62), workspace_id: BOLT, dm_conversation_id: id(50), sender_id: BOB, content: 'bolt dm', is_deleted: false, created_at: '2026-02-01' },
  ],
  notifications: [
    { id: id(70), workspace_id: ACME, user_id: ALICE, type: 'task_assigned', title: 'acme note', is_read: false, created_at: '2026-02-02' },
    { id: id(71), workspace_id: BOLT, user_id: ALICE, type: 'task_assigned', title: 'bolt note', is_read: false, created_at: '2026-02-03' },
  ],
  resource_memberships: [
    { id: id(140), workspace_id: SHARED, resource_type: 'space', resource_id: id(12), user_id: TINA, access_level: 'member' },
    { id: id(141), workspace_id: SHARED, resource_type: 'channel', resource_id: id(42), user_id: TINA, access_level: 'member' },
    { id: id(142), workspace_id: SHARED, resource_type: 'list', resource_id: id(23), user_id: TINA, access_level: 'member' },
    // Ron was removed from S: these rows are stale and must grant nothing.
    { id: id(143), workspace_id: SHARED, resource_type: 'space', resource_id: id(12), user_id: RON, access_level: 'manager' },
    { id: id(144), workspace_id: SHARED, resource_type: 'channel', resource_id: id(42), user_id: RON, access_level: 'member' },
    // A stale grant for Tina on a Bolt list she never belonged to.
    { id: id(145), workspace_id: BOLT, resource_type: 'list', resource_id: id(21), user_id: TINA, access_level: 'member' },
  ],
  goals: [{ id: id(80), workspace_id: BOLT, project_id: id(81), name: 'Bolt goal', created_by: BOB, assignee_ids: [] }],
  goal_projects: [{ id: id(81), workspace_id: BOLT, name: 'Bolt project', created_by: BOB }],
  task_checklists: [{ id: id(85), workspace_id: BOLT, task_id: id(31), title: 'bolt checklist', position: 0 }],
  task_checklist_items: [{ id: id(86), workspace_id: BOLT, checklist_id: id(85), content: 'bolt item', is_done: false, position: 0 }],
  huddles: [{ id: id(90), workspace_id: BOLT, channel_id: id(41), code: 'boltcode01', room_name: 'huddle-bolt', started_by: BOB, ended_at: null, allow_guests: false }],
  squad_notes: [{ id: id(100), workspace_id: BOLT, owner_id: BOB, title: 'bolt note page', deleted_at: null, root_id: id(100), parent_id: null }],
  timer_sessions: [{ id: id(110), workspace_id: SHARED, user_id: RON, timer_type: 'work', context: 'default', date: '2026-02-01', start_time: '2026-02-01T09:00:00Z', end_time: '2026-02-01T10:00:00Z', duration_seconds: 3600 }],
  list_views: [{ id: id(120), workspace_id: BOLT, list_id: id(21), view_type: 'list', name: 'Bolt view', is_private: false, is_default: true }],
  task_attachments: [{ id: id(130), workspace_id: BOLT, task_id: id(31), object_key: 'tasks/x/secret.pdf', file_name: 'secret.pdf', mime_type: 'application/pdf' }],
};

