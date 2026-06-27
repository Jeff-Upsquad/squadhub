import { config } from '../../config';
import type { MeetingLinkProvider } from './types';

// Jitsi is the zero-setup default: a deterministic, unguessable-enough room URL
// derived from the meeting id. No account, no secret, no outbound call — the
// link works the moment it is created and is embeddable.
export const jitsiProvider: MeetingLinkProvider = {
  id: 'jitsi',
  label: 'Jitsi Meet',
  isConfigured() {
    return true;
  },
  async generate(ctx) {
    const base = (config.jitsiBaseUrl || 'https://meet.jit.si').replace(/\/+$/, '');
    const room = `squadhub-${ctx.meetingEventId}`;
    return {
      provider: 'jitsi',
      url: `${base}/${room}`,
      meta: { room },
    };
  },
};
