import { useState } from 'react';

type InboxItem = {
  id: number;
  group: 'Needs you' | 'FYI';
  from: string;
  ctx: string;
  title: string;
  snippet: string;
  unread: boolean;
  ava: string;
  color: string;
  tag: 'client' | 'ops' | 'design' | 'eng' | 'space';
};

const ITEMS: InboxItem[] = [
  { id: 0, group: 'Needs you', from: 'Elena Boko', ctx: 'Arbor Co · comment', title: 'Pricing page v3 — ship blocker?', snippet: 'The revised pricing page works — can we ship it before Thursday? Our sales team is holding 4 demos on it.', unread: true, ava: 'EB', color: 'oklch(0.62 0.13 20)', tag: 'client' },
  { id: 1, group: 'Needs you', from: 'Maya Hartwell', ctx: 'Q2 Launch · task', title: 'Q2 launch copy — sign-off needed', snippet: "Blocked on you. I've marked the three contentious lines in the doc. 2 min review tops.", unread: true, ava: 'MH', color: 'oklch(0.58 0.12 60)', tag: 'ops' },
  { id: 2, group: 'Needs you', from: '#design-crit', ctx: 'mention', title: 'Leo mentioned you — new motion comps', snippet: '@arjun curious your take on option C — feels closer to the brief but Tomás prefers A.', unread: true, ava: '#', color: 'var(--sh-ink-3)', tag: 'design' },
  { id: 3, group: 'FYI', from: 'Dev Krishnan', ctx: 'task status', title: 'Auth migration — phase 2 → In Review', snippet: 'Pushed the refactor. Tests passing. Ready for your review when convenient.', unread: true, ava: 'DK', color: 'oklch(0.6 0.13 150)', tag: 'eng' },
  { id: 4, group: 'FYI', from: 'Nina Ito', ctx: 'Lumen · DM', title: 'MSA v3 attached', snippet: 'Legal signed off on our end. Small changes in §4 and §8.2 — tracked for you.', unread: false, ava: 'NI', color: 'oklch(0.62 0.12 100)', tag: 'client' },
  { id: 5, group: 'FYI', from: 'Daily digest', ctx: 'summary', title: '7 updates across 3 spaces', snippet: 'Priya shipped payments refactor. Leo posted 6 comps. Tomás opened 2 motion prototypes.', unread: false, ava: '•', color: 'var(--sh-ink-3)', tag: 'space' },
];

type Filter = 'all' | 'unread' | 'mentions';

export default function InboxView() {
  const [activeId, setActiveId] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = ITEMS.filter((it) => {
    if (filter === 'unread') return it.unread;
    if (filter === 'mentions') return it.ctx === 'mention';
    return true;
  });

  const groups = filtered.reduce<Record<string, InboxItem[]>>((acc, it) => {
    (acc[it.group] = acc[it.group] || []).push(it);
    return acc;
  }, {});

  const current = ITEMS.find((i) => i.id === activeId) || ITEMS[0];

  return (
    <div className="sh-view inbox-view">
      {/* List */}
      <div className="inbox-list">
        <div className="inbox-filter">
          <div className="pill" data-active={filter === 'all'} onClick={() => setFilter('all')}>All</div>
          <div className="pill" data-active={filter === 'unread'} onClick={() => setFilter('unread')}>Unread</div>
          <div className="pill" data-active={filter === 'mentions'} onClick={() => setFilter('mentions')}>Mentions</div>
          <div style={{ flex: 1 }} />
          <div className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 5h18l-7 9v5l-4 2v-7z" /></svg>
            Filters
          </div>
        </div>
        {Object.entries(groups).map(([g, arr]) => (
          <div key={g}>
            <div className="inbox-group-hd">{g} · {arr.length}</div>
            {arr.map((it) => (
              <div
                key={it.id}
                className="ib-item"
                data-unread={it.unread}
                data-active={activeId === it.id}
                onClick={() => setActiveId(it.id)}
              >
                <div className="line1">
                  <div className="ava" style={{ width: 20, height: 20, borderRadius: '50%', background: it.color, fontSize: 9, fontWeight: 600 }}>{it.ava}</div>
                  <span className="ib-from">{it.from}</span>
                  <span className="ib-ctx">{it.ctx}</span>
                </div>
                <div className="ib-title">{it.title}</div>
                <div className="ib-snip">{it.snippet}</div>
                <div className="ib-meta">
                  <span className={`tag ${it.tag}`}>{it.ctx.split(' ')[0]}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Detail */}
      <div className="inbox-detail">
        <div className="detail-head">
          <div className="ava" style={{ width: 40, height: 40, borderRadius: '50%', background: current.color, fontWeight: 600 }}>{current.ava}</div>
          <div style={{ flex: 1 }}>
            <h1>{current.title}</h1>
            <div style={{ fontSize: 12, color: 'var(--sh-ink-3)', marginTop: 2 }}>
              From <b style={{ color: 'var(--sh-ink)' }}>{current.from}</b> · {current.ctx} · 2h ago
            </div>
          </div>
          <div className="top-btn ghost-border">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>
            Mark done
          </div>
          <div className="top-btn ghost-border">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            Snooze
          </div>
        </div>

        <div className="detail-meta">
          <div><b>Space</b> · Arbor Co — Redesign</div>
          <div><b>Thread</b> · Pricing page iteration</div>
          <div><b>Priority</b> · High</div>
        </div>

        <div className="detail-body">
          <p>{current.snippet}</p>
          <p>Specifically — the mobile flow fails two of our WCAG touch-target checks (the tier toggles are 36×36, minimum is 44×44), and the contrast on the secondary CTAs comes out at 3.8 against the cream background.</p>
          <p>Leo has acknowledged in #design-crit and is targeting a fix by EOD. Do you want to pull the Thursday ship forward a day, or keep it and QA after?</p>
          <p>— E</p>
        </div>

        <div className="reply-card">
          <textarea placeholder={`Reply to ${current.from.replace(/^#/, '')}…`} />
          <div className="reply-actions">
            <div style={{ display: 'flex', gap: 4 }}>
              <div className="sb-icon-btn" title="Attach">
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 11.5 12 20a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>
              </div>
              <div className="sb-icon-btn" title="Mention">
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></svg>
              </div>
              <div className="sb-icon-btn" title="Emoji">
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></svg>
              </div>
            </div>
            <button type="button" className="send-btn">
              Send
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m3 3 18 9-18 9 4-9z" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
