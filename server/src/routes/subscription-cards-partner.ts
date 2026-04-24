import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { supabaseAdmin } from '../supabase';
import { hydrateStagedSubscriptions } from '../utils/stagedSubscriptions';

const router = Router();

router.use(requireAuth, requireUserType('partner'));

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
      .order('created_at', { ascending: false });
    if (statusFilter) recipientsQuery = recipientsQuery.eq('status', statusFilter);

    const { data: recipients, error: recErr } = await recipientsQuery;
    if (recErr) {
      res.status(500).json({ success: false, error: recErr.message });
      return;
    }

    const cardIds = Array.from(new Set((recipients || []).map((r: any) => r.card_id)));
    if (cardIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: cards, error: cardsErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .in('id', cardIds)
      .eq('state', 'published');
    if (cardsErr) {
      res.status(500).json({ success: false, error: cardsErr.message });
      return;
    }

    const cardList = cards || [];
    const stagedSubIds = cardList.map((c: any) => c.submission_subscription_id);

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
        .in('card_id', cardIds),
      supabaseAdmin
        .from('subscription_card_target_regions')
        .select('card_id, country_id, region')
        .in('card_id', cardIds),
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
      const staged = stagedById[c.submission_subscription_id] || null;
      const submission = staged ? submissionById[staged.submission_id] : null;
      cardById[c.id] = {
        ...c,
        target_country_ids: countriesByCard[c.id] || [],
        target_regions: regionsByCard[c.id] || [],
        submission_subscription: staged,
        submission,
      };
    });

    const result = (recipients || [])
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
    if (!existing) {
      res.status(404).json({ success: false, error: 'Opportunity not found' });
      return;
    }

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('state')
      .eq('id', existing.card_id)
      .maybeSingle();
    if (!card || card.state !== 'published') {
      res.status(409).json({ success: false, error: 'This card is no longer available' });
      return;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription_card_recipients')
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq('id', req.params.recipient_id)
      .eq('partner_id', req.userId!)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error(`Partner respond (${newStatus}) error:`, err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

export default router;
