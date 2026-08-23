/**
 * Propagate a person / brand name change across Hub + CRM rows matched by
 * email or phone. Mirrors CRM `applyIdentityNames` so SquadHub signup and
 * account settings keep identity aligned. Never writes crm_leads.whatsapp_name.
 */
import { supabaseAdmin } from '../supabase';
import { findCrmLeadCandidates } from './clientExternalLinks';
import { phoneSuffix } from './leadLookup';

function trimName(value: string | null | undefined): string | null {
  const t = value?.trim() ?? '';
  return t.length > 0 ? t : null;
}

export async function propagateIdentityNames(input: {
  email?: string | null;
  phone?: string | null;
  personName?: string | null;
  brandName?: string | null;
}): Promise<void> {
  const person = trimName(input.personName);
  const brand = trimName(input.brandName);
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  if (!person && !brand) return;
  if (!email && !phone) return;

  try {
    const { rows } = await findCrmLeadCandidates({
      email,
      contact_number: phone,
    });
    const leadIds = rows.map((r) => r.id);
    const contactIds = Array.from(
      new Set(rows.map((r) => r.contact_id).filter((id): id is string => !!id)),
    );

    if (person && leadIds.length > 0) {
      await supabaseAdmin.from('crm_leads').update({ name: person }).in('id', leadIds);
      await supabaseAdmin
        .from('crm_contact_persons')
        .update({ name: person })
        .in('lead_id', leadIds);
    }

    if (brand && contactIds.length > 0) {
      await supabaseAdmin.from('crm_contacts').update({ name: brand }).in('id', contactIds);
    }

    const hubPatch: Record<string, string> = {};
    if (person) hubPatch.contact_person = person;
    if (brand) hubPatch.business_name = brand;

    const suffix = phoneSuffix(phone);
    if (Object.keys(hubPatch).length > 0) {
      if (email) {
        await supabaseAdmin.from('client_submissions').update(hubPatch).ilike('email', email);
        await supabaseAdmin.from('clients').update(hubPatch).ilike('email', email);
      }
      if (suffix) {
        const tail4 = suffix.slice(-4);
        const { data: subs } = await supabaseAdmin
          .from('client_submissions')
          .select('id, contact_number')
          .ilike('contact_number', `%${tail4}`)
          .limit(50);
        for (const row of subs || []) {
          if (phoneSuffix(row.contact_number) !== suffix) continue;
          await supabaseAdmin.from('client_submissions').update(hubPatch).eq('id', row.id);
        }
        const { data: clients } = await supabaseAdmin
          .from('clients')
          .select('id, contact_number')
          .ilike('contact_number', `%${tail4}`)
          .limit(50);
        for (const row of clients || []) {
          if (phoneSuffix(row.contact_number) !== suffix) continue;
          await supabaseAdmin.from('clients').update(hubPatch).eq('id', row.id);
        }
      }
    }

    const cardPatch: Record<string, string> = {};
    if (person) cardPatch.customer_name = person;
    if (brand) cardPatch.customer_company = brand;
    if (Object.keys(cardPatch).length > 0) {
      if (email) {
        await supabaseAdmin
          .from('subscription_cards')
          .update(cardPatch)
          .ilike('customer_email', email)
          .is('deleted_at', null);
        await supabaseAdmin
          .from('job_cards')
          .update(cardPatch)
          .ilike('customer_email', email)
          .is('deleted_at', null);
      }
      if (suffix) {
        const tail4 = suffix.slice(-4);
        const { data: cards } = await supabaseAdmin
          .from('subscription_cards')
          .select('id, customer_phone')
          .ilike('customer_phone', `%${tail4}`)
          .is('deleted_at', null)
          .limit(50);
        for (const row of cards || []) {
          if (phoneSuffix(row.customer_phone) !== suffix) continue;
          await supabaseAdmin.from('subscription_cards').update(cardPatch).eq('id', row.id);
        }
        const { data: jobs } = await supabaseAdmin
          .from('job_cards')
          .select('id, customer_phone')
          .ilike('customer_phone', `%${tail4}`)
          .is('deleted_at', null)
          .limit(50);
        for (const row of jobs || []) {
          if (phoneSuffix(row.customer_phone) !== suffix) continue;
          await supabaseAdmin.from('job_cards').update(cardPatch).eq('id', row.id);
        }
      }
    }
  } catch (err: any) {
    console.error('[propagateIdentityNames] failed:', err?.message);
  }
}

/** Load the user's email/phone then stamp their display name onto matched rows. */
export async function propagateUserDisplayName(userId: string, displayName: string): Promise<void> {
  const name = trimName(displayName);
  if (!name) return;
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select('email, phone')
      .eq('id', userId)
      .maybeSingle();
    if (!data) return;
    await propagateIdentityNames({
      email: data.email,
      phone: data.phone,
      personName: name,
    });
  } catch (err: any) {
    console.error('[propagateUserDisplayName] failed:', err?.message);
  }
}
