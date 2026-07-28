'use client';
import { useState } from 'react';
import type { LmsAccessLevel, LmsItemComment } from '@squadhub/shared';
import { useLmsComments, useCommentMutations } from '../../../hooks/useLmsCollab';

// Staff-only review comments. Rendered only for commenter+ access. Contributor+
// can resolve/delete; a commenter can post and delete their own.
export default function LmsCommentsPanel({ itemId, access }: { itemId: string; access: LmsAccessLevel }) {
  const { data: comments } = useLmsComments(itemId, true);
  const { post, resolve, remove } = useCommentMutations(itemId);
  const [draft, setDraft] = useState('');
  const canModerate = access === 'contributor' || access === 'admin';

  const list = comments || [];
  const open = list.filter((c) => !c.resolved_at);
  const resolved = list.filter((c) => c.resolved_at);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--sh-hair)] px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">Comments</div>
        <p className="mt-0.5 text-[11px] text-[var(--sh-ink-3)]">Staff-only — not shown to view-only readers.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {list.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-[var(--sh-ink-3)]">No comments yet.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((c) => (
              <Row key={c.id} c={c} canModerate={canModerate} onResolve={() => resolve.mutate({ id: c.id, resolved: true })} onDelete={() => remove.mutate(c.id)} />
            ))}
            {resolved.length > 0 && <li className="pt-1 text-[10px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">Resolved</li>}
            {resolved.map((c) => (
              <Row key={c.id} c={c} resolved canModerate={canModerate} onResolve={() => resolve.mutate({ id: c.id, resolved: false })} onDelete={() => remove.mutate(c.id)} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--sh-hair)] p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2.5 py-2 text-[13px] outline-none focus:border-[var(--sh-ink)]"
        />
        <div className="mt-1.5 flex justify-end">
          <button
            onClick={() => { if (draft.trim()) { post.mutate(draft.trim()); setDraft(''); } }}
            disabled={!draft.trim() || post.isPending}
            className="rounded-md bg-[var(--sh-ink)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--sidebar)] hover:opacity-90 disabled:opacity-50"
          >
            {post.isPending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ c, resolved, canModerate, onResolve, onDelete }: {
  c: LmsItemComment; resolved?: boolean; canModerate: boolean; onResolve: () => void; onDelete: () => void;
}) {
  return (
    <li className={`rounded-md border border-[var(--sh-hair)] px-2.5 py-2 ${resolved ? 'bg-[var(--sh-hair-3)] opacity-70' : 'bg-[var(--surface)]'}`}>
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--sh-hair)] text-[9px] font-semibold text-[var(--sh-ink-3)]">
          {(c.author?.display_name || '?').slice(0, 2).toUpperCase()}
        </span>
        <span className="text-[12px] font-medium text-[var(--sh-ink)]">{c.author?.display_name || 'Unknown'}</span>
        <span className="text-[10px] text-[var(--sh-ink-3)]">{new Date(c.created_at).toLocaleDateString()}</span>
        {canModerate && (
          <span className="ml-auto flex items-center gap-1.5">
            <button onClick={onResolve} className="text-[10.5px] text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]">{resolved ? 'Reopen' : 'Resolve'}</button>
            <button onClick={onDelete} className="text-[10.5px] text-[var(--sh-ink-3)] hover:text-red-600">Delete</button>
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-[var(--sh-ink-2)]">{c.body}</p>
    </li>
  );
}
