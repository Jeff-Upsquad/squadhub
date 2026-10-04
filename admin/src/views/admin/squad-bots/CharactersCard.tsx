import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { errorMessage } from './shared';
interface Character { id:string;name:string;description:string;greeting:string;active:boolean;color:string }
export default function CharactersCard({botId,botName}:{botId:string;botName:string}) {
  const qc=useQueryClient();const [name,setName]=useState('');const [greeting,setGreeting]=useState('');
  const key=['squad-bot-characters',botId];
  const {data, error, isLoading}=useQuery<Character[]>({queryKey:key,queryFn:()=>api.get(`/admin/squad-bots/${botId}/characters`).then(r=>r.data.data)});
  const create=useMutation({mutationFn:()=>api.post(`/admin/squad-bots/${botId}/characters`,{name,greeting}),onSuccess:()=>{setName('');setGreeting('');qc.invalidateQueries({queryKey:key});}});
  const toggle=useMutation({mutationFn:(c:Character)=>api.patch(`/admin/squad-bots/${botId}/characters/${c.id}`,{active:!c.active}),onSuccess:()=>qc.invalidateQueries({queryKey:key})});
  return <section className="rounded-xl border border-divider bg-surface p-5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-[15px] font-semibold text-foreground">Characters</h2><p className="mt-1 text-[12px] text-foreground-muted">Named characters introduce themselves to customers. They inherit {botName}’s knowledge, AI settings, and jobs.</p></div><a href={process.env.NEXT_PUBLIC_SQUAD_BOTS_URL || 'http://localhost:3020'} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-foreground-muted hover:underline">Conversations ↗</a></div>
    {isLoading&&<p className="mt-3 text-sm text-foreground-muted">Loading characters…</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-600">Could not load characters.</p>}
    <div className="mt-4 space-y-2">{data?.map(c=><div key={c.id} className="flex items-center justify-between rounded-lg border border-divider p-3"><div><p className="text-sm font-medium">{c.name}</p><p className="mt-1 text-[12px] text-foreground-muted">{c.greeting||c.description||'Shares the parent bot’s knowledge and capabilities.'}</p><code className="mt-1 block text-[10px] text-foreground-dim">{c.id}</code></div><button onClick={()=>toggle.mutate(c)} disabled={toggle.isPending} className="ml-3 rounded border border-divider px-3 py-1.5 text-xs">{c.active?'Pause':'Activate'}</button></div>)}</div>
    <form onSubmit={e=>{e.preventDefault();create.mutate();}} className="mt-4 flex flex-wrap items-end gap-3"><label className="flex-1 text-[11px] text-foreground-muted">Character name<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="John or Tina" className="mt-1 block w-full rounded border border-divider bg-surface px-3 py-2 text-sm"/></label><label className="flex-[2] text-[11px] text-foreground-muted">First hello (optional)<input maxLength={1000} value={greeting} onChange={e=>setGreeting(e.target.value)} placeholder="Hi, I’m John, your hiring assistant." className="mt-1 block w-full rounded border border-divider bg-surface px-3 py-2 text-sm"/></label><button disabled={!name.trim()||create.isPending} className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-40">{create.isPending?'Creating…':'+ Create character'}</button></form>
    {(create.error||toggle.error)&&<p role="alert" className="mt-3 text-xs text-red-600">{errorMessage(create.error||toggle.error,'Could not save character')}</p>}
  </section>;
}
