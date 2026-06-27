import type { MeetingLinkProviderId, MeetingLinkProviderInfo } from '@squadhub/shared';
import type { MeetingLinkProvider, MeetingLinkContext, MeetingLinkResult } from './types';
import { jitsiProvider } from './jitsi';
import { googleMeetProvider } from './googleMeet';
import { zoomProvider } from './zoom';

// Registry order = dropdown order. Jitsi first (always available).
const PROVIDERS: MeetingLinkProvider[] = [jitsiProvider, googleMeetProvider, zoomProvider];

// The providers a client may pick — only those whose secrets are configured.
export function availableProviders(): MeetingLinkProviderInfo[] {
  return PROVIDERS.filter((p) => p.isConfigured()).map((p) => ({ id: p.id, label: p.label }));
}

export function getProvider(id: MeetingLinkProviderId): MeetingLinkProvider | null {
  const p = PROVIDERS.find((x) => x.id === id);
  return p && p.isConfigured() ? p : null;
}

// Generate a link, falling back to Jitsi if the requested provider is missing or
// errors — a virtual meeting should never be left without a working link.
export async function generateMeetingLink(
  providerId: MeetingLinkProviderId,
  ctx: MeetingLinkContext,
): Promise<MeetingLinkResult> {
  const provider = getProvider(providerId) ?? jitsiProvider;
  try {
    return await provider.generate(ctx);
  } catch (err) {
    console.error(`[meetingProviders] ${provider.id} failed, falling back to jitsi:`, err);
    return jitsiProvider.generate(ctx);
  }
}

export type { MeetingLinkContext, MeetingLinkResult } from './types';
