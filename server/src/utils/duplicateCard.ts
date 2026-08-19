import { supabaseAdmin } from '../supabase';
import { resolveCrmCardAssignees } from './cardCrmAssignees';

// Copy a subscription card's DETAILS (plan / pricing / targeting / customer) into
// a brand-new DRAFT card that lands in the New Deals queue — WITHOUT its
// recipients, assignees, terms, linked space, or any lifecycle/SquadHire state.
// Shared by the "Duplicate" action and the upgrade/downgrade replacement flow.
//
// `overrides` lets a caller change the plan (upgrade/downgrade) or set
// supersedes_card_id. `source` is forced to 'internal_brief' so the copy reliably
// shows in the New Deals list (which only surfaces shared_form / landing_page_form
// / internal_brief / request origins).
export async function copyCardToNewDraft(
  sourceCardId: string,
  overrides: Record<string, unknown>,
  actorUserId: string | null,
): Promise<{ id: string } | { error: string }> {
  const { data: src, error } = await supabaseAdmin
    .from('subscription_cards')
    .select('*')
    .eq('id', sourceCardId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!src) return { error: 'Source card not found' };
  const s = src as Record<string, any>;

  const crmAssignees = await resolveCrmCardAssignees({
    submissionId: s.lead_submission_id,
    email: s.customer_email,
    phone: s.customer_phone,
    primarySalesPersonId: s.assignee_id,
    secondarySalesPersonId: Array.isArray(s.collaborator_ids) ? s.collaborator_ids[0] : null,
    serviceLabel: s.service_type ?? null,
  });
  // If CRM has no one, keep the source card's owners (including extra secondaries).
  const ownerPatch =
    crmAssignees.assignee_id || crmAssignees.collaborator_ids.length
      ? {
          assignee_id: crmAssignees.assignee_id,
          collaborator_ids: crmAssignees.collaborator_ids.length
            ? crmAssignees.collaborator_ids
            : (s.collaborator_ids || []),
        }
      : {
          assignee_id: s.assignee_id ?? null,
          collaborator_ids: s.collaborator_ids || [],
        };

  const newCard: Record<string, unknown> = {
    // ---- details copied verbatim ----
    working_days: s.working_days,
    brand_name: s.brand_name,
    brand_id: s.brand_id,
    business_nature: s.business_nature,
    notes: s.notes,
    hours_note: s.hours_note,
    requirement_note: s.requirement_note,
    requirement_voice_url: s.requirement_voice_url,
    additional_requirements: s.additional_requirements,
    min_experience_years: s.min_experience_years,
    target_languages: s.target_languages,
    target_tiers: s.target_tiers,
    tier_pricing: s.tier_pricing,
    custom_deliverables: s.custom_deliverables,
    disabled_default_deliverable_ids: s.disabled_default_deliverable_ids,
    squadhire_category_ids: s.squadhire_category_ids,
    publish_targets: s.publish_targets,
    distribution: s.distribution,
    proposed_price: s.proposed_price,
    markup: s.markup,
    partner_price_override: s.partner_price_override,
    subscription_price: s.subscription_price,
    plan_name: s.plan_name,
    plan_snapshot: s.plan_snapshot,
    service_type: s.service_type,
    card_type: s.card_type,
    assignment_details: s.assignment_details,
    customer_name: s.customer_name,
    customer_email: s.customer_email,
    customer_company: s.customer_company,
    customer_phone: s.customer_phone,
    customer_location: s.customer_location,
    lead_submission_id: s.lead_submission_id,
    assignee_id: ownerPatch.assignee_id,
    collaborator_ids: ownerPatch.collaborator_ids,
    client_id: s.client_id,
    billing_start_date: s.billing_start_date,
    // ---- fresh draft in New Deals ----
    source: 'internal_brief',
    state: 'draft',
    created_by: actorUserId,
    // Everything not listed defaults to null/0: submission_subscription_id,
    // subscription_request_id, published_at/by, closed/cancelled/archived/recalled/
    // assigned/paused/admin_reviewed timestamps, selected_recipient_*, linked_folder_id,
    // linked_at, card_code, brief_group_id, parent_card_id, supersedes_card_id,
    // cancel_type, deleted_*, and all squadhire_* sync/notify/preview columns.
    ...overrides,
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('subscription_cards')
    .insert(newCard)
    .select('id')
    .maybeSingle();
  if (insErr) return { error: insErr.message };
  if (!inserted) return { error: 'Failed to create the copied card' };
  const newId = (inserted as any).id as string;

  // Copy the targeting rows (countries + regions) — recipients/terms are NOT copied.
  const { data: countries } = await supabaseAdmin
    .from('subscription_card_target_countries')
    .select('country_id')
    .eq('card_id', sourceCardId);
  if (countries && countries.length) {
    await supabaseAdmin
      .from('subscription_card_target_countries')
      .insert((countries as any[]).map((c) => ({ card_id: newId, country_id: c.country_id })));
  }
  const { data: regions } = await supabaseAdmin
    .from('subscription_card_target_regions')
    .select('country_id, region')
    .eq('card_id', sourceCardId);
  if (regions && regions.length) {
    await supabaseAdmin
      .from('subscription_card_target_regions')
      .insert((regions as any[]).map((r) => ({ card_id: newId, country_id: r.country_id, region: r.region })));
  }

  return { id: newId };
}
