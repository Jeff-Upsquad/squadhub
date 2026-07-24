import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();
// Scoped to the paths this router owns — it is mounted at '/admin', and a bare
// gate would intercept sibling routers (see the note in admin.ts). Linking a
// card to a client space stays admin-only; it is not part of the Leads module.
router.use('/subscription-cards', requireAuth);
router.use('/subscription-cards', requireAdmin);

// Maps a subscription slug to compatible client_space_template slugs.
const SUBSCRIPTION_TO_TEMPLATE_SLUGS: Record<string, string[]> = {
  designer: ['design-space'],
  video_editor: ['video-editing-space'],
  designer_video_editor: ['design-space', 'video-editing-space'],
};

// ============================================================
// POST /admin/subscription-cards/link-by-code
//
// Link a subscription card to a specific client-space folder using
// the card's unique code. Validates that the card's subscription
// type matches the space template type.
// ============================================================
const linkByCodeSchema = z.object({
  card_code: z.string().min(1),
  folder_id: z.string().uuid(),
});

router.post('/subscription-cards/link-by-code', async (req: Request, res: Response) => {
  try {
    const parsed = linkByCodeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }

    const { card_code, folder_id } = parsed.data;

    // 1. Resolve card by code
    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, card_code, linked_folder_id, submission_subscription_id')
      .eq('card_code', card_code)
      .maybeSingle();

    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found for the given code' }); return; }

    if (card.linked_folder_id) {
      res.status(409).json({ success: false, error: 'Card is already linked to a space' });
      return;
    }

    // 2. Verify the folder exists and has a client_space_template_id
    const { data: folder, error: folderErr } = await supabaseAdmin
      .from('folders')
      .select('id, client_space_template_id')
      .eq('id', folder_id)
      .maybeSingle();

    if (folderErr) { res.status(500).json({ success: false, error: folderErr.message }); return; }
    if (!folder) { res.status(404).json({ success: false, error: 'Folder not found' }); return; }
    if (!folder.client_space_template_id) {
      res.status(400).json({ success: false, error: 'Folder is not a client space' });
      return;
    }

    // 3. Look up the template slug
    const { data: template, error: tplErr } = await supabaseAdmin
      .from('client_space_templates')
      .select('id, slug, name')
      .eq('id', folder.client_space_template_id)
      .maybeSingle();

    if (tplErr) { res.status(500).json({ success: false, error: tplErr.message }); return; }
    if (!template) { res.status(404).json({ success: false, error: 'Client space template not found' }); return; }

    // 4. Resolve the card's subscription slug
    const { data: stagedSub, error: stagedErr } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('subscription_id')
      .eq('id', card.submission_subscription_id)
      .maybeSingle();

    if (stagedErr) { res.status(500).json({ success: false, error: stagedErr.message }); return; }
    if (!stagedSub) {
      res.status(400).json({ success: false, error: 'Card is not linked to a subscription' });
      return;
    }

    const { data: subscription, error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .select('id, slug, name')
      .eq('id', stagedSub.subscription_id)
      .maybeSingle();

    if (subErr) { res.status(500).json({ success: false, error: subErr.message }); return; }
    if (!subscription) { res.status(404).json({ success: false, error: 'Subscription not found' }); return; }

    // 5. Validate compatibility
    const allowedSlugs = SUBSCRIPTION_TO_TEMPLATE_SLUGS[subscription.slug];
    if (!allowedSlugs || !allowedSlugs.includes(template.slug)) {
      res.status(400).json({
        success: false,
        error: `"${subscription.name}" cards can only be linked to ${allowedSlugs?.length ? allowedSlugs.join(', ') : 'no available'} space(s). "${template.name}" is not compatible.`,
      });
      return;
    }

    // 6. Stamp the link
    const now = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({ linked_folder_id: folder_id, linked_at: now })
      .eq('id', card.id);

    if (updErr) { res.status(500).json({ success: false, error: updErr.message }); return; }

    res.json({
      success: true,
      data: {
        card_id: card.id,
        card_code,
        linked_folder_id: folder_id,
        linked_at: now,
        space_name: template.name,
      },
    });
  } catch (err: any) {
    console.error('Link by code error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/unlink
//
// Remove the link between a card and its space.
// ============================================================
router.post('/subscription-cards/:id/unlink', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, linked_folder_id')
      .eq('id', cardId)
      .maybeSingle();

    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (!card.linked_folder_id) {
      res.status(409).json({ success: false, error: 'Card is not linked to any space' });
      return;
    }

    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({ linked_folder_id: null, linked_at: null })
      .eq('id', cardId);

    if (updErr) { res.status(500).json({ success: false, error: updErr.message }); return; }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Unlink error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/link-status
//
// Returns the card's linking status and compatible spaces for the client.
// ============================================================
router.get('/subscription-cards/:id/link-status', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, card_code, linked_folder_id, linked_at, submission_subscription_id')
      .eq('id', cardId)
      .maybeSingle();

    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }

    let linkedFolderName: string | null = null;
    if (card.linked_folder_id) {
      const { data: folder } = await supabaseAdmin
        .from('folders')
        .select('name')
        .eq('id', card.linked_folder_id)
        .maybeSingle();
      linkedFolderName = folder?.name ?? null;
    }

    // Resolve compatible spaces
    let compatibleSpaces: { id: string; name: string; template_slug: string }[] = [];
    const { data: stagedSub } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('subscription_id')
      .eq('id', card.submission_subscription_id)
      .maybeSingle();

    if (stagedSub) {
      const { data: subscription } = await supabaseAdmin
        .from('subscriptions')
        .select('slug')
        .eq('id', stagedSub.subscription_id)
        .maybeSingle();

      if (subscription) {
        const allowedSlugs = SUBSCRIPTION_TO_TEMPLATE_SLUGS[subscription.slug];
        if (allowedSlugs) {
          const { data: templates } = await supabaseAdmin
            .from('client_space_templates')
            .select('id, name, slug')
            .in('slug', allowedSlugs)
            .eq('is_enabled', true);

          compatibleSpaces = (templates ?? []).map((t: any) => ({
            id: t.id,
            name: t.name,
            template_slug: t.slug,
          }));
        }
      }
    }

    res.json({
      success: true,
      data: {
        card_id: card.id,
        card_code: card.card_code,
        linked: !!card.linked_folder_id,
        linked_folder_id: card.linked_folder_id,
        linked_folder_name: linkedFolderName,
        linked_at: card.linked_at,
        compatible_spaces: compatibleSpaces,
      },
    });
  } catch (err: any) {
    console.error('Link status error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
