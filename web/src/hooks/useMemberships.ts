import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { ResourceMembership, ResourceType, AccessLevel } from '@squadhub/shared';

export function useMemberships(resourceType: ResourceType | null, resourceId: string | null) {
  return useQuery<ResourceMembership[]>({
    queryKey: ['memberships', resourceType, resourceId],
    queryFn: async () => {
      const res = await api.get(`/memberships?resource_type=${resourceType}&resource_id=${resourceId}`);
      return res.data.data;
    },
    enabled: !!resourceType && !!resourceId,
  });
}

export function useAddMember(resourceType: ResourceType, resourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { user_id: string; access_level: AccessLevel }) => {
      const res = await api.post('/memberships', {
        resource_type: resourceType,
        resource_id: resourceId,
        ...body,
      });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships', resourceType, resourceId] });
    },
  });
}

export function useUpdateMemberAccess(resourceType: ResourceType, resourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ membershipId, access_level }: { membershipId: string; access_level: AccessLevel }) => {
      const res = await api.put(`/memberships/${membershipId}`, { access_level });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships', resourceType, resourceId] });
    },
  });
}

export function useRemoveMember(resourceType: ResourceType, resourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (membershipId: string) => {
      await api.delete(`/memberships/${membershipId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships', resourceType, resourceId] });
    },
  });
}
