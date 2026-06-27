import type { MeetingLinkProviderId } from '@squadhub/shared';

// Context passed to a provider when generating a link. Google Meet / Zoom encode
// a start time, so `startsAt` is supplied when known (a representative proposed
// slot on create, or the confirmed slot on confirm). Jitsi ignores it.
export interface MeetingLinkContext {
  meetingEventId: string;
  title: string;
  createdBy: string | null;
  startsAt?: string | null; // ISO timestamp
  durationMin?: number | null;
}

export interface MeetingLinkResult {
  provider: MeetingLinkProviderId;
  url: string;
  meta: Record<string, unknown>; // join/host urls, room id, passcode, etc. → link_meta
}

export interface MeetingLinkProvider {
  id: MeetingLinkProviderId;
  label: string;
  // Whether the provider's secrets are present. Unconfigured providers are
  // hidden from the dropdown and never asked to generate.
  isConfigured(): boolean;
  generate(ctx: MeetingLinkContext): Promise<MeetingLinkResult>;
}

export const PROVIDER_FETCH_TIMEOUT_MS = 10_000;
