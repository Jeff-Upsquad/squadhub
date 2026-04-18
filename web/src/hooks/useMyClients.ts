import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import api from '../services/api';
import type { Client, ClientAccessLevel, ClientSpaceTemplate, Folder } from '@squadhub/shared';

export interface MyClientEntry {
  id: string;
  client_id: string;
  access_level: ClientAccessLevel;
  created_at: string;
  client: Client;
}

export function useMyClients() {
  return useQuery<MyClientEntry[]>({
    queryKey: ['my-clients'],
    queryFn: async () => {
      const res = await api.get('/users/me/clients');
      return res.data.data;
    },
  });
}

export interface ClientFoldersResult {
  folders: (Folder & { client_space_template?: { id: string; slug: string; name: string; icon: string } })[];
  access_level: ClientAccessLevel | null;
}

export function useClientFolders(clientId: string | null) {
  return useQuery<ClientFoldersResult>({
    queryKey: ['client-folders', clientId],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/by-client/${clientId}`);
      return {
        folders: res.data.data,
        access_level: res.data.client_access_level ?? null,
      };
    },
    enabled: !!clientId,
  });
}

export function useAvailableClientSpaceTemplates() {
  return useQuery<ClientSpaceTemplate[]>({
    queryKey: ['available-client-space-templates'],
    queryFn: async () => {
      const res = await api.get('/client-spaces/available');
      return res.data.data;
    },
  });
}

export function useCreateClientSpace(clientId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      space_id: string;
      name: string;
      client_space_template_id: string;
    }) => {
      const res = await api.post('/pm/folders', { ...body, client_id: clientId });
      return res.data.data as Folder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-folders', clientId] });
    },
  });
}
