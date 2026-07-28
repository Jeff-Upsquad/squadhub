'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsItemComment } from '@squadhub/shared';

// Staff-only review comments for an item. Admins (and, in the web app,
// contributors/commenters) share the same /lms/collab endpoints.
export default function CommentsPanel({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  const { data: res } = useQuery({
    queryKey: ['lms-comments', itemId],
    queryFn: () => api.get(`/lms/collab/items/${itemId}/comments`).then((r) => r.data),
  });
  const comments: LmsItemComment[] = res?.data || [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['lms-comments', itemId] });

  const post = useMutation({
    mutationFn: (body: string) => api.post(`/lms/collab/items/${itemId}/comments`, { body }),
    onSuccess: () => { setDraft(''); invalidate(); },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to comment'),
  });

  const resolve = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      api.patch(`/lms/collab/comments/${id}`, { resolved }),
    onSuccess: invalidate,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/lms/collab/comments/${id}`),
    onSuccess: invalidate,
  });

  const open = comments.filter((c) => !c.resolved_at);
  const resolved = comments.filter((c) => c.resolved_at);

  return (
    <div>
      <div className="mb-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Leave a comment for the team…"
          className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
        />
        <div className="mt-1.5 flex justify-end">
          <button
            onClick={() => draft.trim() && post.mutate(draft.trim())}
            disabled={!draft.trim() || post.isPending}
            className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            {post.isPending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>

      {comments.length === 0 ? (
        <p className="py-2 text-center text-[12px] text-foreground-dim">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((c) => (
            <CommentRow key={c.id} c={c} onResolve={() => resolve.mutate({ id: c.id, resolved: true })} onDelete={() => del.mutate(c.id)} />
          ))}
          {resolved.length > 0 && (
            <li className="pt-1 text-[10px] font-medium uppercase tracking-wider text-foreground-dim">Resolved</li>
          )}
          {resolved.map((c) => (
            <CommentRow key={c.id} c={c} resolved onResolve={() => resolve.mutate({ id: c.id, resolved: false })} onDelete={() => del.mutate(c.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentRow({ c, resolved, onResolve, onDelete }: { c: LmsItemComment; resolved?: boolean; onResolve: () => void; onDelete: () => void }) {
  return (
    <li className={`rounded-md border px-3 py-2 ${resolved ? 'border-divider bg-canvas opacity-70' : 'border-divider bg-surface'}`}>
      <div className="mb-0.5 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-canvas text-[9px] font-semibold text-foreground-muted">
          {(c.author?.display_name || '?').slice(0, 2).toUpperCase()}
        </span>
        <span className="text-[12px] font-medium text-foreground">{c.author?.display_name || 'Unknown'}</span>
        <span className="text-[10px] text-foreground-dim">{new Date(c.created_at).toLocaleDateString()}</span>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={onResolve} className="text-[11px] text-foreground-muted hover:text-foreground" title={resolved ? 'Reopen' : 'Mark resolved'}>
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button onClick={onDelete} className="text-[11px] text-foreground-dim hover:text-red-600">Delete</button>
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-snug text-foreground">{c.body}</p>
    </li>
  );
}
