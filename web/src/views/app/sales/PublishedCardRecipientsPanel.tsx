import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import type { Country, SubscriptionCard, ClientSubmissionSubscription } from '@squadhub/shared';
import { resolveFinalizedPrice, resolvePartnerPrice } from '@squadhub/shared';

type PublishedCardItem = SubscriptionCard & {
  submission?: { id: string; business_name: string; country_id: string; country?: Country | null } | null;
  submission_subscription?: ClientSubmissionSubscription | null;
};

type PartnerRecipient = {
  id: string;
  name: string;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
};

type TalentRecipient = {
  external_user_id: string;
  name: string | null;
  status: 'accepted' | 'rejected';
  responded_at: string | null;
};

type RecipientsResponse = {
  partners: PartnerRecipient[];
  talents: TalentRecipient[];
};

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

const STATUS_CHIP: Record<'pending' | 'accepted' | 'rejected', string> = {
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
};

export default function PublishedCardRecipientsPanel({
  card,
  title,
  onClose,
  endpoint,
}: {
  card: PublishedCardItem;
  title: string;
  onClose: () => void;
  endpoint?: string;
}) {
  const cardId = card.id;
  const url = endpoint ?? `/subscription-cards/${cardId}/recipients`;
  const { data, isLoading, error } = useQuery({
    queryKey: ['card-recipients', cardId, url],
    queryFn: () =>
      api.get(url).then((r) => r.data?.data as RecipientsResponse),
  });

  const { data: countriesRes } = useQuery({
    queryKey: ['public-countries'],
    queryFn: () => api.get('/clients/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];

  const partnerGroups = useMemo(() => {
    const accepted = (data?.partners || []).filter((p) => p.status === 'accepted');
    const rejected = (data?.partners || []).filter((p) => p.status === 'rejected');
    const pending = (data?.partners || []).filter((p) => p.status === 'pending');
    return { accepted, rejected, pending };
  }, [data]);

  const talentGroups = useMemo(() => {
    const accepted = (data?.talents || []).filter((t) => t.status === 'accepted');
    const rejected = (data?.talents || []).filter((t) => t.status === 'rejected');
    return { accepted, rejected };
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-[480px] flex-col bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--sh-ink)]">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <CardDetails card={card} countries={countries} />
          <div className="p-5 space-y-6 text-sm">
            {isLoading ? (
              <p className="text-center text-xs text-[var(--sh-ink-4)]">Loading…</p>
            ) : error ? (
              <p className="text-center text-xs text-red-600">Failed to load recipients.</p>
            ) : (
              <>
                <Section title="Partners">
                  <Subgroup label="Accepted" items={partnerGroups.accepted.map((p) => ({
                    key: p.id, name: p.name, status: p.status, responded_at: p.responded_at,
                  }))} />
                  <Subgroup label="Rejected" items={partnerGroups.rejected.map((p) => ({
                    key: p.id, name: p.name, status: p.status, responded_at: p.responded_at,
                  }))} />
                  <Subgroup label="Pending" items={partnerGroups.pending.map((p) => ({
                    key: p.id, name: p.name, status: p.status, responded_at: null,
                  }))} />
                </Section>
                <Section title="Talents">
                  <Subgroup label="Accepted" items={talentGroups.accepted.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: t.responded_at,
                  }))} />
                  <Subgroup label="Rejected" items={talentGroups.rejected.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: t.responded_at,
                  }))} />
                </Section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardDetails({ card, countries }: { card: PublishedCardItem; countries: Country[] }) {
  const plan = card.submission_subscription?.plan as
    | { plan: string; tier: string; pricing?: { country_id: string; price: number; margin_value?: number; margin_type?: 'fixed' | 'percent'; country?: Country | null }[] }
    | undefined
    | null;
  const planLabel = plan ? `${plan.plan} · ${plan.tier}` : '';
  const stateColor = card.state === 'published' ? '#10B981' : '#6B7280';
  const stateLabel = card.state === 'published' ? 'Active' : 'Cancelled';
  const distLabel = card.distribution === 'manual' ? 'Published' : 'Broadcast';

  const countryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    countries.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [countries]);

  const targetCountries = (card.target_country_ids || []).map((id) => countryNameById[id] || id.slice(0, 8));
  const regionsByCountry = useMemo(() => {
    const m: Record<string, string[]> = {};
    (card.target_regions || []).forEach((r) => {
      const name = countryNameById[r.country_id] || r.country_id.slice(0, 8);
      (m[name] = m[name] || []).push(r.region);
    });
    return m;
  }, [card.target_regions, countryNameById]);

  const planPrice = plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || card.submission?.country?.currency || '';
  const cur = priceCurrency || '₹';
  // Finalized price the client pays (subscription price, else proposed) and the
  // partner's pay (override, else finalized − final margin).
  const finalizedPrice = resolveFinalizedPrice(card);
  const partnerPrice = resolvePartnerPrice(card, planPrice);

  return (
    <div className="border-b border-[var(--sh-hair)] px-5 py-4 space-y-4 text-sm">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: `${stateColor}18`, color: stateColor }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
            {stateLabel}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{distLabel}</span>
        </div>
        {planLabel && <p className="text-xs text-[var(--sh-ink-3)]">{planLabel}</p>}
        <p className="text-xs text-[var(--sh-ink-3)]">Published {formatFullDateTime(card.published_at)}</p>
      </div>

      {(card.working_days?.length || card.brand_name || card.business_nature || card.notes) && (
        <DetailSection title="Working & business">
          {card.working_days && card.working_days.length > 0 && (
            <DetailRow label="Working days" value={card.working_days.join(' · ')} />
          )}
          {card.brand_name && <DetailRow label="Brand" value={card.brand_name} />}
          {card.business_nature && <DetailRow label="Nature" value={card.business_nature} />}
          {card.notes && <DetailRow label="Notes" value={card.notes} multiline />}
        </DetailSection>
      )}

      {((card.target_tiers && card.target_tiers.length > 0) || card.min_experience_years > 0 || (card.target_languages && card.target_languages.length > 0) || targetCountries.length > 0 || Object.keys(regionsByCountry).length > 0) && (
        <DetailSection title="Targeting">
          {card.target_tiers && card.target_tiers.length > 0 && <DetailRow label="Tiers" value={card.target_tiers.join(' · ')} />}
          {card.min_experience_years > 0 && <DetailRow label="Min experience" value={`${card.min_experience_years}+ years`} />}
          {card.target_languages && card.target_languages.length > 0 && <DetailRow label="Languages" value={card.target_languages.join(' · ')} />}
          {targetCountries.length > 0 && <DetailRow label="Countries" value={targetCountries.join(', ')} />}
          {Object.entries(regionsByCountry).map(([country, regions]) => (
            <DetailRow key={country} label={country} value={regions.join(', ')} />
          ))}
        </DetailSection>
      )}

      {((card.custom_deliverables && card.custom_deliverables.length > 0) || (card.disabled_default_deliverable_ids && card.disabled_default_deliverable_ids.length > 0)) && (
        <DetailSection title="Deliverables">
          {(card.custom_deliverables || []).map((d) => (
            <DetailRow key={d.id} label={d.name} value={formatDeliverable(d)} />
          ))}
          {card.disabled_default_deliverable_ids && card.disabled_default_deliverable_ids.length > 0 && (
            <p className="text-[11px] text-[var(--sh-ink-4)]">
              {card.disabled_default_deliverable_ids.length} plan default{card.disabled_default_deliverable_ids.length === 1 ? '' : 's'} disabled
            </p>
          )}
        </DetailSection>
      )}

      {(planPrice || finalizedPrice != null || card.partner_price_override != null) && (
        <DetailSection title="Pricing">
          {planPrice && <DetailRow label="Plan price" value={`${cur} ${planPrice.price.toLocaleString()}`} />}
          {card.proposed_price != null && (
            <DetailRow label="Proposed price" value={`${cur} ${card.proposed_price.toLocaleString()}/mo`} />
          )}
          {card.subscription_price != null && (
            <DetailRow label="Subscription price" value={`${cur} ${card.subscription_price.toLocaleString()}/mo`} />
          )}
          {partnerPrice != null && (
            <DetailRow label="Partner price" value={`${cur} ${partnerPrice.toLocaleString()}/mo`} />
          )}
          {card.partner_price_override != null && (
            <DetailRow label="Partner override" value={`${cur} ${card.partner_price_override.toLocaleString()}`} />
          )}
        </DetailSection>
      )}
    </div>
  );
}

function formatDeliverable(d: { kind: 'hours' | 'item'; per_day: number; per_week: number; per_month: number }): string {
  if (d.kind === 'hours') {
    if (d.per_week) return `${d.per_week} hrs/week`;
    if (d.per_day) return `${d.per_day} hrs/day`;
    if (d.per_month) return `${d.per_month} hrs/month`;
    return '—';
  }
  if (d.per_week) return `${d.per_week}× per week`;
  if (d.per_day) return `${d.per_day}× per day`;
  if (d.per_month) return `${d.per_month}× per month`;
  return '—';
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-4)]">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={`flex gap-3 ${multiline ? 'flex-col' : 'justify-between'}`}>
      <span className="text-xs text-[var(--sh-ink-4)]">{label}</span>
      <span className={`text-xs text-[var(--sh-ink)] ${multiline ? '' : 'text-right'}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--sh-ink-4)]">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Subgroup({
  label,
  items,
}: {
  label: 'Accepted' | 'Rejected' | 'Pending';
  items: { key: string; name: string; subtitle?: string | null; status: 'accepted' | 'rejected' | 'pending'; responded_at: string | null }[];
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-[var(--sh-ink-3)]">{label} (0)</p>
        <p className="text-xs text-[var(--sh-ink-4)]">None.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-[var(--sh-ink-3)]">
        {label} ({items.length})
      </p>
      <ul className="divide-y divide-[var(--sh-hair)] rounded-lg border border-[var(--sh-hair)]">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 truncate">
              <p className="truncate text-sm text-[var(--sh-ink)]">{it.name}</p>
              {it.subtitle && (
                <p className="truncate text-[11px] font-mono text-[var(--sh-ink-4)]">{it.subtitle}</p>
              )}
              {it.responded_at && (
                <p className="text-[11px] text-[var(--sh-ink-4)]">{formatRelative(it.responded_at)}</p>
              )}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[it.status]}`}>
              {it.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
