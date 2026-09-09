import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  isAllowedClientViewEmbedUrl,
  parseEmbedPayload,
  requestClientViewEmbed,
  squadhireEmbedHosts,
} from '../utils/squadhireClientViewEmbed';
import {
  actorFieldsForClientViewEvent,
  clientViewRemoteEventSchema,
} from '../utils/squadhireClientViewEvents';

describe('squadhire client-view embed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('allows only SquadHire hosts', () => {
    const hosts = squadhireEmbedHosts(
      'https://squadhire.upsquadconnect.com/api/webhooks/squadhub/cards',
      'https://squadhire.upsquadconnect.com',
    );
    expect(hosts).toEqual(['squadhire.upsquadconnect.com']);
    expect(
      isAllowedClientViewEmbedUrl(
        'https://squadhire.upsquadconnect.com/embed/business/cards/abc?token=1',
        hosts,
      ),
    ).toBe(true);
    expect(isAllowedClientViewEmbedUrl('https://evil.example/phish', hosts)).toBe(false);
    expect(isAllowedClientViewEmbedUrl('javascript:alert(1)', hosts)).toBe(false);
  });

  it('parses nested or flat embed payloads', () => {
    expect(parseEmbedPayload({ embed_url: 'https://hire.example/e' })).toEqual({
      embed_url: 'https://hire.example/e',
      expires_at: null,
    });
    expect(
      parseEmbedPayload({ success: true, data: { embed_url: 'https://hire.example/e', expires_at: '2030-01-01T00:00:00Z' } }),
    ).toEqual({
      embed_url: 'https://hire.example/e',
      expires_at: '2030-01-01T00:00:00Z',
    });
    expect(parseEmbedPayload({ success: true })).toBeNull();
  });

  it('treats 404 as unsupported so the Hub can fall back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) })),
    );
    const result = await requestClientViewEmbed({
      webhookUrl: 'https://squadhire.example/api/webhooks/squadhub/cards',
      webhookSecret: 'secret',
      squadhireAdminUrl: 'https://squadhire.example',
      externalId: '11111111-1111-1111-1111-111111111111',
      actor: { id: 'u1', email: 'jeff@example.com', name: 'Jeff' },
      parentOrigins: ['https://admin.example'],
    });
    expect(result).toEqual({ supported: false, reason: 'not_implemented' });
  });
});

describe('squadhire client-view remote events', () => {
  const base = {
    external_id: '11111111-1111-1111-1111-111111111111',
    event_type: 'client_selected' as const,
    talent_name: 'FUHAD AK',
  };

  it('labels operator vs business', () => {
    expect(
      actorFieldsForClientViewEvent({
        ...base,
        actor_source: 'operator',
        actor: { id: 'hub-1', email: 'jeff@tagconnects.in', name: 'Jeff' },
      }),
    ).toMatchObject({ actorType: 'admin', actorLabel: 'Jeff' });

    expect(
      actorFieldsForClientViewEvent({
        ...base,
        actor_source: 'business',
        actor: { name: 'tag connect' },
      }),
    ).toMatchObject({ actorType: 'business', actorLabel: 'tag connect' });
  });

  it('rejects unknown event types', () => {
    const parsed = clientViewRemoteEventSchema.safeParse({
      ...base,
      actor_source: 'business',
      event_type: 'assigned',
    });
    expect(parsed.success).toBe(false);
  });
});
