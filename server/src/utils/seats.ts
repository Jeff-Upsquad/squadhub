/**
 * Staff seats per account (plans.free_staff_seats).
 *
 * A seat is a non-owner `admin`/`member` of a business or talent account, plus
 * each pending admin/member invitation. Guests, the owner and Upsquad staff
 * (is_upsquad_staff) never take a seat. Shared and internal_staff workspaces
 * have no plan and no limit. An account without a plan falls back to the
 * default plan.
 */
import { supabaseAdmin } from '../supabase';

export class SeatLimitError extends Error {
  readonly code = 'seat_limit_reached';
  constructor(public used: number, public limit: number) {
    super(
      `Your plan includes ${limit} staff seat${limit === 1 ? '' : 's'} and all of them are in use. ` +
        'Remove a member or ask Squad Hub to upgrade your plan.',
    );
    this.name = 'SeatLimitError';
  }
}

export interface SeatInfo {
  used: number;
  limit: number | null;
  plan: { id: string; name: string; price_inr: number; free_staff_seats: number; is_default: boolean } | null;
}

export async function getSeatInfo(workspaceId: string): Promise<SeatInfo> {
  const { data: ws } = await supabaseAdmin
    .from('workspaces')
    .select('id, kind, owner_user_id, plan_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!ws) return { used: 0, limit: null, plan: null };

  const planQuery = supabaseAdmin.from('plans').select('id, name, price_inr, free_staff_seats, is_default');
  const { data: plan } = ws.plan_id
    ? await planQuery.eq('id', ws.plan_id).maybeSingle()
    : ws.kind === 'business' || ws.kind === 'talent'
      ? await planQuery.eq('is_default', true).limit(1).maybeSingle()
      : { data: null };

  const { data: members } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, role, is_upsquad_staff')
    .eq('workspace_id', workspaceId);
  const memberSeats = ((members || []) as any[]).filter(
    (m) => (m.role === 'admin' || m.role === 'member') && !m.is_upsquad_staff && m.user_id !== ws.owner_user_id,
  ).length;

  const { data: invites } = await supabaseAdmin
    .from('invitations')
    .select('id, role')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending');
  const inviteSeats = ((invites || []) as any[]).filter((i) => i.role === 'admin' || i.role === 'member').length;

  const limited = ws.kind === 'business' || ws.kind === 'talent';
  return {
    used: memberSeats + inviteSeats,
    limit: limited && plan ? Number((plan as any).free_staff_seats) : null,
    plan: (plan as any) ?? null,
  };
}

/** Throws SeatLimitError when adding one more `role` seat would exceed the plan. */
export async function assertSeatAvailable(workspaceId: string, role: string): Promise<void> {
  if (role !== 'admin' && role !== 'member') return;
  const info = await getSeatInfo(workspaceId);
  if (info.limit != null && info.used >= info.limit) throw new SeatLimitError(info.used, info.limit);
}
