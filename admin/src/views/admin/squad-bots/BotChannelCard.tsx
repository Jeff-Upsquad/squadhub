import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { errorMessage } from './shared';

type User = { id: string; display_name: string; email: string };
type ChannelData = {
  channel: { id: string; name: string } | null;
  workspaces: { workspace_id: string; workspace: { name: string } }[];
  members: { id: string; user_id: string; access_level: string; user: User }[];
  users: User[];
};
export default function BotChannelCard({ botId }: { botId: string }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const queryKey = ['squad-bot-channel', botId];
  const { data, isLoading, error } = useQuery<ChannelData>({ queryKey, queryFn: () => api.get(`/admin/squad-bots/${botId}/channel`).then(r => r.data.data) });
  const create = useMutation({ mutationFn: () => api.post(`/admin/squad-bots/${botId}/channel`, { workspace_id: workspaceId || data?.workspaces[0]?.workspace_id }), onSuccess: () => qc.invalidateQueries({ queryKey }) });
  const add = useMutation({ mutationFn: () => api.post(`/admin/squad-bots/${botId}/channel/admins`, { user_id: userId }), onSuccess: () => { setUserId(''); qc.invalidateQueries({ queryKey }); } });
  const adminIds = new Set(data?.members.filter(m => m.access_level === 'manager').map(m => m.user_id));
  const appBase = (process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === 'production' ? 'https://squadhub.in' : 'http://localhost:3000')).replace(/\/$/, '');
  return <section className="rounded-xl border border-divider bg-surface p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold">Bot channel</h2>
      {data?.channel && <a className="text-sm underline" href={`${appBase}/app?open_channel=${data.channel.id}`} target="_blank" rel="noreferrer">Open #{data.channel.name} ↗</a>}
    </div>
    <p className="mt-1 text-xs text-foreground-muted">A private channel for questions, saved guidance and human takeovers. Channel admins can invite internal teammates from the channel.</p>
    {isLoading && <p className="mt-3 text-sm">Loading channel…</p>}
    {(error || create.error || add.error) && <p role="alert" className="mt-3 text-sm text-red-600">{errorMessage(error || create.error || add.error, 'Could not update channel')}</p>}
    {data && !data.channel && <div className="mt-4 flex gap-2">
      <select aria-label="Channel workspace" value={workspaceId || data.workspaces[0]?.workspace_id || ''} onChange={e => setWorkspaceId(e.target.value)} className="rounded border border-divider bg-surface px-3 py-2 text-sm">
        {data.workspaces.map(w => <option key={w.workspace_id} value={w.workspace_id}>{w.workspace.name}</option>)}
      </select>
      <button disabled={create.isPending || !data.workspaces.length} onClick={() => create.mutate()} className="rounded bg-foreground px-3 py-2 text-sm text-surface disabled:opacity-40">{create.isPending ? 'Creating…' : 'Create channel'}</button>
    </div>}
    {data?.channel && <>
      <ul className="mt-4 divide-y divide-divider">
        {data.members.map(m => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{m.user.display_name} <span className="text-xs text-foreground-muted">{m.user.email}</span></span><span className="text-xs text-foreground-muted">{m.access_level === 'manager' ? 'Channel admin' : m.access_level}</span></li>)}
      </ul>
      <div className="mt-3 flex gap-2">
        <select aria-label="Choose channel admin" value={userId} onChange={e => setUserId(e.target.value)} className="min-w-0 flex-1 rounded border border-divider bg-surface px-3 py-2 text-sm">
          <option value="">Choose an internal user…</option>
          {data.users.filter(u => !adminIds.has(u.id)).map(u => <option key={u.id} value={u.id}>{u.display_name} — {u.email}</option>)}
        </select>
        <button disabled={!userId || add.isPending} onClick={() => add.mutate()} className="rounded bg-foreground px-3 py-2 text-sm text-surface disabled:opacity-40">{add.isPending ? 'Adding…' : 'Add channel admin'}</button>
      </div>
    </>}
  </section>;
}
