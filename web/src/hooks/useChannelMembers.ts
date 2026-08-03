import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export type ChannelMemberUser = {
  id: string;
  display_name: string | null;
  email?: string | null;
  avatar_url: string | null;
};

/** People with access to a channel (any membership level). Safe for facepiles. */
export function useChannelMembers(channelId: string | null | undefined) {
  return useQuery<ChannelMemberUser[]>({
    queryKey: ['channel-members', channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const res = await api.get(`/channels/${channelId}/members`);
      return res.data.data ?? [];
    },
    // Mentions can add people mid-conversation — keep the facepile reasonably fresh.
    refetchInterval: 30_000,
  });
}
