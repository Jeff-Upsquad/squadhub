import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { connectSocket } from '../services/socket';
import type { HuddleDetail, HuddleJoinCredentials } from '@squadhub/shared';
import type { ChatKind } from '../stores/workspaceStore';

// Huddle queries. Live state arrives over the socket as `huddle_updated`
// pushed to the conversation room (channel id / dm id), which every open
// chat already joins — so one global listener (useHuddleSocketSync, mounted
// in MainLayout) keeps the per-huddle and per-conversation caches fresh.

export const huddleKey = (id: string) => ['huddles', id] as const;
export const activeHuddleKey = (kind: ChatKind, channelId: string) => ['huddles', 'active', kind, channelId] as const;

export function useHuddlesEnabled() {
  return useQuery<boolean>({
    queryKey: ['huddles', 'config'],
    queryFn: async () => !!(await api.get('/huddles/config')).data.data?.enabled,
    staleTime: 10 * 60_000,
  });
}

export function useHuddle(id: string | null) {
  return useQuery<HuddleDetail>({
    queryKey: huddleKey(id || ''),
    queryFn: async () => (await api.get(`/huddles/${id}`)).data.data,
    enabled: !!id,
    staleTime: 30_000,
  });
}

// The live huddle for a conversation (null when none). Drives the header pill.
export function useActiveHuddle(kind: ChatKind, channelId: string | null) {
  return useQuery<HuddleDetail | null>({
    queryKey: activeHuddleKey(kind, channelId || ''),
    queryFn: async () => {
      const param = kind === 'dm' ? 'dm_conversation_id' : 'channel_id';
      return (await api.get(`/huddles/active?${param}=${channelId}`)).data.data ?? null;
    },
    enabled: !!channelId,
    staleTime: 30_000,
  });
}

export function useHuddleSocketSync() {
  const qc = useQueryClient();
  useEffect(() => {
    // connectSocket() is idempotent and returns the shared socket even before
    // MainLayout's own connect effect has run (child effects fire first).
    const socket = connectSocket();
    const onUpdate = (detail: HuddleDetail) => {
      if (!detail?.huddle?.id) return;
      qc.setQueryData(huddleKey(detail.huddle.id), detail);
      const kind: ChatKind = detail.huddle.dm_conversation_id ? 'dm' : 'channel';
      const convId = detail.huddle.dm_conversation_id || detail.huddle.channel_id;
      if (convId) qc.setQueryData(activeHuddleKey(kind, convId), detail.huddle.ended_at ? null : detail);
    };
    socket.on('huddle_updated', onUpdate);
    return () => {
      socket.off('huddle_updated', onUpdate);
    };
  }, [qc]);
}

function applyCreds(qc: ReturnType<typeof useQueryClient>, creds: HuddleJoinCredentials) {
  const h = creds.huddle.huddle;
  qc.setQueryData(huddleKey(h.id), creds.huddle);
  const kind: ChatKind = h.dm_conversation_id ? 'dm' : 'channel';
  const convId = h.dm_conversation_id || h.channel_id;
  if (convId) qc.setQueryData(activeHuddleKey(kind, convId), creds.huddle);
}

export function useStartHuddle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: ChatKind; channelId: string; topic?: string }) => {
      const body = input.kind === 'dm' ? { dm_conversation_id: input.channelId } : { channel_id: input.channelId };
      return (await api.post('/huddles', { ...body, topic: input.topic })).data.data as HuddleJoinCredentials;
    },
    onSuccess: (creds) => applyCreds(qc, creds),
  });
}

export function useJoinHuddle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (huddleId: string) => (await api.post(`/huddles/${huddleId}/join`)).data.data as HuddleJoinCredentials,
    onSuccess: (creds) => applyCreds(qc, creds),
  });
}

export async function leaveHuddleRequest(huddleId: string): Promise<void> {
  await api.post(`/huddles/${huddleId}/leave`).catch(() => undefined);
}

export function useHuddleActions(huddleId: string | null) {
  const qc = useQueryClient();
  const apply = (detail: HuddleDetail | null | undefined) => {
    if (detail?.huddle?.id) qc.setQueryData(huddleKey(detail.huddle.id), detail);
  };
  const end = useMutation({
    mutationFn: async () => (await api.post(`/huddles/${huddleId}/end`)).data.data as HuddleDetail,
    onSuccess: apply,
  });
  const patch = useMutation({
    mutationFn: async (body: { topic?: string | null; allow_guests?: boolean }) =>
      (await api.patch(`/huddles/${huddleId}`, body)).data.data as HuddleDetail,
    onSuccess: apply,
  });
  return { end, patch };
}
