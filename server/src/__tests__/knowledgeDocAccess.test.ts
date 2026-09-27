import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const fixtures = vi.hoisted(() => ({ docs: [] as any[] }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: () => {
  const filters: Array<(doc: any) => boolean> = [];
  const query: any = {
    select: () => query,
    eq: (key: string, value: unknown) => {
      filters.push(key === 'knowledge_links.bot_id'
        ? (doc) => doc.knowledge_links.some((link: any) => link.bot_id === value)
        : (doc) => doc[key] === value);
      return query;
    },
    is: (key: string, value: unknown) => { filters.push((doc) => doc[key] === value); return query; },
    order: () => query,
    then: (resolve: (value: unknown) => void) => resolve({ data: fixtures.docs.filter((doc) => filters.every((filter) => filter(doc))), error: null }),
  };
  return query;
} } }));
vi.mock('../services/squadhireTraining', () => ({ loadPages: vi.fn(async (id: string) => [{ id: `page-${id}`, title: 'Shared content' }]) }));
vi.mock('../services/squadBots', () => ({
  allPaused: vi.fn(), effectiveStatus: vi.fn(), findBotByApiKey: vi.fn(), listProviders: vi.fn(), resolveAi: vi.fn(), runBotReply: vi.fn(),
}));
import router from '../routes/integrations/squad-bots';

beforeEach(() => {
  fixtures.docs = [
    { id: 'shared', status: 'published', bots: ['a', 'b'] },
    { id: 'only-a', status: 'published', bots: ['a'] },
    { id: 'only-b', status: 'published', bots: ['b'] },
    { id: 'draft', status: 'draft', bots: ['a'] },
    { id: 'clone', status: 'published', bots: ['a'], origin_item_id: 'shared' },
  ].map(({ bots, ...doc }) => ({ track: 'knowledge', origin_item_id: null, ...doc, knowledge_links: bots.map((bot_id) => ({ bot_id })) }));
});

async function readAs(botId: string) {
  const route = router.stack.find((layer) => layer.route?.path === '/knowledge')?.route;
  if (!route) throw new Error('Knowledge endpoint not found');
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  // A caller-supplied bot_id must never override the authenticated bot.
  await route.stack[0].handle({ squadBot: { id: botId }, query: { bot_id: 'b' } } as unknown as Request, res as unknown as Response, vi.fn());
  return res.json.mock.calls[0][0].data as any[];
}

describe('bot knowledge access', () => {
  it('serves a shared doc to both bots and keeps private/draft/clone docs out', async () => {
    const a = await readAs('a');
    const b = await readAs('b');
    expect(a.map((doc) => doc.id)).toEqual(['shared', 'only-a']);
    expect(b.map((doc) => doc.id)).toEqual(['shared', 'only-b']);
    expect(a[0].pages).toEqual(b[0].pages);
    expect(a[0]).not.toHaveProperty('knowledge_links');
  });

  it('revokes only the unlinked bot and retains the original shared doc', async () => {
    fixtures.docs[0].knowledge_links = [{ bot_id: 'b' }];
    expect((await readAs('a')).map((doc) => doc.id)).toEqual(['only-a']);
    expect((await readAs('b')).map((doc) => doc.id)).toEqual(['shared', 'only-b']);
    expect(fixtures.docs[0].id).toBe('shared');
  });
});
