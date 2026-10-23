import type { Tables } from './fakeSupabase';

export const ALICE = '00000000-0000-4000-8000-0000000000a1';
export const BOB = '00000000-0000-4000-8000-0000000000b1';
export const ACME = '00000000-0000-4000-8000-00000000aaaa';
export const BOLT = '00000000-0000-4000-8000-00000000bbbb';
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const db: Tables = {
  users: [
    { id: ALICE, email: 'alice@example.test', display_name: 'Alice', status: 'active', user_type: 'client' },
    { id: BOB, email: 'bob@example.test', display_name: 'Bob', status: 'active', user_type: 'client' },
  ],
  workspaces: [
    { id: ACME, name: 'Acme', kind: 'business', status: 'active', created_at: '2026-01-01' },
    { id: BOLT, name: 'Bolt', kind: 'business', status: 'active', created_at: '2026-01-02' },
  ],
  workspace_members: [
    { id: id(1), workspace_id: ACME, user_id: ALICE, role: 'owner' },
    { id: id(2), workspace_id: BOLT, user_id: BOB, role: 'owner' },
  ],
  shared_workspace_links: [],
  spaces: [
    { id: id(10), workspace_id: ACME, name: 'Acme space', created_by: ALICE, kind: 'normal' },
    { id: id(11), workspace_id: BOLT, name: 'Bolt space', created_by: BOB, kind: 'normal' },
  ],
  lists: [
    { id: id(20), workspace_id: ACME, space_id: id(10), name: 'Acme list', created_by: ALICE },
    { id: id(21), workspace_id: BOLT, space_id: id(11), name: 'Bolt list', created_by: BOB },
  ],
  tasks: [
    { id: id(30), workspace_id: ACME, list_id: id(20), title: 'Acme task', status: 'todo', assignee_ids: [ALICE], created_by: ALICE, recurrence: null },
    // A Bolt task that (wrongly) lists Alice as assignee — e.g. she was removed
    // from Bolt. It must never surface for her.
    { id: id(31), workspace_id: BOLT, list_id: id(21), title: 'Bolt secret task', status: 'todo', assignee_ids: [ALICE, BOB], created_by: BOB, recurrence: null },
  ],
  channels: [
    { id: id(40), workspace_id: ACME, name: 'general', is_private: false, created_by: ALICE },
    { id: id(41), workspace_id: BOLT, name: 'general', is_private: false, created_by: BOB },
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
  resource_memberships: [],
};

