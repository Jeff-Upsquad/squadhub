import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import ManageMembersModal from '../pm/ManageMembersModal';

type Question = {
  id: string; question: string; context: string; source_url: string; status: string;
  instruction: string | null; outcome_note: string | null; created_at: string;
};
type Questions = { questions: Question[]; total: number; can_respond: boolean; can_invite: boolean };
const labels: Record<string, string> = { open: 'Needs your help', instructed: 'Guidance saved · awaiting bot', executing: 'Bot is taking action', taken_over: 'A teammate has taken over', completed: 'Action completed', failed: 'Action failed' };
function sourceUrl(value: string) {
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? value : null; } catch { return null; }
}
export default function BotQuestions({ channelId, channelName, active }: { channelId: string; channelName: string; active: boolean }) {
  const [page, setPage] = useState(0);
  const [invite, setInvite] = useState(false);
  const { data, isLoading, error } = useQuery<Questions>({
    queryKey: ['bot-questions', channelId, page],
    queryFn: () => api.get(`/bot-channels/${channelId}/doubts`, { params: { page } }).then(r => r.data.data),
    refetchInterval: active ? 5000 : false,
  });
  return <section className="m-4 rounded-xl border border-divider bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">🤖 Bot questions</h2>
      {data?.can_invite && <button className="rounded border border-divider px-3 py-1 text-xs" onClick={() => setInvite(true)}>Invite teammates</button>}
    </div>
    <p className="mt-1 text-xs text-foreground-muted">Reply to a question below to teach the bot and queue its action, or take over at the source. Regular channel messages are team discussion.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">Could not load bot questions. Please try again.</p>}
    {isLoading && <p className="mt-3 text-sm text-foreground-muted">Loading questions…</p>}
    {data && !data.questions.length && <p className="mt-4 text-sm text-foreground-muted">No questions yet. The bot will ask here when it needs your help.</p>}
    <div className="mt-3 space-y-3">{data?.questions.map(q => <QuestionCard key={q.id} question={q} channelId={channelId} canRespond={data.can_respond} />)}</div>
    {data && data.total > 25 && <div className="mt-3 flex items-center justify-between text-xs">
      <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Newer</button><span>Page {page + 1} of {Math.ceil(data.total / 25)}</span><button disabled={(page + 1) * 25 >= data.total} onClick={() => setPage(p => p + 1)}>Older →</button>
    </div>}
    {invite && <ManageMembersModal resourceType="channel" resourceId={channelId} resourceName={channelName} internalOnly onClose={() => setInvite(false)} />}
  </section>;
}
function QuestionCard({ question: q, channelId, canRespond }: { question: Question; channelId: string; canRespond: boolean }) {
  const [instruction, setInstruction] = useState('');
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();
  const source = sourceUrl(q.source_url);
  const respond = useMutation({
    mutationFn: (mode: 'instruct' | 'takeover') => api.post(`/bot-channels/${channelId}/doubts/${q.id}/resolve`, { mode, ...(mode === 'instruct' ? { instruction } : {}) }),
    onSuccess: (_, mode) => { setEditing(false); setInstruction(''); qc.invalidateQueries({ queryKey: ['bot-questions', channelId] }); if (mode === 'takeover' && source) window.location.assign(source); },
    onError: () => qc.invalidateQueries({ queryKey: ['bot-questions', channelId] }),
  });
  return <article className="rounded-lg border border-divider p-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-muted"><span>{labels[q.status] || q.status}</span><time>{new Date(q.created_at).toLocaleString()}</time></div>
    <p className="mt-2 whitespace-pre-wrap text-sm font-medium">{q.question}</p>
    {q.context && <details className="mt-2 text-xs text-foreground-muted"><summary className="cursor-pointer">Context</summary><p className="mt-1 whitespace-pre-wrap">{q.context}</p></details>}
    {q.instruction && <p className="mt-3 whitespace-pre-wrap rounded bg-surface-alt p-2 text-sm"><strong>Saved guidance:</strong> {q.instruction}</p>}
    {q.outcome_note && <p className="mt-2 whitespace-pre-wrap text-sm">{q.outcome_note}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
      {source && <a href={source} target="_blank" rel="noreferrer" className="underline" title="Open the exact conversation or thread">Open source ↗</a>}
      {canRespond && q.status === 'open' && <button className="rounded bg-foreground px-3 py-1.5 text-surface" disabled={respond.isPending} onClick={() => setEditing(!editing)}>Tell bot what to do</button>}
      {canRespond && source && ['open','instructed','failed'].includes(q.status) && <button className="rounded border border-divider px-3 py-1.5" disabled={respond.isPending} onClick={() => respond.mutate('takeover')}>Take over ↗</button>}
    </div>
    {editing && q.status === 'open' && <form className="mt-3" onSubmit={e => { e.preventDefault(); respond.mutate('instruct'); }}>
      <textarea aria-label="Instructions for the bot" value={instruction} onChange={e => setInstruction(e.target.value)} maxLength={4000} rows={3} className="w-full rounded border border-divider bg-surface p-2 text-sm" placeholder="Tell the bot what to do. For a reply, include what it should send." />
      <p className="mt-1 text-xs text-foreground-muted">Guidance is saved now. The bot’s action will appear here when completed.</p>
      <button type="submit" disabled={!instruction.trim() || respond.isPending} className="mt-2 rounded bg-foreground px-3 py-1.5 text-xs text-surface disabled:opacity-40">{respond.isPending ? 'Saving…' : 'Save guidance & send to bot'}</button>
    </form>}
    {respond.error && <p role="alert" className="mt-2 text-xs text-red-600">{(respond.error as any).response?.data?.error || 'Could not save your response'}</p>}
  </article>;
}
