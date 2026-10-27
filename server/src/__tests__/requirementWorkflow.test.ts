import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canManuallyBroadcast } from '@squadhub/shared';
import { categorizeJobCard } from '../utils/jobStage';
const m = vi.hoisted(() => ({ jobs: [] as any[], cards: {} as Record<string, any>, updates: [] as any[], publish: vi.fn(), match: vi.fn(), payload: vi.fn(), deliver: vi.fn(), log: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: {
        rpc: vi.fn(async () => ({ data: m.jobs, error: null })),
        from: (table: string) => {
            let id: string | undefined;
            let group: string | undefined;
            const q: any = { select() { return q; }, eq(k: string, v: string) {
                    if (k === 'id')
                        id = v;
                    if (k === 'brief_group_id')
                        group = v;
                    return q;
                }, is() { return q; },
                update(patch: any) {
                    m.updates.push({ table, patch });
                    if (table === 'subscription_cards' && id)
                        Object.assign(m.cards[id], patch);
                    return q;
                },
                single: async () => ({ data: m.cards[id!], error: null }),
                then: (resolve: any) => resolve({ data: group ? Object.values(m.cards).filter(c => c.brief_group_id === group) : [], error: null }),
            };
            return q;
        },
    } }));
vi.mock('../utils/publishRequirementCard', () => ({ publishRequirementCard: m.publish }));
vi.mock('../utils/subscriptionCards', () => ({ matchPartnersForCard: m.match }));
vi.mock('../utils/squadhireWebhook', () => ({ buildSquadhirePayloadForCard: m.payload, deliverCardToSquadhire: m.deliver }));
vi.mock('../utils/squadhireJobWebhook', () => ({ buildSquadhireJobPayload: vi.fn(), deliverJobCardToSquadhire: vi.fn() }));
vi.mock('../utils/publishJobRequirement', () => ({ publishJobRequirement: vi.fn() }));
vi.mock('../utils/cardEvents', () => ({ logCardEvent: m.log }));
import { processRequirementDeliveries } from '../utils/requirementDelivery';
beforeEach(() => {
    vi.clearAllMocks();
    m.updates = [];
    m.cards = {};
    m.jobs = [];
    m.publish.mockImplementation(async (id) => { m.cards[id].state = 'published'; });
    m.match.mockResolvedValue([]);
    m.payload.mockImplementation(async (id) => ({ external_id: id }));
    m.deliver.mockImplementation(async (id) => { m.cards[id].squadhire_synced_at = '2026-10-27T00:00:00Z'; });
});
const enqueue = (card: any) => { m.cards[card.id] = card; m.jobs.push({ card_id: card.id, card_table: 'subscription_cards', requested_at: 'version-1', attempts: 1 }); };
describe('requirement review and delivery policy', () => {
    it('enables all-audience broadcast only for cards created internally', () => {
        for (const source of ['internal_brief', 'custom', 'request', 'submission'])
            expect(canManuallyBroadcast({ source })).toBe(true);
        for (const source of ['shared_form', 'landing_page_form', null, undefined])
            expect(canManuallyBroadcast({ source })).toBe(false);
        // Filling an internal card through a share link preserves its creator origin.
        expect(canManuallyBroadcast({ source: 'internal_brief', business_submitted_at: 'today' })).toBe(true);
    });
    it('keeps a live hiring card in New for Review until an explicit review', () => {
        const card = { state: 'published', applicants_count: 12 };
        expect(categorizeJobCard(card)).toBe('new');
        expect(categorizeJobCard({ ...card, requirement_reviewed_at: 'today' })).toBe('broadcasted');
        expect(categorizeJobCard({ ...card, cancelled_at: 'today' })).toBe('cancelled');
        expect(categorizeJobCard({ ...card, archived_at: 'today' })).toBe('archive');
    });
    it.each(['subscription', 'assignment'])('automatically publishes and broadcasts a business %s without marking it reviewed', async (card_type) => {
        enqueue({ id: 'a', card_type, state: 'draft', source: 'shared_form', publish_targets: ['partner', 'talent'] });
        await processRequirementDeliveries();
        expect(m.publish).toHaveBeenCalledWith('a', null, 'broadcast');
        expect(m.match).toHaveBeenCalledWith('a', { staged: true });
        expect(m.deliver).toHaveBeenCalledWith('a', { external_id: 'a', notify_talents: true });
        expect(m.cards.a.requirement_reviewed_at).toBeUndefined();
        expect(m.updates.find(x => x.table === 'requirement_delivery_queue')?.patch.completed_at).toBeTruthy();
    });
    it('retries failed deliveries and continues with the next business brief', async () => {
        enqueue({ id: 'a', state: 'published' });
        enqueue({ id: 'b', state: 'published' });
        m.payload.mockImplementation(async (id) => {
            if (id === 'a')
                throw new Error('temporary failure');
            return { external_id: id };
        });
        await processRequirementDeliveries();
        const updates = m.updates.filter(x => x.table === 'requirement_delivery_queue');
        expect(updates[0].patch.last_error).toBe('temporary failure');
        expect(updates[0].patch.completed_at).toBeUndefined();
        expect(updates[0].patch.claimed_at).toBeNull();
        expect(updates[1].patch.completed_at).toBeTruthy();
    });
    it.each([{ recalled_at: 'today' }, { cancelled_at: 'today' }, { deleted_at: 'today' }, { archived_at: 'today' }, { state: 'closed' }])('does not deliver a recalled or retired card: %j', async (flags) => {
        enqueue({ id: 'a', state: 'published', ...flags });
        await processRequirementDeliveries();
        expect(m.deliver).not.toHaveBeenCalled();
        expect(m.publish).not.toHaveBeenCalled();
    });
    it('a retry of an already published card does not create new tier siblings', async () => {
        enqueue({ id: 'a', state: 'published', brief_group_id: 'g' });
        m.cards.b = { id: 'b', state: 'published', brief_group_id: 'g' };
        await processRequirementDeliveries();
        expect(m.publish).not.toHaveBeenCalled();
        expect(m.deliver).toHaveBeenCalledTimes(2);
    });
});
vi.mock('../utils/cardAttention', () => ({ getCardsAttention: vi.fn() }));
import cardsRouter from '../routes/cards-attention';
const allHandler = (cardsRouter as any).stack.find((layer: any) => layer.route?.path === '/subscription/:id/broadcast-all').route.stack[0].handle;
function response() {
    const res: any = { code: 200, body: undefined, status(code: number) { res.code = code; return res; }, json(body: any) { res.body = body; return res; } };
    return res;
}
describe('manual broadcast API enforcement', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    it('rejects a direct broadcast call for a business submission', async () => {
        m.cards[id] = { id, source: 'shared_form', state: 'published' };
        const res = response();
        await allHandler({ params: { id } }, res);
        expect(res.code).toBe(409);
        expect(m.deliver).not.toHaveBeenCalled();
    });
    it('rejects broadcasting a cancelled internal card', async () => {
        m.cards[id] = { id, source: 'internal_brief', state: 'closed', cancelled_at: 'today' };
        const res = response();
        await allHandler({ params: { id } }, res);
        expect(res.code).toBe(409);
        expect(m.deliver).not.toHaveBeenCalled();
    });
    it('broadcasts an internally created live card with explicit notifications', async () => {
        m.cards[id] = { id, source: 'internal_brief', state: 'published', distribution: 'broadcast' };
        const res = response();
        await allHandler({ params: { id }, userId: 'admin', userName: 'Admin' }, res);
        expect(res.code).toBe(200);
        expect(res.body.success).toBe(true);
        expect(m.deliver).toHaveBeenCalledWith(id, { external_id: id, notify_talents: true });
    });
});
it('the hiring broadcast API also rejects a business-origin card', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    m.cards[id] = { id, source: 'shared_form', state: 'published' };
    const handler = (cardsRouter as any).stack.find((layer: any) => layer.route?.path === '/job/:id/broadcast-all').route.stack[0].handle;
    const res = response();
    await handler({ params: { id } }, res);
    expect(res.code).toBe(409);
    expect(m.deliver).not.toHaveBeenCalled();
});
