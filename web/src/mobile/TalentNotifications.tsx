'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubscriptionCardRecipient } from '@squadhub/shared';
import api from '../services/api';
import {
  RequestSheet,
  cardType,
  fetchTalentOpportunities,
  priceLabel,
  requestMeta,
  requestTitle,
  type OpportunityCard,
} from './MobileDiscover';

type AttentionKind = 'regular' | 'shortlist' | 'selection';

function attentionKind(recipient: SubscriptionCardRecipient): AttentionKind {
  const card = recipient.card as OpportunityCard | undefined;
  const stage = String(card?.funnel_stage || '').toLowerCase();
  if (['selected', 'offer', 'hired', 'placed'].includes(stage)) return 'selection';
  if (recipient.selected_at && cardType(recipient) !== 'hiring') return 'selection';
  if (recipient.business_review_status === 'shortlisted' || ['shortlisted', 'interview_invited', 'interview', 'on_hold'].includes(stage)) return 'shortlist';
  return 'regular';
}

function relativeTime(value: string | null | undefined) {
  if (!value) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1_440)}d ago`;
}

function copyFor(kind: AttentionKind, recipient: SubscriptionCardRecipient) {
  const type = cardType(recipient);
  if (kind === 'selection') return { eyebrow: 'You’ve been selected', title: 'The business chose you', body: `Confirm that you’re ready to start this ${type === 'hiring' ? 'role' : type}.` };
  if (kind === 'shortlist') return { eyebrow: 'Shortlisted', title: 'A business wants to move forward', body: 'Let them know if you’re still interested and ready for the next step.' };
  return { eyebrow: `New ${type}`, title: 'A new opportunity matches your profile', body: 'Review the card details and respond when you’re ready.' };
}

export function useOpportunityNotifications() {
  return useQuery({
    queryKey: ['partner-opportunities-discover'],
    queryFn: fetchTalentOpportunities,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

function useNotificationResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recipient, kind, action }: { recipient: SubscriptionCardRecipient; kind: Exclude<AttentionKind, 'regular'>; action: 'confirm' | 'decline' }) =>
      api.post(`/partner/discover/opportunities/${recipient.id}/notification-response`, {
        kind,
        action,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['partner-opportunities-discover'] }),
  });
}

/** High-attention prompts are mounted at shell level so they appear over any tab. */
export function TalentNotificationPrompts() {
  const query = useOpportunityNotifications();
  const response = useNotificationResponse();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const items = query.data || [];
  const actionable = (kind: 'shortlist' | 'selection') => items.find((item) =>
    attentionKind(item) === kind && !item.notification_responses?.[kind] && !hidden.has(`${kind}:${item.id}`),
  );
  const selected = actionable('selection');
  const shortlisted = actionable('shortlist');

  const hide = (kind: 'shortlist' | 'selection', id: string) => setHidden((current) => new Set(current).add(`${kind}:${id}`));
  const decide = (recipient: SubscriptionCardRecipient, kind: 'shortlist' | 'selection', action: 'confirm' | 'decline') =>
    response.mutate({ recipient, kind, action });

  return (
    <>
      {shortlisted && !selected && (
        <section className="fixed left-3 right-3 top-[max(12px,env(safe-area-inset-top))] z-[440] mx-auto max-w-lg overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-[0_16px_48px_rgba(15,23,42,.22)]" role="alertdialog" aria-label="Shortlist notification">
          <div className="h-1 bg-amber-400" />
          <div className="p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl">★</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-amber-700">Shortlisted · action needed</p>
                <h2 className="mt-1 text-[16px] font-semibold leading-tight text-[#0a0a0a]">Are you ready to move forward?</h2>
                <p className="mt-1 truncate text-xs text-[#737373]">{requestTitle(shortlisted.card as OpportunityCard)}</p>
              </div>
              <button type="button" onClick={() => hide('shortlist', shortlisted.id)} className="rounded-full p-1 text-[#737373]" aria-label="Remind me later">×</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={response.isPending} onClick={() => decide(shortlisted, 'shortlist', 'decline')} className="rounded-xl border border-[#E7E7EA] px-4 py-2.5 text-sm font-semibold text-[#525252]">Not now</button>
              <button type="button" disabled={response.isPending} onClick={() => decide(shortlisted, 'shortlist', 'confirm')} className="rounded-xl bg-[#0a0a0a] px-4 py-2.5 text-sm font-semibold text-white">{response.isPending ? 'Saving…' : 'Yes, I’m ready'}</button>
            </div>
            {response.isError && <p className="mt-2 text-center text-xs font-medium text-red-600">We couldn’t save that. Please try again.</p>}
          </div>
        </section>
      )}

      {selected && (
        <div className="fixed inset-0 z-[450] flex items-end justify-center" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-label="Remind me later" onClick={() => hide('selection', selected.id)} />
          <section className="relative flex max-h-[72dvh] min-h-[52dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-20px_60px_rgba(0,0,0,.28)]" role="alertdialog" aria-modal="true" aria-label="Selection notification">
            <div className="mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-[#D4D4D8]" />
            <div className="overflow-y-auto px-5 pb-5 pt-4">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-emerald-700">Selected · confirm now</span>
                <button type="button" onClick={() => hide('selection', selected.id)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F5F6] text-lg text-[#525252]" aria-label="Remind me later">×</button>
              </div>
              <div className="mt-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-2xl text-white shadow-lg shadow-emerald-200">✓</div>
              <h2 className="mt-4 text-[24px] font-semibold leading-tight tracking-[-.03em] text-[#0a0a0a]">You’ve been selected!</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#525252]">The business chose your profile. Review the key details and confirm that you’re ready to move forward.</p>
              <div className="mt-5 rounded-2xl border border-[#E7E7EA] bg-[#F8F8F9] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#737373]">{cardType(selected)}</p>
                <h3 className="mt-1 text-[16px] font-semibold text-[#0a0a0a]">{requestTitle(selected.card as OpportunityCard)}</h3>
                {requestMeta(selected.card as OpportunityCard) && <p className="mt-1 text-xs text-[#737373]">{requestMeta(selected.card as OpportunityCard)}</p>}
                <div className="mt-4 flex items-center justify-between border-t border-[#E7E7EA] pt-3">
                  <span className="text-xs text-[#737373]">Compensation</span>
                  <strong className="text-sm text-[#0a0a0a]">{priceLabel(selected.card as OpportunityCard) || 'As agreed'}</strong>
                </div>
              </div>
            </div>
            <footer className="mt-auto grid grid-cols-[.8fr_1.2fr] gap-2 border-t border-[#E7E7EA] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
              <button type="button" disabled={response.isPending} onClick={() => decide(selected, 'selection', 'decline')} className="rounded-xl border border-[#E7E7EA] px-4 py-3 text-sm font-semibold text-[#525252]">Decline</button>
              <button type="button" disabled={response.isPending} onClick={() => decide(selected, 'selection', 'confirm')} className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200">{response.isPending ? 'Confirming…' : 'Confirm & move forward'}</button>
              {response.isError && <p className="col-span-2 text-center text-xs font-medium text-red-600">We couldn’t save that. Please try again.</p>}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

export default function TalentNotificationsView() {
  const query = useOpportunityNotifications();
  const [selected, setSelected] = useState<SubscriptionCardRecipient | null>(null);
  const [filter, setFilter] = useState<'all' | AttentionKind>('all');
  const queryClient = useQueryClient();
  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) => api.patch(`/partner/discover/opportunities/${id}/respond`, { action }),
    onSuccess: async () => {
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['partner-opportunities-discover'] });
    },
  });
  const items = useMemo(() => [...(query.data || [])]
    .filter((item) => filter === 'all' || attentionKind(item) === filter)
    .sort((a, b) => new Date(b.responded_at || b.created_at).getTime() - new Date(a.responded_at || a.created_at).getTime()), [query.data, filter]);

  return (
    <div className="min-h-full bg-[#F5F5F6] pb-5">
      <header className="sticky top-0 z-10 border-b border-[#E7E7EA] bg-white/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between"><div><h1 className="text-[22px] font-semibold tracking-[-.03em] text-[#0a0a0a]">Notifications</h1><p className="mt-0.5 text-xs text-[#737373]">Opportunity updates that need your attention</p></div><button type="button" onClick={() => query.refetch()} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F5F6] text-lg text-[#525252]" aria-label="Refresh">↻</button></div>
        <div className="mt-3 flex gap-1 overflow-x-auto rounded-xl bg-[#F5F5F6] p-1">
          {(['all', 'regular', 'shortlist', 'selection'] as const).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${filter === item ? 'bg-white text-[#0a0a0a] shadow-sm' : 'text-[#737373]'}`}>{item === 'regular' ? 'New matches' : item === 'selection' ? 'Selected' : item}</button>)}
        </div>
      </header>
      <div className="space-y-2 p-3" aria-live="polite">
        {query.isLoading ? <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#737373]">Loading notifications…</div> : query.isError ? <button type="button" onClick={() => query.refetch()} className="w-full rounded-2xl bg-white p-6 text-sm font-semibold text-[#0a0a0a]">Couldn’t load notifications · tap to retry</button> : items.length === 0 ? <div className="rounded-2xl border border-dashed border-[#D8D8DC] bg-white p-8 text-center"><p className="text-sm font-semibold text-[#0a0a0a]">You’re all caught up</p><p className="mt-1 text-xs text-[#737373]">New matches and client decisions will appear here.</p></div> : items.map((item) => {
          const kind = attentionKind(item); const copy = copyFor(kind, item); const answered = kind !== 'regular' ? item.notification_responses?.[kind] : null;
          return <button key={item.id} type="button" onClick={() => setSelected(item)} className="flex w-full gap-3 rounded-2xl border border-[#E7E7EA] bg-white p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,.03)]">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg ${kind === 'selection' ? 'bg-emerald-100 text-emerald-700' : kind === 'shortlist' ? 'bg-amber-100 text-amber-700' : 'bg-[#ECECFE] text-[#5B5BF2]'}`}>{kind === 'selection' ? '✓' : kind === 'shortlist' ? '★' : '↗'}</span>
            <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#737373]">{copy.eyebrow}</span><time className="shrink-0 text-[10px] text-[#A3A3A3]">{relativeTime(item.responded_at || item.created_at)}</time></span><strong className="mt-1 block text-sm leading-snug text-[#0a0a0a]">{copy.title}</strong><span className="mt-1 block text-xs leading-relaxed text-[#737373]">{requestTitle(item.card as OpportunityCard)}</span>{answered && <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${answered === 'confirm' ? 'bg-emerald-100 text-emerald-700' : 'bg-[#F5F5F6] text-[#737373]'}`}>{answered === 'confirm' ? 'Confirmed' : 'Declined'}</span>}</span>
          </button>;
        })}
      </div>
      {selected && <RequestSheet recipient={selected} busy={respond.isPending} error={(respond.error as any)?.response?.data?.error || null} onClose={() => setSelected(null)} onRespond={(action) => respond.mutate({ id: selected.id, action })} />}
    </div>
  );
}
