import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { supabaseAdmin } from '../supabase';
import { hydrateStagedSubscriptions } from '../utils/stagedSubscriptions';
import { sharePartnerWithCardClient } from '../utils/sharePartnerWithClient';
import { logCardEvent } from '../utils/cardEvents';
import { notifySquadhireOfTalentAcceptance } from '../utils/squadhireWebhook';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();

router.use(requireAuth, requireUserType(...PARTNER_USER_TYPES));

// ============================================================
// GET /partner/opportunities?status=pending|accepted|rejected
//   Returns recipient rows for this partner joined with the card, the staged
//   subscription (with subscription + plan + pricing + deliverables), and the
//   lead's country for price display.
// ============================================================
const listSchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }
    const statusFilter = parsed.data.status;

    let recipientsQuery = supabaseAdmin
      .from('subscription_card_recipients')
      .select('*')
      .eq('partner_id', req.userId!)
      // Staged matches (broadcast_at IS NULL) are matched-but-not-yet-sent — they
      // stay invisible to the partner until the admin clicks "Broadcast".
      .not('broadcast_at', 'is', null)
      .order('created_at', { ascending: false });
    if (statusFilter) recipientsQuery = recipientsQuery.eq('status', statusFilter);

    const { data: recipients, error: recErr } = await recipientsQuery;
    if (recErr) {
      res.status(500).json({ success: false, error: recErr.message });
      return;
    }

    // Talents provisioned into SquadHub become partner users, while the card
    // responses they made in SquadHire remain in the external-recipient table.
    // Join those rows by the verified account email so Discover becomes the
    // one request inbox for both native partners and migrated SquadHire talent.
    // `notified_at` keeps soft-published/queued matches private until broadcast;
    // responded rows remain visible even on old data that predates that column.
    let externalRecipients: any[] = [];
    if (req.userEmail) {
      let externalQuery = supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('*')
        .eq('email', req.userEmail.trim().toLowerCase())
        .is('archived_at', null)
        .or('notified_at.not.is.null,status.neq.pending')
        .order('created_at', { ascending: false });
      if (statusFilter) externalQuery = externalQuery.eq('status', statusFilter);
      const { data: external, error: externalError } = await externalQuery;
      if (externalError) {
        console.error('List external partner opportunities error:', externalError.message);
      } else {
        externalRecipients = (external || []).map((row: any) => ({
          ...row,
          partner_id: req.userId!,
          source: 'squadhire',
        }));
      }
    }

    const combinedRecipients = [...(recipients || []), ...externalRecipients];
    const cardIds = Array.from(new Set(combinedRecipients.map((r: any) => r.card_id)));
    if (cardIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Include published cards, live assigned cards, AND recalled/cancelled
    // cards (state='closed' with recalled_at or cancelled_at set). Discover is
    // also the partner's request history: dropping a card the moment a talent
    // is selected made an accepted subscription/assignment appear to vanish
    // precisely when it became active.
    // Archived cards are always excluded — archive is a hard hide from
    // partner feeds.
    const { data: cards, error: cardsErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .in('id', cardIds)
      .is('archived_at', null)
      .or('state.in.(published,assigned),recalled_at.not.is.null,cancelled_at.not.is.null');
    if (cardsErr) {
      res.status(500).json({ success: false, error: cardsErr.message });
      return;
    }

    const cardList = cards || [];

    // For secondary cards, resolve parent's submission_subscription_id and
    // use parent's card ID for targeting queries.
    const parentCardIds = Array.from(new Set(
      cardList.filter((c: any) => c.parent_card_id && !c.submission_subscription_id).map((c: any) => c.parent_card_id),
    ));
    const { data: parentCards } = parentCardIds.length > 0
      ? await supabaseAdmin.from('subscription_cards').select('id, submission_subscription_id').in('id', parentCardIds)
      : { data: [] as any[] };
    const parentById: Record<string, any> = {};
    (parentCards || []).forEach((p: any) => { parentById[p.id] = p; });

    const stagedSubIds = cardList
      .map((c: any) => c.submission_subscription_id || parentById[c.parent_card_id]?.submission_subscription_id)
      .filter(Boolean);
    const targetingCardIds = cardList.map((c: any) => c.parent_card_id ?? c.id);

    const [
      { data: stagedRows },
      { data: cardCountryRows },
      { data: cardRegionRows },
    ] = await Promise.all([
      stagedSubIds.length === 0
        ? Promise.resolve({ data: [] as any[] })
        : supabaseAdmin
            .from('client_submission_subscriptions')
            .select('*')
            .in('id', stagedSubIds),
      supabaseAdmin
        .from('subscription_card_target_countries')
        .select('card_id, country_id')
        .in('card_id', targetingCardIds),
      supabaseAdmin
        .from('subscription_card_target_regions')
        .select('card_id, country_id, region')
        .in('card_id', targetingCardIds),
    ]);

    const submissionIds = Array.from(
      new Set((stagedRows || []).map((s: any) => s.submission_id)),
    );
    const stagedHydrated = await hydrateStagedSubscriptions(submissionIds);

    const stagedById: Record<string, any> = {};
    Object.values(stagedHydrated).flat().forEach((r: any) => {
      stagedById[r.id] = r;
    });

    // Fetch lead's country for each submission (for pricing display).
    const { data: submissions } = submissionIds.length === 0
      ? { data: [] as any[] }
      : await supabaseAdmin
          .from('client_submissions')
          .select('id, business_name, country_id')
          .in('id', submissionIds);
    const { data: countries } = await supabaseAdmin
      .from('countries')
      .select('*');

    const countryById: Record<string, any> = {};
    (countries || []).forEach((c: any) => { countryById[c.id] = c; });

    const submissionById: Record<string, any> = {};
    (submissions || []).forEach((s: any) => {
      submissionById[s.id] = {
        ...s,
        country: countryById[s.country_id] || null,
      };
    });

    const countriesByCard: Record<string, string[]> = {};
    (cardCountryRows || []).forEach((r: any) => {
      (countriesByCard[r.card_id] = countriesByCard[r.card_id] || []).push(r.country_id);
    });
    const regionsByCard: Record<string, { country_id: string; region: string }[]> = {};
    (cardRegionRows || []).forEach((r: any) => {
      (regionsByCard[r.card_id] = regionsByCard[r.card_id] || []).push({
        country_id: r.country_id,
        region: r.region,
      });
    });

    const cardById: Record<string, any> = {};
    cardList.forEach((c: any) => {
      const effectiveSubId = c.submission_subscription_id || parentById[c.parent_card_id]?.submission_subscription_id;
      const targetingId = c.parent_card_id ?? c.id;
      let staged = effectiveSubId ? stagedById[effectiveSubId] || null : null;
      const submission = staged ? submissionById[staged.submission_id] : null;

      // Frozen plan-side data wins over the live values stagedHydrated returns.
      // Without this override, plan edits made after publish would leak into
      // partner-visible card data.
      const snap = c.plan_snapshot && typeof c.plan_snapshot === 'object' ? c.plan_snapshot : null;
      if (staged && snap) {
        const snapDelivs = Array.isArray(snap.deliverables) ? snap.deliverables : [];
        const snapPricing = Array.isArray(snap.pricing) ? snap.pricing : [];
        const snapPartnerPricing = Array.isArray(snap.partner_pricing) ? snap.partner_pricing : [];
        staged = {
          ...staged,
          plan: staged.plan
            ? {
                ...staged.plan,
                daily_hours: snap.plan?.daily_hours ?? staged.plan.daily_hours,
                weekly_hours: snap.plan?.weekly_hours ?? staged.plan.weekly_hours,
                deliverables: snapDelivs.map((d: any) => ({
                  id: d.id,
                  kind: d.kind,
                  plan_id: snap.plan?.id ?? staged.plan.id,
                  deliverable_type_id: d.deliverable_type_id ?? null,
                  per_day: Number(d.per_day) || 0,
                  per_week: Number(d.per_week) || 0,
                  per_month: Number(d.per_month) || 0,
                  sort_order: Number(d.sort_order) || 0,
                  deliverable_type: d.deliverable_type_id
                    ? { id: d.deliverable_type_id, name: d.deliverable_type_name ?? null }
                    : null,
                })),
                pricing: snapPricing.map((p: any) => ({
                  plan_id: snap.plan?.id ?? staged.plan.id,
                  country_id: p.country_id,
                  price: Number(p.price) || 0,
                  margin_value: Number(p.margin_value) || 0,
                  margin_type: p.margin_type ?? 'fixed',
                  country: countryById[p.country_id] ?? null,
                })),
                partner_pricing: snapPartnerPricing.map((p: any) => ({
                  plan_id: snap.plan?.id ?? staged.plan.id,
                  country_id: p.country_id,
                  price: Number(p.price) || 0,
                  country: countryById[p.country_id] ?? null,
                })),
              }
            : null,
        };
      }

      cardById[c.id] = {
        ...c,
        target_country_ids: countriesByCard[targetingId] || [],
        target_regions: regionsByCard[targetingId] || [],
        submission_subscription: staged,
        submission,
      };
    });

    const result = combinedRecipients
      .filter((r: any) => cardById[r.card_id])
      .map((r: any) => ({
        ...r,
        card: cardById[r.card_id],
      }));

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('List partner opportunities error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /partner/opportunities/:recipient_id/accept
// ============================================================
router.post('/:recipient_id/accept', async (req, res) => {
  return respond(req, res, 'accepted');
});

// ============================================================
// POST /partner/opportunities/:recipient_id/reject
// ============================================================
router.post('/:recipient_id/reject', async (req, res) => {
  return respond(req, res, 'rejected');
});

async function respond(
  req: Request,
  res: Response,
  newStatus: 'accepted' | 'rejected',
): Promise<void> {
  try {
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('subscription_card_recipients')
      .select('*')
      .eq('id', req.params.recipient_id)
      .eq('partner_id', req.userId!)
      .maybeSingle();
    if (selErr) {
      res.status(500).json({ success: false, error: selErr.message });
      return;
    }
    let recipient: any = existing;
    let recipientTable: 'subscription_card_recipients' | 'subscription_card_external_recipients' = 'subscription_card_recipients';
    if (!recipient && req.userEmail) {
      const { data: external, error: externalError } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('*')
        .eq('id', req.params.recipient_id)
        .eq('email', req.userEmail.trim().toLowerCase())
        .is('archived_at', null)
        .maybeSingle();
      if (externalError) {
        res.status(500).json({ success: false, error: externalError.message });
        return;
      }
      recipient = external;
      recipientTable = 'subscription_card_external_recipients';
    }
    if (!recipient) {
      res.status(404).json({ success: false, error: 'Opportunity not found' });
      return;
    }
    // Staged-but-not-broadcast rows aren't real opportunities yet.
    if (recipientTable === 'subscription_card_recipients' && !recipient.broadcast_at) {
      res.status(404).json({ success: false, error: 'Opportunity not found' });
      return;
    }
    if (recipientTable === 'subscription_card_external_recipients' && recipient.status === 'pending' && !recipient.notified_at) {
      res.status(404).json({ success: false, error: 'Opportunity not found' });
      return;
    }

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('state')
      .eq('id', recipient.card_id)
      .maybeSingle();
    if (!card || card.state !== 'published') {
      res.status(409).json({ success: false, error: 'This card is no longer available' });
      return;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from(recipientTable)
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq('id', req.params.recipient_id)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    // On accept, auto-share this partner with the card's owning client
    // (mirrors the manual partner_client_assignments admin flow). Idempotent
    // via UNIQUE(user_id, client_id). Silently skipped if the lead hasn't
    // been converted to a client yet. Same util is used by the admin
    // "auto-accept partner-employee" flow so the visibility behaviour stays
    // identical across both entry points.
    if (newStatus === 'accepted') {
      await sharePartnerWithCardClient(req.userId!, recipient.card_id);
      if (recipientTable === 'subscription_card_external_recipients' && recipient.external_user_id) {
        // Mirrors the legacy app acceptance into SquadHire. The existing
        // retry-tracked webhook keeps the two surfaces convergent during the
        // migration period.
        notifySquadhireOfTalentAcceptance(
          recipient.card_id,
          recipient.external_user_id,
          recipient.id,
        ).catch((err) => console.error('Discover acceptance mirror failed:', err));
      }
    }

    await logCardEvent({
      cardId: recipient.card_id,
      eventType: newStatus === 'accepted' ? 'recipient_accepted' : 'recipient_declined',
      actorId: recipientTable === 'subscription_card_external_recipients'
        ? recipient.external_user_id ?? null
        : req.userId ?? null,
      actorType: recipientTable === 'subscription_card_external_recipients' ? 'talent' : 'partner',
      actorLabel: (req as any).userName ?? null,
      metadata: { channel: 'partner-discover' },
    });

    res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error(`Partner respond (${newStatus}) error:`, err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

export default router;
