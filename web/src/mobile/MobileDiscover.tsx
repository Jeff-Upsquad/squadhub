'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubscriptionCard, SubscriptionCardRecipient } from '@squadhub/shared';
import api from '../services/api';
import { MIcon } from './MobileKit';

type DiscoverTab = 'new' | 'subscription' | 'assignment' | 'hiring';
type OpportunityCard = SubscriptionCard & {
  selected_recipient_id?: string | null;
  paused_at?: string | null;
  cancelled_at?: string | null;
  requirement_note?: string | null;
};

const TABS: Array<{ key: DiscoverTab; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'subscription', label: 'Subscriptions' },
  { key: 'assignment', label: 'Assignments' },
  { key: 'hiring', label: 'Jobs' },
];

export default function MobileDiscover() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DiscoverTab>('new');
  const [selected, setSelected] = useState<SubscriptionCardRecipient | null>(null);

  const query = useQuery({
    queryKey: ['partner-opportunities-discover'],
    queryFn: async () => {
      const responses = await Promise.all(
        ['pending', 'accepted', 'rejected'].map((status) =>
          api.get(`/partner/opportunities?status=${status}`).then((r) => r.data?.data || []),
        ),
      );
      return responses.flat() as SubscriptionCardRecipient[];
    },
    staleTime: 20_000,
  });

  const all = query.data || [];
  const visible = useMemo(() => {
    if (tab === 'new') return all.filter((item) => item.status === 'pending');
    return all.filter((item) => (item.card?.card_type || 'subscription') === tab);
  }, [all, tab]);

  const counts = useMemo(() => ({
    new: all.filter((item) => item.status === 'pending').length,
    subscription: all.filter((item) => (item.card?.card_type || 'subscription') === 'subscription').length,
    assignment: all.filter((item) => item.card?.card_type === 'assignment').length,
    hiring: all.filter((item) => item.card?.card_type === 'hiring').length,
  }), [all]);

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api.post(`/partner/opportunities/${id}/${action}`),
    onSuccess: async () => {
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities-discover'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities-pending'] }),
      ]);
    },
  });

  return (
    <div className="mdiscover">
      <header className="mdiscover-head">
        <span className="mdiscover-eyebrow">Work marketplace</span>
        <div className="mdiscover-title-row">
          <div>
            <h1>Discover</h1>
            <p>Review new work and keep track of every request.</p>
          </div>
          <span className="mdiscover-title-icon">{MIcon.discover}</span>
        </div>
      </header>

      <div className="mdiscover-tabs" role="tablist" aria-label="Opportunity type">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            data-on={tab === item.key ? 'true' : undefined}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            {counts[item.key] > 0 && <span>{counts[item.key]}</span>}
          </button>
        ))}
      </div>

      <section className="mdiscover-section" aria-live="polite">
        <div className="mdiscover-section-head">
          <div>
            <h2>{tabTitle(tab)}</h2>
            <p>{tabDescription(tab)}</p>
          </div>
          <button type="button" className="mdiscover-refresh" onClick={() => query.refetch()} aria-label="Refresh requests">↻</button>
        </div>

        {query.isLoading ? (
          <div className="mdiscover-skeletons" aria-label="Loading requests"><i /><i /><i /></div>
        ) : query.isError ? (
          <DiscoverEmpty title="Couldn’t load requests" body="Check your connection and try again." action="Try again" onAction={() => query.refetch()} />
        ) : visible.length === 0 ? (
          <DiscoverEmpty
            title={tab === 'new' ? 'You’re all caught up' : `No ${tabLabel(tab).toLowerCase()} yet`}
            body={tab === 'new' ? 'New subscription, assignment, and job requests will land here.' : 'When a matching request is shared with you, it will appear here.'}
          />
        ) : (
          <div className="mdiscover-list">
            {visible.map((item) => <RequestCard key={item.id} recipient={item} onClick={() => setSelected(item)} />)}
          </div>
        )}
      </section>

      {selected && (
        <RequestSheet
          recipient={selected}
          busy={respond.isPending}
          error={(respond.error as any)?.response?.data?.error || (respond.isError ? 'We couldn’t save your response.' : null)}
          onClose={() => setSelected(null)}
          onRespond={(action) => respond.mutate({ id: selected.id, action })}
        />
      )}
    </div>
  );
}

function RequestCard({ recipient, onClick }: { recipient: SubscriptionCardRecipient; onClick: () => void }) {
  const card = recipient.card as OpportunityCard | undefined;
  if (!card) return null;
  const type = card.card_type || 'subscription';
  const meta = requestMeta(card);
  return (
    <button type="button" className="mdiscover-card" data-type={type} onClick={onClick}>
      <span className="mdiscover-card-icon">{typeIcon(type)}</span>
      <span className="mdiscover-card-copy">
        <span className="mdiscover-card-topline">
          <span className="mdiscover-type">{tabLabel(type as DiscoverTab)}</span>
          <StatusPill recipient={recipient} />
        </span>
        <b>{requestTitle(card)}</b>
        {meta && <small>{meta}</small>}
        <span className="mdiscover-card-foot">
          {priceLabel(card) || 'Open brief'}
          <em>{relativeDate(card.published_at || recipient.created_at)}</em>
        </span>
      </span>
      <span className="mdiscover-chevron">{MIcon.chevron}</span>
    </button>
  );
}

function RequestSheet({ recipient, busy, error, onClose, onRespond }: {
  recipient: SubscriptionCardRecipient;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRespond: (action: 'accept' | 'reject') => void;
}) {
  const card = recipient.card as OpportunityCard;
  const type = card.card_type || 'subscription';
  const details = [
    ['Engagement', tabLabel(type as DiscoverTab)],
    ['Plan / level', planLabel(card)],
    ['Budget', priceLabel(card)],
    ['Working days', card.working_days?.join(', ')],
    ['Languages', card.target_languages?.join(', ')],
    ['Experience', card.min_experience_years ? `${card.min_experience_years}+ years` : null],
    ['Timeline', card.assignment_details?.duration],
    ['Start date', formatDate(card.assignment_details?.start_date)],
    ['Deadline', formatDate(card.assignment_details?.deadline)],
  ].filter((row): row is string[] => Boolean(row[1]));

  return (
    <div className="mdiscover-sheet-layer" role="presentation">
      <button type="button" className="mdiscover-sheet-scrim" aria-label="Close request" onClick={onClose} />
      <article className="mdiscover-sheet" role="dialog" aria-modal="true" aria-labelledby="request-title">
        <div className="mdiscover-sheet-handle" />
        <header>
          <span className="mdiscover-card-icon" data-large>{typeIcon(type)}</span>
          <div>
            <span className="mdiscover-type">{tabLabel(type as DiscoverTab)}</span>
            <h2 id="request-title">{requestTitle(card)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">{MIcon.close}</button>
        </header>

        <div className="mdiscover-sheet-scroll">
          <div className="mdiscover-sheet-summary">
            <StatusPill recipient={recipient} />
            <span>{card.submission?.business_name || card.brand_name || 'SquadHub client'}</span>
          </div>
          {details.length > 0 && (
            <dl className="mdiscover-details">
              {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          )}
          {(card.requirement_note || card.notes) && (
            <section className="mdiscover-brief"><h3>Work brief</h3><p>{card.requirement_note || card.notes}</p></section>
          )}
          {card.additional_requirements && Object.keys(card.additional_requirements).length > 0 && (
            <section className="mdiscover-brief">
              <h3>Preferred skills & tools</h3>
              <div className="mdiscover-chips">
                {Object.values(card.additional_requirements).flat().map((label) => <span key={label}>{label}</span>)}
              </div>
            </section>
          )}
          {error && <p className="mdiscover-error">{error}</p>}
        </div>

        {recipient.status === 'pending' && (
          <footer>
            <button type="button" disabled={busy} className="mdiscover-decline" onClick={() => onRespond('reject')}>Decline</button>
            <button type="button" disabled={busy} className="mdiscover-accept" onClick={() => onRespond('accept')}>
              {busy ? 'Saving…' : type === 'assignment' ? 'Accept assignment' : type === 'hiring' ? 'I’m interested' : 'Accept request'}
            </button>
          </footer>
        )}
      </article>
    </div>
  );
}

function StatusPill({ recipient }: { recipient: SubscriptionCardRecipient }) {
  const card = recipient.card as OpportunityCard | undefined;
  const state = card?.cancelled_at ? 'cancelled' : card?.recalled_at ? 'recalled' : card?.paused_at ? 'paused' : card?.state === 'assigned' ? 'active' : recipient.status;
  return <span className="mdiscover-status" data-status={state}>{state === 'pending' ? 'New' : state[0].toUpperCase() + state.slice(1)}</span>;
}

function DiscoverEmpty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mdiscover-empty">
      <span>{MIcon.inboxOutline}</span><b>{title}</b><p>{body}</p>
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}

function requestTitle(card: OpportunityCard) {
  return card.submission_subscription?.subscription?.name || card.brand_name || (card.card_type === 'assignment' ? 'New assignment' : card.card_type === 'hiring' ? 'New job opening' : 'New subscription');
}
function requestMeta(card: OpportunityCard) {
  return [card.submission?.business_name || card.business_nature, planLabel(card)].filter(Boolean).join(' · ');
}
function planLabel(card: OpportunityCard) {
  const plan = card.submission_subscription?.plan;
  return [plan?.plan, plan?.tier].filter(Boolean).join(' · ') || null;
}
function priceLabel(card: OpportunityCard) {
  const amount = card.partner_price_override ?? card.proposed_price;
  if (amount == null) return null;
  return `₹${Number(amount).toLocaleString('en-IN')}${card.card_type === 'assignment' ? ' / project' : ' / month'}`;
}
function typeIcon(type: string) {
  if (type === 'assignment') return MIcon.tasks;
  if (type === 'hiring') return MIcon.profile;
  return MIcon.calendar;
}
function tabTitle(tab: DiscoverTab) {
  if (tab === 'new') return 'New work requests';
  if (tab === 'subscription') return 'My subscriptions';
  if (tab === 'assignment') return 'My assignments';
  return 'Job openings';
}
function tabDescription(tab: DiscoverTab) {
  if (tab === 'new') return 'Requests waiting for your response';
  if (tab === 'subscription') return 'Ongoing monthly opportunities';
  if (tab === 'assignment') return 'One-off project opportunities';
  return 'Roles and longer-term opportunities';
}
function tabLabel(tab: DiscoverTab) {
  if (tab === 'subscription') return 'Subscription';
  if (tab === 'assignment') return 'Assignment';
  if (tab === 'hiring') return 'Job opening';
  return 'New';
}
function relativeDate(value: string | null | undefined) {
  if (!value) return '';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(value));
}
function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
