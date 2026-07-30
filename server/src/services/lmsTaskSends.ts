import { supabaseAdmin } from '../supabase';
import { getUserIdsByRoleId } from '../utils/roles';
import { notifyLms } from './lmsAuthoring';
import {
  mirrorResourceSend,
  deleteResourceRecipientTasks,
} from './taskMirror';

// ============================================================
// Resources "send as task" (migration 166)
//
// An admin sends a Resources item — whole item, a lesson, or a section (heading)
// within a lesson — to a picked set of users/roles. Picking grants them viewer
// access and assigns the task. Each resolved user becomes an
// lms_task_send_recipients row, which taskMirror turns into one personal task
// (source_kind 'course'|'sop'|'post'). The mirror task carries completion, so the
// admin tracker just reads task status ('done'/'closed' = completed).
// ============================================================

export type SendScope = 'item' | 'lesson' | 'section';
export interface Principal {
  type: 'user' | 'role';
  id: string;
}
export interface SectionRef {
  anchor: string;
  label: string;
  index?: number | null;
}

// Home-card bucket for an item, from its (kind, track). SOP track wins; a
// learning course → 'course'; a learning post → 'post'.
export function sourceKindForItem(item: { kind: string; track: string }): 'course' | 'sop' | 'post' {
  if (item.track === 'sop') return 'sop';
  return item.kind === 'course' ? 'course' : 'post';
}

// Expand picked principals to concrete user ids (roles → members), dropping
// banned/suspended and unknown users.
export async function resolvePrincipalUserIds(principals: Principal[]): Promise<string[]> {
  const ids = new Set<string>();
  const roleIds: string[] = [];
  for (const p of principals) {
    if (p.type === 'user') ids.add(p.id);
    else if (p.type === 'role') roleIds.push(p.id);
  }
  for (const rid of roleIds) {
    for (const uid of await getUserIdsByRoleId(rid)) ids.add(uid);
  }
  if (!ids.size) return [];
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, status')
    .in('id', Array.from(ids));
  return (data || [])
    .filter((u: any) => u.status !== 'banned' && u.status !== 'suspended')
    .map((u: any) => u.id);
}

// Grant viewer access to the picked principals so recipients can open the
// content. Never downgrades an existing higher grant (ignoreDuplicates).
async function grantViewerAccess(itemId: string, principals: Principal[], grantedBy: string | null): Promise<void> {
  if (!principals.length) return;
  const rows = principals.map((p) => ({
    item_id: itemId,
    principal_type: p.type,
    principal_id: p.id,
    access_level: 'viewer',
    granted_by: grantedBy,
  }));
  await supabaseAdmin
    .from('lms_item_shares')
    .upsert(rows, { onConflict: 'item_id,principal_type,principal_id', ignoreDuplicates: true });
}

async function insertRecipients(sendId: string, userIds: string[], version: number): Promise<void> {
  if (!userIds.length) return;
  const rows = userIds.map((uid) => ({ send_id: sendId, user_id: uid, version }));
  await supabaseAdmin
    .from('lms_task_send_recipients')
    .upsert(rows, { onConflict: 'send_id,user_id' });
}

export interface CreateSendParams {
  itemId: string;
  scope: SendScope;
  lessonId?: string | null;
  section?: SectionRef | null;
  title: string;
  dueDate?: string | null;
  autoResend?: boolean;
  principals: Principal[];
  createdBy: string | null;
}

// Create a send, fan out recipients, grant access, mirror tasks, notify.
export async function createSend(params: CreateSendParams): Promise<{ sendId: string; recipientCount: number }> {
  const { itemId, scope, principals, createdBy } = params;

  const { data: item } = await supabaseAdmin
    .from('lms_items')
    .select('id, kind, track, title')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) throw new Error('Item not found');

  if ((scope === 'lesson' || scope === 'section') && !params.lessonId) {
    throw new Error('lesson_id is required for lesson/section scope');
  }
  if (scope === 'section' && !params.section?.anchor) {
    throw new Error('section anchor is required for section scope');
  }

  const sourceKind = sourceKindForItem(item as any);

  const { data: send, error: sendErr } = await supabaseAdmin
    .from('lms_task_sends')
    .insert({
      item_id: itemId,
      scope,
      lesson_id: params.lessonId ?? null,
      section_anchor: params.section?.anchor ?? null,
      section_label: params.section?.label ?? null,
      section_index: params.section?.index ?? null,
      title: params.title,
      due_date: params.dueDate ?? null,
      auto_resend: !!params.autoResend,
      picked_principals: principals.map((p) => ({ type: p.type, id: p.id })),
      source_kind: sourceKind,
      version: 1,
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (sendErr || !send) throw new Error(sendErr?.message || 'Failed to create send');

  const sendId = (send as any).id as string;

  await grantViewerAccess(itemId, principals, createdBy);
  const userIds = await resolvePrincipalUserIds(principals);
  await insertRecipients(sendId, userIds, 1);
  await mirrorResourceSend(sendId, { reopen: false });

  await notifyLms(
    userIds.map((uid) => ({ user_id: uid, type: 'lms_assigned' as any, title: params.title })),
    itemId,
    createdBy,
    { send_id: sendId, scope, kind: sourceKind },
  );

  return { sendId, recipientCount: userIds.length };
}

// Re-fire a send: re-expand picked principals (catch new role members), add any
// new recipients, and REOPEN every recipient's task so they re-acknowledge the
// updated content.
export async function resendSend(sendId: string): Promise<{ recipientCount: number }> {
  const { data: send } = await supabaseAdmin
    .from('lms_task_sends')
    .select('id, item_id, title, scope, source_kind, version, picked_principals, created_by')
    .eq('id', sendId)
    .maybeSingle();
  if (!send) throw new Error('Send not found');

  const principals: Principal[] = ((send as any).picked_principals || []).map((p: any) => ({
    type: p.type,
    id: p.id,
  }));
  const nextVersion = ((send as any).version || 1) + 1;

  await supabaseAdmin.from('lms_task_sends').update({ version: nextVersion }).eq('id', sendId);
  await grantViewerAccess((send as any).item_id, principals, (send as any).created_by);

  const userIds = await resolvePrincipalUserIds(principals);
  await insertRecipients(sendId, userIds, nextVersion);
  await mirrorResourceSend(sendId, { reopen: true });

  await notifyLms(
    userIds.map((uid) => ({ user_id: uid, type: 'lms_updated' as any, title: (send as any).title })),
    (send as any).item_id,
    (send as any).created_by,
    { send_id: sendId, scope: (send as any).scope, kind: (send as any).source_kind, resend: true },
  );

  return { recipientCount: userIds.length };
}

// Auto-resend hook: re-fire every auto_resend send on an item when its content
// changes. When a specific lesson changed, only item-scope and that lesson's
// lesson/section sends re-fire; otherwise (item-level change) all re-fire.
export async function autoResendForItem(itemId: string, changedLessonId?: string | null): Promise<void> {
  const { data: sends } = await supabaseAdmin
    .from('lms_task_sends')
    .select('id, scope, lesson_id')
    .eq('item_id', itemId)
    .eq('auto_resend', true);
  for (const s of sends || []) {
    const scope = (s as any).scope as SendScope;
    if (changedLessonId && scope !== 'item' && (s as any).lesson_id !== changedLessonId) continue;
    await resendSend((s as any).id);
  }
}

// Unsend: delete the recipients' mirror tasks, then the send (cascade removes
// recipients).
export async function deleteSend(sendId: string): Promise<void> {
  const { data: recipients } = await supabaseAdmin
    .from('lms_task_send_recipients')
    .select('id')
    .eq('send_id', sendId);
  await deleteResourceRecipientTasks((recipients || []).map((r: any) => r.id));
  await supabaseAdmin.from('lms_task_sends').delete().eq('id', sendId);
}

// ---- tracking ---------------------------------------------------------------

const DONE_STATUSES = new Set(['done', 'closed']);

// Sends for an item with completed/total counts (for the tracker list).
export async function listSendsForItem(itemId: string): Promise<any[]> {
  const { data: sends } = await supabaseAdmin
    .from('lms_task_sends')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false });
  if (!sends?.length) return [];

  const { data: recipients } = await supabaseAdmin
    .from('lms_task_send_recipients')
    .select('id, send_id')
    .in('send_id', sends.map((s: any) => s.id));
  const recipIds = (recipients || []).map((r: any) => r.id);

  const statusByRecip = await taskStatusByRecipient(recipIds);

  return sends.map((s: any) => {
    const mine = (recipients || []).filter((r: any) => r.send_id === s.id);
    const completed = mine.filter((r: any) => DONE_STATUSES.has(statusByRecip.get(r.id) || '')).length;
    return { ...s, total: mine.length, completed };
  });
}

// Per-recipient completion for one send (roster).
export async function recipientsForSend(sendId: string): Promise<any[]> {
  const { data: recipients } = await supabaseAdmin
    .from('lms_task_send_recipients')
    .select('id, version, user:users(id, display_name, email, avatar_url, user_type)')
    .eq('send_id', sendId);
  if (!recipients?.length) return [];
  const statusByRecip = await taskStatusByRecipient(recipients.map((r: any) => r.id));
  return recipients.map((r: any) => ({
    id: r.id,
    version: r.version,
    user: r.user,
    completed: DONE_STATUSES.has(statusByRecip.get(r.id) || ''),
  }));
}

// Map recipient id -> its mirror task status (source_id = recipient id).
async function taskStatusByRecipient(recipientIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!recipientIds.length) return map;
  const { data: tasks } = await supabaseAdmin
    .from('tasks')
    .select('source_id, status')
    .in('source_id', recipientIds);
  for (const t of tasks || []) map.set((t as any).source_id, (t as any).status);
  return map;
}
