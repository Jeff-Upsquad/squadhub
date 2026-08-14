import { supabaseAdmin } from '../supabase';

/**
 * Propagate an account email change to the denormalized customer-email copies
 * (clients.email, client_submissions.email, subscription_cards.customer_email,
 * job_cards.customer_email) so card lists resolved by email keep working.
 *
 * Mirrors the DB trigger propagate_user_email_change() at the application
 * level, and also covers legacy cards matched only by the old email copy.
 * Best-effort — never throws to the caller.
 */
export async function propagateEmailChange(userId: string, newEmail: string): Promise<void> {
  const email = newEmail.trim().toLowerCase();
  if (!email) return;

  try {
    // 1. Find clients linked to this user: via client_user_access grants and
    //    via email matches (covers rows without grants).
    const { data: access } = await supabaseAdmin
      .from('client_user_access')
      .select('client_id')
      .eq('user_id', userId);
    const grantedClientIds = Array.from(new Set((access ?? []).map((a: any) => a.client_id)));

    const [{ data: emailClients }, { data: emailSubs }] = await Promise.all([
      supabaseAdmin.from('clients').select('id, submission_id').ilike('email', email),
      supabaseAdmin.from('client_submissions').select('id').ilike('email', email),
    ]);

    const clientIds = Array.from(
      new Set([
        ...grantedClientIds,
        ...(emailClients ?? []).map((c: any) => c.id),
      ]),
    );
    const submissionIds = Array.from(
      new Set([
        ...(emailSubs ?? []).map((s: any) => s.id),
        ...(emailClients ?? []).map((c: any) => c.submission_id).filter(Boolean),
      ]),
    );

    // 2. Update the denormalized copies (id-based where possible).
    if (clientIds.length > 0) {
      await supabaseAdmin.from('clients').update({ email }).in('id', clientIds);
      await supabaseAdmin
        .from('job_cards')
        .update({ customer_email: email })
        .in('client_id', clientIds);
    }

    if (submissionIds.length > 0) {
      await supabaseAdmin
        .from('client_submissions')
        .update({ email })
        .in('id', submissionIds);
      await supabaseAdmin
        .from('job_cards')
        .update({ customer_email: email })
        .in('lead_submission_id', submissionIds);

      const { data: staged } = await supabaseAdmin
        .from('client_submission_subscriptions')
        .select('id')
        .in('submission_id', submissionIds);
      const stagedIds = (staged ?? []).map((s: any) => s.id);
      if (stagedIds.length > 0) {
        await supabaseAdmin
          .from('subscription_cards')
          .update({ customer_email: email })
          .in('submission_subscription_id', stagedIds);
      }
    }

    // 3. Legacy cards matched only by the old email copy (no FK link).
    await supabaseAdmin
      .from('subscription_cards')
      .update({ customer_email: email })
      .ilike('customer_email', email);
    await supabaseAdmin
      .from('job_cards')
      .update({ customer_email: email })
      .ilike('customer_email', email);
  } catch (err) {
    console.error('[propagateEmailChange] failed:', (err as any)?.message);
  }
}
