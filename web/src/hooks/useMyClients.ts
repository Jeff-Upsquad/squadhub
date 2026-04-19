import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { Client, ClientAccessLevel, ClientSpaceTemplate, Folder } from '@squadhub/shared';

export interface MyClientRole {
  id: string;
  name: string;
  color: string;
  is_system: boolean;
}

export interface MyClientEntry {
  id: string;
  client_id: string;
  role_id: string | null;
  role: MyClientRole | null;
  created_at: string;
  client: Client;
}

export function useMyClients() {
  return useQuery<MyClientEntry[]>({
    queryKey: ['my-clients'],
    queryFn: async () => {
      const res = await api.get('/users/me/clients');
      return res.data?.data ?? [];
    },
  });
}

export interface ClientFoldersResult {
  folders: (Folder & { client_space_template?: { id: string; slug: string; name: string; icon: string } })[];
}

export function useClientFolders(clientId: string | null) {
  return useQuery<ClientFoldersResult>({
    queryKey: ['client-folders', clientId],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/by-client/${clientId}`);
      return {
        folders: res.data?.data ?? [],
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
