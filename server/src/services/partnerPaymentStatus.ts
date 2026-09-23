// ============================================================
// partnerPaymentStatus (service)
//
// THE payout workflow status store. One row per (month, recipient) in
// `partner_payment_statuses`; anything with no row reads as "not_processed", so
// a new month starts clean without seeding.
//
// Written from two places — the SquadHub admin module and SquadBooks (over the
// integration API) — and read by those plus the partner mini app. Before this
// existed here, SquadBooks kept the only copy in its own database and the mini
// app showed a hardcoded "pending" to partners regardless of what had actually
// been paid.
//
// INTERNAL vs PARTNER-FACING: `hold_reason` is staff-only, and `on_hold` itself
// is not shown to partners. Partner surfaces must go through
// `toPartnerFacingStatus()` and must never receive the reason text.
// ============================================================
import { supabaseAdmin } from '../supabase';

export const PAYMENT_STATUSES = ['not_processed', 'processing', 'paid', 'on_hold'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What a partner is allowed to see. `on_hold` deliberately collapses to pending. */
export const PARTNER_FACING_STATUSES = ['pending', 'processing', 'paid'] as const;
export type PartnerFacingStatus = (typeof PARTNER_FACING_STATUSES)[number];

export interface PaymentStatusRecord {
  month: string;
  recipient_type: 'talent' | 'partner';
  recipient_id: string;
  status: PaymentStatus;
  hold_reason: string | null;
  updated_source: 'hub' | 'squadbooks';
  updated_at: string | null;
}

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(v);
}

function statusKey(recipientType: string, recipientId: string): string {
  return `${recipientType}:${recipientId}`;
}

/**
 * Collapse an internal status to what a partner may see.
 *
 * `on_hold` maps to `pending` on purpose: a hold is an internal decision, often
 * with a sensitive reason attached, and surfacing it in the partner app turns
 * every hold into a support conversation. The partner sees the payout as simply
 * not yet paid, which is true.
 */
export function toPartnerFacingStatus(status: PaymentStatus | null | undefined): PartnerFacingStatus {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'processing':
      return 'processing';
    case 'on_hold':
    case 'not_processed':
    default:
      return 'pending';
  }
}

/** Statuses for one month, keyed `${recipient_type}:${recipient_id}`. */
export async function listPaymentStatuses(month: string): Promise<Map<string, PaymentStatusRecord>> {
  const out = new Map<string, PaymentStatusRecord>();
  if (!/^\d{4}-\d{2}$/.test(month)) return out;

  const { data, error } = await supabaseAdmin
    .from('partner_payment_statuses')
    .select('month, recipient_type, recipient_id, status, hold_reason, updated_source, updated_at')
    .eq('month', month);
  if (error) throw new Error(error.message);

  for (const row of (data || []) as PaymentStatusRecord[]) {
    out.set(statusKey(row.recipient_type, row.recipient_id), {
      ...row,
      hold_reason: row.hold_reason ?? null,
    });
  }
  return out;
}

/**
 * Every stored status for one recipient, keyed by month — the mini app and the
 * per-partner detail views need a whole series, not a single month.
 */
export async function listPaymentStatusesForRecipient(
  recipientType: 'talent' | 'partner',
  recipientId: string,
): Promise<Map<string, PaymentStatusRecord>> {
  const out = new Map<string, PaymentStatusRecord>();
  const { data, error } = await supabaseAdmin
    .from('partner_payment_statuses')
    .select('month, recipient_type, recipient_id, status, hold_reason, updated_source, updated_at')
    .eq('recipient_type', recipientType)
    .eq('recipient_id', recipientId);
  if (error) throw new Error(error.message);

  for (const row of (data || []) as PaymentStatusRecord[]) {
    out.set(row.month, { ...row, hold_reason: row.hold_reason ?? null });
  }
  return out;
}

export interface UpsertPaymentStatusInput {
  month: string;
  recipientType: 'talent' | 'partner';
  recipientId: string;
  status: PaymentStatus;
  holdReason?: string | null;
  /** Which app is writing — recorded for audit when the two surfaces disagree. */
  source: 'hub' | 'squadbooks';
  /** SquadHub user id when the write came from the admin module, else null. */
  updatedBy?: string | null;
}

export async function upsertPaymentStatus(
  input: UpsertPaymentStatusInput,
): Promise<PaymentStatusRecord> {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error('month must be YYYY-MM');
  if (!isPaymentStatus(input.status)) throw new Error('Invalid status');
  if (input.recipientType !== 'talent' && input.recipientType !== 'partner') {
    throw new Error('Invalid recipient type');
  }
  if (!input.recipientId) throw new Error('recipientId is required');

  // A hold without a reason is useless to whoever picks the payout up later.
  const holdReason = input.status === 'on_hold' ? (input.holdReason ?? '').trim() : '';
  if (input.status === 'on_hold' && !holdReason) {
    throw new Error('Hold reason is required when putting a payment on hold');
  }

  const { data, error } = await supabaseAdmin
    .from('partner_payment_statuses')
    .upsert(
      {
        month: input.month,
        recipient_type: input.recipientType,
        recipient_id: input.recipientId,
        status: input.status,
        hold_reason: holdReason || null,
        updated_source: input.source,
        updated_by: input.updatedBy ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'month,recipient_type,recipient_id' },
    )
    .select('month, recipient_type, recipient_id, status, hold_reason, updated_source, updated_at')
    .single();
  if (error) throw new Error(error.message);

  const row = data as PaymentStatusRecord;
  return { ...row, hold_reason: row.hold_reason ?? null };
}
