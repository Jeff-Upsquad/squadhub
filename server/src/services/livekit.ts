import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config';

// Thin wrapper over the LiveKit server SDK for Huddles. Everything is gated on
// isConfigured() so a box without LIVEKIT_* env boots and simply hides the
// feature. Token minting is local (HMAC); only listParticipants / deleteRoom
// call the LiveKit API.

export function isLivekitConfigured(): boolean {
  return !!(config.livekitUrl && config.livekitApiKey && config.livekitApiSecret);
}

// The REST host is the ws(s):// URL with the scheme swapped.
function restHost(): string {
  return config.livekitUrl.replace(/^ws(s?):\/\//, 'http$1://');
}

let roomService: RoomServiceClient | null = null;
function rooms(): RoomServiceClient {
  if (!roomService) roomService = new RoomServiceClient(restHost(), config.livekitApiKey, config.livekitApiSecret);
  return roomService;
}

export interface MintTokenInput {
  roomName: string;
  identity: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export async function mintJoinToken(input: MintTokenInput): Promise<string> {
  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: input.identity,
    name: input.name,
    metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    ttl: '6h',
  });
  at.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

// Identities currently connected to the room, or null if LiveKit is
// unreachable (callers treat null as "unknown", not "empty").
export async function listRoomIdentities(roomName: string): Promise<string[] | null> {
  try {
    const parts = await rooms().listParticipants(roomName);
    return parts.map((p) => p.identity);
  } catch (err: any) {
    // A room that has never been created / already closed → 404 → empty.
    if (err?.status === 404 || /not found/i.test(String(err?.message))) return [];
    console.error('[livekit] listParticipants failed:', err?.message || err);
    return null;
  }
}

export async function closeRoom(roomName: string): Promise<void> {
  try {
    await rooms().deleteRoom(roomName);
  } catch (err: any) {
    if (err?.status === 404 || /not found/i.test(String(err?.message))) return;
    console.error('[livekit] deleteRoom failed:', err?.message || err);
  }
}
