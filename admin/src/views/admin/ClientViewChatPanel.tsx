'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

type ChatMessage = {
  id: string;
  sender_type: string;
  sender_id: string | null;
  sender_name: string | null;
  kind: string;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ClientViewChatPanel({
  cardId,
  talentUserId,
  talentName,
  onClose,
}: {
  cardId: string;
  talentUserId: string;
  talentName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const open = useQuery({
    queryKey: ['client-view-conversation', cardId, talentUserId],
    queryFn: async () => {
      const r = await api.post(`/admin/subscription-cards/${cardId}/client-view/conversations`, {
        talent_user_id: talentUserId,
        talent_name: talentName,
      });
      return r.data as { conversation: { id: string }; display_name?: string };
    },
  });

  const conversationId = open.data?.conversation?.id;
  const myName = open.data?.display_name ?? null;

  const messagesQ = useQuery({
    queryKey: ['client-view-messages', conversationId],
    queryFn: async () => {
      const r = await api.post(`/admin/subscription-cards/${cardId}/client-view/conversations/messages`, {
        conversation_id: conversationId,
      });
      return r.data as { messages: ChatMessage[]; display_name?: string };
    },
    enabled: !!conversationId,
    refetchInterval: 8_000,
  });

  const send = useMutation({
    mutationFn: async (body: string) => {
      const r = await api.post(`/admin/subscription-cards/${cardId}/client-view/conversations/send`, {
        conversation_id: conversationId,
        body,
        talent_user_id: talentUserId,
        talent_name: talentName,
      });
      return r.data;
    },
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['client-view-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['admin-card-events', cardId] });
    },
    onError: (e: any) => {
      showToast(e?.response?.data?.error || 'Could not send message', 'error');
    },
  });

  const messages = messagesQ.data?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const submit = () => {
    const body = draft.trim();
    if (!body || !conversationId || send.isPending) return;
    send.mutate(body);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="Close chat" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-[var(--color-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">Chatroom · {talentName}</p>
            <p className="truncate text-[11px] text-[var(--color-sh-ink-subtle)]">
              Messages show as {myName || 'you'}, not the business
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--color-sh-ink-subtle)] hover:bg-[var(--color-sh-cream)]"
          >
            Close
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {open.isLoading && <p className="text-sm text-[var(--color-sh-ink-subtle)]">Opening room…</p>}
          {open.isError && (
            <p className="text-sm text-red-600">
              {(open.error as any)?.response?.data?.error || 'Could not open the chatroom.'}
            </p>
          )}
          {messagesQ.isLoading && conversationId && (
            <p className="text-sm text-[var(--color-sh-ink-subtle)]">Loading messages…</p>
          )}
          {messages.map((m) => {
            const mine = m.sender_type === 'staff' || m.sender_type === 'admin' || m.sender_type === 'salesperson';
            const system = m.sender_type === 'system';
            if (system) {
              return (
                <p key={m.id} className="text-center text-[11px] text-[var(--color-sh-ink-faint)]">
                  {m.body}
                </p>
              );
            }
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                    mine
                      ? 'bg-[var(--color-sh-ink)] text-white'
                      : 'bg-[var(--color-sh-cream)] text-[var(--color-sh-ink)]'
                  }`}
                >
                  <p className={mine ? 'text-[10px] font-semibold text-white/70' : 'text-[10px] font-semibold text-[var(--color-sh-ink-subtle)]'}>
                    {mine ? 'You' : m.sender_name || 'Talent'}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                  <p className={mine ? 'mt-1 text-[10px] text-white/50' : 'mt-1 text-[10px] text-[var(--color-sh-ink-faint)]'}>
                    {formatTime(m.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--color-sh-warm-border)] p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder={conversationId ? 'Write a message…' : 'Opening room…'}
              disabled={!conversationId || send.isPending}
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-sh-ink)] outline-none focus:border-[var(--color-sh-ink)]"
            />
            <button
              type="button"
              disabled={!conversationId || !draft.trim() || send.isPending}
              onClick={submit}
              className="rounded-xl bg-[var(--color-sh-ink)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
