import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CandidateNote, CandidatePermission } from '@squadhub/shared';
import api from '../../../services/api';
import { showToast } from '../../../components/Toast';
import { canEdit, canManage } from './helpers';

function errMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || fallback;
}

export default function NotesSection({
  candidateId,
  formType,
  level,
}: {
  candidateId: string;
  formType: string;
  level: CandidatePermission | undefined;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editable = canEdit(level);
  const manageable = canManage(level);
  // noteId routes carry no candidate id, so pass the category for the server guard.
  const catParam = `?form_type=${encodeURIComponent(formType)}`;

  const { data: notes = [], isLoading } = useQuery<CandidateNote[]>({
    queryKey: ['candidate-notes', candidateId],
    queryFn: async () => (await api.get(`/candidates/${candidateId}/notes`)).data.notes ?? [],
    enabled: !!candidateId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['candidate-notes', candidateId] });

  const addMutation = useMutation({
    mutationFn: async (content: string) => { await api.post(`/candidates/${candidateId}/notes`, { content }); },
    onSuccess: () => { setDraft(''); invalidate(); },
    onError: (err) => showToast(errMessage(err, 'Failed to add note')),
  });

  const editMutation = useMutation({
    mutationFn: async ({ noteId, content }: { noteId: string; content: string }) => {
      await api.patch(`/candidates/notes/${noteId}${catParam}`, { content });
    },
    onSuccess: () => { setEditingId(null); setEditDraft(''); invalidate(); },
    onError: (err) => showToast(errMessage(err, 'Failed to update note')),
  });

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => { await api.delete(`/candidates/notes/${noteId}${catParam}`); },
    onSuccess: () => invalidate(),
    onError: (err) => showToast(errMessage(err, 'Failed to delete note')),
  });

  return (
    <div className="space-y-3">
      {/* Composer — Edit access or higher */}
      {editable && (
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Add a note…"
            className="flex-1 resize-none rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            onClick={() => draft.trim() && addMutation.mutate(draft.trim())}
            disabled={!draft.trim() || addMutation.isPending}
            className="self-end rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="h-10 animate-pulse rounded-lg bg-foreground/5" />
      ) : notes.length === 0 ? (
        <p className="text-sm text-foreground-dim">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-divider bg-canvas px-3 py-2">
              {editingId === note.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-[var(--color-accent)] focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => editDraft.trim() && editMutation.mutate({ noteId: note.id, content: editDraft.trim() })}
                      disabled={editMutation.isPending}
                      className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="rounded-md px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="group">
                  <p className="whitespace-pre-wrap text-sm text-foreground">{note.content}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-foreground-dim">
                    <span>{new Date(note.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {editable && (
                      <button
                        onClick={() => { setEditingId(note.id); setEditDraft(note.content); }}
                        className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        Edit
                      </button>
                    )}
                    {manageable && (
                      <button
                        onClick={() => { if (window.confirm('Delete this note?')) deleteMutation.mutate(note.id); }}
                        className="opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
