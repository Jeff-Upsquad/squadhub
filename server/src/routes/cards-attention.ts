import { publishJobRequirement } from '../utils/publishJobRequirement';
import { buildSquadhireJobPayload, deliverJobCardToSquadhire } from '../utils/squadhireJobWebhook';
import { logJobCardEvent } from '../utils/jobCardEvents';
import { canManuallyBroadcast } from '@squadhub/shared';
import { publishRequirementCard } from '../utils/publishRequirementCard';
import { broadcastRequirement } from '../utils/requirementDelivery';
import { logCardEvent } from '../utils/cardEvents';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { getCardsAttention } from '../utils/cardAttention';
/**
 * The Requirement Cards sidebar badge, for all three apps that show it: the
 * admin panel, the Requirement Cards mini app, and Squad CRM (which frames the
 * module and so has no way to count client-side).
 *
 * One number from one place — a per-app count would drift the first time a
 * lifecycle rule moved.
 */
const router = Router();
router.use(requireAuth);
router.use(requireMiniAppOrAdmin('leads'));
// GET /admin/cards/attention → { total, parts, by_pipeline }
router.get('/attention', async (_req: Request, res: Response) => {
    const data = await getCardsAttention();
    res.json({ success: true, data });
});
router.post('/:kind/:id/mark-reviewed', async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const table = req.params.kind === 'job' ? 'job_cards' : req.params.kind === 'subscription' ? 'subscription_cards' : null;
    if (!id.success || !table) {
        res.status(400).json({ success: false, error: 'Invalid card' });
        return;
    }
    const { data, error } = await supabaseAdmin.rpc('review_requirement', {
        p_table: table, p_id: id.data, p_actor: req.userId, p_name: req.userName ?? req.userId,
    });
    if (error) {
        res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, error: error.message });
        return;
    }
    res.json({ success: true, data });
});
router.post('/subscription/:id/broadcast-all', async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
        res.status(400).json({ success: false, error: 'Invalid card' });
        return;
    }
    try {
        const loaded = await supabaseAdmin.from('subscription_cards').select('*').eq('id', id.data).is('deleted_at', null).single();
        if (loaded.error || !loaded.data) {
            res.status(404).json({ success: false, error: 'Card not found' });
            return;
        }
        const card = loaded.data;
        if (!canManuallyBroadcast(card)) {
            res.status(409).json({ success: false, error: 'Business submissions broadcast automatically.' });
            return;
        }
        if (card.archived_at || card.cancelled_at || !['new', 'draft', 'published'].includes(card.state)) {
            res.status(409).json({ success: false, error: 'Card cannot be broadcast in its current state' });
            return;
        }
        if (card.state === 'new') {
            const { error } = await supabaseAdmin.from('subscription_cards').update({ state: 'draft' }).eq('id', card.id).eq('state', 'new');
            if (error)
                throw error;
        }
        let ids: string[] = [card.id];
        if (card.state !== 'published')
            ids = (await publishRequirementCard(card.id, req.userId ?? null, 'broadcast', req.userName ?? null)).cardIds;
        for (const cardId of ids) {
            const { data: current, error } = await supabaseAdmin.from('subscription_cards').update({ distribution: 'broadcast', squadhire_synced_at: null, squadhire_sync_attempts: 0, squadhire_sync_last_error: null }).eq('id', cardId).select('*').single();
            if (error)
                throw error;
            await broadcastRequirement(current);
            await logCardEvent({ cardId, eventType: 'broadcast', actorId: req.userId, actorType: 'admin', actorLabel: req.userName });
        }
        res.json({ success: true, data: { card_ids: ids } });
    }
    catch (e: any) {
        res.status(e.status ?? 503).json({ success: false, error: e.message ?? 'Broadcast failed; please retry.' });
    }
});
router.post('/job/:id/broadcast-all', async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
        res.status(400).json({ success: false, error: 'Invalid card' });
        return;
    }
    try {
        const { data: card, error } = await supabaseAdmin.from('job_cards').select('*').eq('id', id.data).is('deleted_at', null).single();
        if (error || !card) {
            res.status(404).json({ success: false, error: 'Card not found' });
            return;
        }
        if (!canManuallyBroadcast(card)) {
            res.status(409).json({ success: false, error: 'Business submissions broadcast automatically.' });
            return;
        }
        if (card.paused_at || card.archived_at || card.cancelled_at || card.state === 'closed') {
            res.status(409).json({ success: false, error: 'Card cannot be broadcast in its current state' });
            return;
        }
        if (card.state !== 'published')
            await publishJobRequirement(card.id, req.userId ?? null, 'broadcast');
        const reset = await supabaseAdmin.from('job_cards').update({ distribution: 'broadcast', squadhire_synced_at: null, squadhire_sync_attempts: 0, squadhire_sync_last_error: null }).eq('id', card.id).eq('state', 'published');
        if (reset.error)
            throw reset.error;
        const payload = await buildSquadhireJobPayload(card.id);
        if (!payload) {
            res.status(400).json({ success: false, error: 'Complete the linked job profile before broadcasting.' });
            return;
        }
        await deliverJobCardToSquadhire(card.id, { ...payload, notify_talents: true, distribution: 'broadcast' });
        const synced = await supabaseAdmin.from('job_cards').select('squadhire_synced_at').eq('id', card.id).single();
        if (!synced.data?.squadhire_synced_at)
            throw new Error('Job broadcast could not reach SquadHire. Please retry.');
        await logJobCardEvent({ cardId: card.id, eventType: 'broadcast', actorId: req.userId, actorType: 'admin', actorLabel: req.userName });
        res.json({ success: true });
    }
    catch (e: any) {
        res.status(e.status ?? 503).json({ success: false, error: e.message ?? 'Broadcast failed' });
    }
});
export default router;
