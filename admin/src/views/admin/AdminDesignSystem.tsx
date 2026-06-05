'use client';

import { useState, useEffect } from 'react';

type Mode = 'admin' | 'web';

// ── Shared components ──────────────────────────────────────────

function ColorSwatch({ name, hex, token, usage }: { name: string; hex: string; token: string; usage: string }) {
  const isLight = (hex: string) => {
    const c = hex.replace('#', '');
    if (c.length < 6) return false;
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return r * 0.299 + g * 0.587 + b * 0.114 > 160;
  };
  return (
    <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
      <div className="flex h-20 items-end p-3" style={{ backgroundColor: hex }}>
        <span
          className="rounded px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium"
          style={{ backgroundColor: isLight(hex) ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)', color: isLight(hex) ? '#fff' : '#000' }}
        >
          {hex}
        </span>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-[#0F172B]">{name}</p>
        <p className="font-[family-name:var(--font-mono)] text-[10px] text-[#62748E]">--color-{token}</p>
        <p className="mt-1 text-[11px] text-[#62748E]">{usage}</p>
      </div>
    </div>
  );
}

function FontCard({ name, cssVar, weights, previews }: { name: string; cssVar: string; weights: string; previews: { label: string; style: React.CSSProperties; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
      <div className="border-b border-[#E2E8F0] p-5">
        <p className="text-lg font-bold text-[#0F172B]" style={{ fontFamily: `var(${cssVar})` }}>{name}</p>
        <p className="font-[family-name:var(--font-mono)] text-[10px] text-[#62748E]">{cssVar}</p>
        <p className="mt-1 text-[11px] text-[#62748E]">{weights}</p>
      </div>
      <div className="space-y-3 p-5">
        {previews.map((p, i) => (
          <div key={i}>
            <p className="mb-1 font-[family-name:var(--font-mono)] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">{p.label}</p>
            <p style={p.style}>{p.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Data: Admin ─────────────────────────────────────────────────

const adminColors = [
  { name: 'Accent', hex: '#2962FF', token: 'accent', usage: 'Primary buttons, links, focus states' },
  { name: 'Gray 50', hex: '#F8FAFC', token: 'gray-50', usage: 'Background lightest' },
  { name: 'Gray 100', hex: '#F1F5F9', token: 'gray-100', usage: 'Content background, hover states' },
  { name: 'Gray 200', hex: '#E2E8F0', token: 'gray-200', usage: 'Borders, dividers' },
  { name: 'Gray 300', hex: '#CAD5E2', token: 'gray-300', usage: 'Subtle borders, disabled' },
  { name: 'Gray 400', hex: '#90A1B9', token: 'gray-400', usage: 'Muted icons, placeholder text' },
  { name: 'Gray 500', hex: '#62748E', token: 'gray-500', usage: 'Secondary text, sidebar nav text' },
  { name: 'Gray 600', hex: '#45556C', token: 'gray-600', usage: 'Body text muted' },
  { name: 'Gray 700', hex: '#314158', token: 'gray-700', usage: 'Body text' },
  { name: 'Gray 800', hex: '#1D293D', token: 'gray-800', usage: 'Headings' },
  { name: 'Gray 900', hex: '#0F172B', token: 'gray-900', usage: 'Display text, primary headings' },
  { name: 'Gray 950', hex: '#020618', token: 'gray-950', usage: 'Darkest text' },
];

const adminSquadHireColors = [
  { name: 'SH Lime', hex: '#FCF487', token: 'sh-lime', usage: 'Primary CTA background' },
  { name: 'SH Lime Hover', hex: '#E8DD68', token: 'sh-lime-hover', usage: 'CTA hover state' },
  { name: 'SH Cream', hex: '#F7F6F3', token: 'sh-cream', usage: 'Card surface' },
  { name: 'SH Ink', hex: '#0a0a0a', token: 'sh-ink', usage: 'Primary text on cards' },
  { name: 'SH Ink Muted', hex: '#525252', token: 'sh-ink-muted', usage: 'Secondary text' },
  { name: 'SH Mint', hex: '#a8e8e8', token: 'sh-mint', usage: 'Accent highlight' },
  { name: 'SH Success', hex: '#42cc77', token: 'sh-success', usage: 'Success indicators' },
  { name: 'SH Warning', hex: '#F76808', token: 'sh-warning', usage: 'Warning indicators' },
];

const adminSidebarColors = [
  { name: 'Sidebar', hex: '#ffffff', token: 'sidebar', usage: 'Sidebar panel background' },
  { name: 'Sidebar Hover', hex: '#F1F5F9', token: 'sidebar-hover', usage: 'Nav item hover' },
  { name: 'Sidebar Active', hex: '#F1F5F9', token: 'sidebar-active', usage: 'Nav item active' },
  { name: 'Sidebar Text', hex: '#62748E', token: 'sidebar-text', usage: 'Nav text muted' },
  { name: 'Sidebar Text Bright', hex: '#0F172B', token: 'sidebar-text-bright', usage: 'Active nav text' },
];

const adminTokenTable = [
  ['--color-accent', '#2962FF', 'Primary brand color, links, CTAs'],
  ['--font-display', 'Google Sans Flex', 'Display and heading text'],
  ['--font-body', 'Google Sans Flex', 'Body and UI text'],
  ['--font-mono', 'Geist Mono', 'Monospace, stats, labels'],
  ['--color-sidebar', '#ffffff', 'Sidebar background'],
  ['--color-sidebar-hover', '#F1F5F9', 'Nav item hover state'],
  ['--color-sidebar-active', '#F1F5F9', 'Nav item active state'],
  ['--color-sidebar-text', '#62748E', 'Nav item text (default)'],
  ['--color-sidebar-text-bright', '#0F172B', 'Nav item text (active)'],
];

// ── Data: Web ──────────────────────────────────────────────────

const webColors = [
  { name: 'Canvas', hex: '#F0F2F5', token: 'canvas', usage: 'Page background' },
  { name: 'Surface', hex: '#ffffff', token: 'surface', usage: 'Card, modal, drawer backgrounds' },
  { name: 'Surface Alt', hex: '#F1F5F9', token: 'surface-alt', usage: 'Secondary surfaces, hover states' },
  { name: 'Foreground', hex: '#1D1C1D', token: 'foreground', usage: 'Primary text color' },
  { name: 'Foreground Muted', hex: '#616061', token: 'foreground-muted', usage: 'Secondary text, metadata' },
  { name: 'Accent', hex: '#2962FF', token: 'accent', usage: 'Primary actions, links, focus states' },
  { name: 'Green', hex: '#007A5A', token: 'green', usage: 'Success indicators, checkmarks' },
  { name: 'Success', hex: '#22c55e', token: 'success', usage: 'Completion states, active toggles' },
  { name: 'Danger', hex: '#dc2626', token: 'danger', usage: 'Delete, urgency, "today" indicator' },
  { name: 'Warning / Star', hex: '#f59e0b', token: 'warning', usage: 'Star focus, attention states' },
  { name: 'Violet', hex: '#8b5cf6', token: 'violet', usage: 'Work block accent, special categories' },
];

const webSlateColors = [
  { name: 'Slate 50', hex: '#F8FAFC', token: 'gray-50', usage: 'Lightest background' },
  { name: 'Slate 100', hex: '#F1F5F9', token: 'gray-100', usage: 'Surface alt, hover' },
  { name: 'Slate 200', hex: '#E2E8F0', token: 'gray-200', usage: 'Borders' },
  { name: 'Slate 300', hex: '#CBD5E1', token: 'gray-300', usage: 'Subtle borders' },
  { name: 'Slate 400', hex: '#94A3B8', token: 'gray-400', usage: 'Muted icons' },
  { name: 'Slate 500', hex: '#64748B', token: 'gray-500', usage: 'Secondary text' },
  { name: 'Slate 600', hex: '#475569', token: 'gray-600', usage: 'Body text' },
  { name: 'Slate 700', hex: '#334155', token: 'gray-700', usage: 'Strong text' },
  { name: 'Slate 800', hex: '#1E293B', token: 'gray-800', usage: 'Headings' },
  { name: 'Slate 900', hex: '#0F172A', token: 'gray-900', usage: 'Display text' },
  { name: 'Slate 950', hex: '#020618', token: 'gray-950', usage: 'Darkest text' },
];

const webShellColors = [
  { name: 'SH Ink', hex: '#0A0A0A', token: 'sh-ink', usage: 'Primary text (shell ui)' },
  { name: 'SH Ink 2', hex: '#2A2A2A', token: 'sh-ink-2', usage: 'Secondary text' },
  { name: 'SH Ink 3', hex: '#6A6A6A', token: 'sh-ink-3', usage: 'Muted text' },
  { name: 'SH Ink 4', hex: '#A0A0A0', token: 'sh-ink-4', usage: 'Placeholder text' },
  { name: 'SH Hair', hex: '#E6E6E6', token: 'sh-hair', usage: 'Borders, dividers' },
  { name: 'SH Hair 2', hex: '#D0D0D0', token: 'sh-hair-2', usage: 'Stronger borders' },
  { name: 'SH Hair 3', hex: '#F0F0F0', token: 'sh-hair-3', usage: 'Subtle surface' },
];

const webSidebarColors = [
  { name: 'Sidebar', hex: '#F6F6F6', token: 'sidebar', usage: 'Sidebar panel background' },
  { name: 'Sidebar Text', hex: '#0A0A0A', token: 'sidebar-text', usage: 'Sidebar text' },
  { name: 'Sidebar Active', hex: '#FFFFFF', token: 'sidebar-active', usage: 'Active nav item' },
  { name: 'Divider', hex: 'rgba(29,28,29,0.13)', token: 'divider', usage: 'Primary separators' },
  { name: 'Divider Subtle', hex: 'rgba(29,28,29,0.08)', token: 'divider-subtle', usage: 'Subtle separators' },
];

const webTokenTable = [
  ['--canvas', '#F0F2F5', 'Page background'],
  ['--surface', '#ffffff', 'Card / drawer surface'],
  ['--surface-alt', '#F1F5F9', 'Secondary surface'],
  ['--foreground', '#1D1C1D', 'Primary text'],
  ['--foreground-muted', '#616061', 'Secondary text'],
  ['--font-display', 'Inter', 'Display / body font'],
  ['--font-body', 'Inter', 'Body / UI text font'],
  ['--font-mono', 'JetBrains Mono', 'Monospace / code font'],
  ['--font-serif', 'Instrument Serif', 'Serif display headings'],
  ['--color-accent', '#2962FF', 'Primary action color'],
  ['--color-sidebar', '#F6F6F6', 'Sidebar background'],
];

// ── Views ──────────────────────────────────────────────────────

function AdminView() {
  return (
    <>
      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Typography</div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <FontCard
            name="Google Sans Flex"
            cssVar="--font-display"
            weights="Weights: 400, 500, 600, 700"
            previews={[
              { label: 'Display heading (24px / 700)', style: { fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }, text: 'SquadHub Admin' },
              { label: 'Section title (18px / 600)', style: { fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }, text: 'Workspace Settings' },
              { label: 'Body (14px / 400 / -0.011em)', style: { fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 400, letterSpacing: '-0.011em', color: '#45556C' }, text: 'Used for tables, lists, forms, and most UI copy across the admin panel.' },
              { label: 'Body strong (14px / 600)', style: { fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: '#0F172B' }, text: 'Emphasized labels, active nav items, key data points.' },
              { label: 'Small meta (12px / 500)', style: { fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500, color: '#62748E' }, text: 'Secondary metadata, timestamps, helper text.' },
            ]}
          />
          <FontCard
            name="Geist Mono"
            cssVar="--font-mono"
            weights="Weights: 400, 500, 600"
            previews={[
              { label: 'Stats / labels (10px / 500 / 0.12em uppercase)', style: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#62748E' }, text: 'Total Users' },
              { label: 'Stat value (30px / 700)', style: { fontFamily: 'var(--font-mono)', fontSize: 30, fontWeight: 700, color: '#0F172B' }, text: '1,247' },
              { label: 'Mono body (12px / 400)', style: { fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 400, color: '#45556C' }, text: 'const tokens = await fetchDesignTokens();' },
              { label: 'Tag / chip (11px / 500)', style: { fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: '#62748E' }, text: 'role: admin' },
            ]}
          />
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Colors</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Primary Palette</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {adminColors.map((c) => <ColorSwatch key={c.token} {...c} />)}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Sidebar</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {adminSidebarColors.map((c) => <ColorSwatch key={c.token} {...c} />)}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">SquadHire Palette (Published Cards)</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {adminSquadHireColors.map((c) => <ColorSwatch key={c.token} {...c} />)}
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Composed UI</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">How tokens come together in the admin panel</h3>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2">
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">Sidebar Nav</span>
            </div>
            <div className="flex">
              <div className="w-44 border-r border-[#E2E8F0] bg-white p-3">
                <div className="mb-3 flex items-center gap-2 px-3 py-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#0F172B] text-[10px] font-bold text-white">SH</span>
                  <span className="font-[family-name:var(--font-display)] text-sm font-bold text-[#0F172B]">SquadHub</span>
                </div>
                <div className="space-y-1">
                  {['Dashboard', 'Users', 'Workspaces', 'Design System'].map((item, i) => (
                    <div
                      key={item}
                      className={`rounded-md px-3 py-2 text-sm transition ${i === 3 ? 'bg-[#F8FAFC] font-medium text-[#0F172B]' : 'text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]'}`}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1 bg-[#F1F5F9] p-4">
                <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
                  <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#62748E]">Selected Workspace</p>
                  <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-bold text-[#0F172B]">UpSquad Studio</p>
                  <p className="text-sm text-[#45556C]">42 members &middot; 8 active projects</p>
                  <div className="mt-3 flex gap-2">
                    <span className="rounded-md bg-[#2962FF] px-3 py-1.5 text-xs font-medium text-white">View</span>
                    <span className="rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#45556C]">Edit</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2">
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">Data Cards</span>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
                <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#62748E]">Total Users</p>
                <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-bold text-[#0F172B]">2,483</p>
                <p className="mt-1 text-xs text-[#62748E]">↑ 12% from last month</p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#62748E]">Pending Approvals</p>
                    <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-bold text-[#0F172B]">18</p>
                  </div>
                  <span className="rounded-md bg-[#2962FF] px-2.5 py-1 text-xs font-medium text-white">Action needed</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">CSS Custom Properties</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Full token reference</h3>
        <TokenTable rows={adminTokenTable} />
      </section>

      <footer className="border-t border-[#E2E8F0] pt-6 text-center">
        <p className="font-[family-name:var(--font-mono)] text-[10px] text-[#90A1B9]">
          SquadHub Admin &middot; Design system tokens from <code className="text-[#62748E]">admin/src/styles/globals.css</code>
        </p>
      </footer>
    </>
  );
}

function TokenTable({ rows }: { rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">Token</th>
            <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">Value</th>
            <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">Role</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([token, value, role]) => (
            <tr key={token} className="border-b border-[#E2E8F0] last:border-0">
              <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-[#45556C]">{token}</td>
              <td className="px-4 py-3">
                {token.startsWith('--color') || token.startsWith('--') ? (
                  <span className="flex items-center gap-2">
                    {value.startsWith('#') && (
                      <span className="inline-block h-4 w-4 shrink-0 rounded border border-[#E2E8F0]" style={{ backgroundColor: value }} />
                    )}
                    <span className="font-[family-name:var(--font-mono)] text-xs text-[#45556C]">{value}</span>
                  </span>
                ) : (
                  <span className="font-[family-name:var(--font-mono)] text-xs text-[#45556C]">{value}</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-[#62748E]">{role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebView() {
  return (
    <>
      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Typography</div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <FontCard
            name="Inter"
            cssVar="--font-body"
            weights="Weights: 400, 450, 500, 600, 700"
            previews={[
              { label: 'Body text (14px / 400 / 1.5)', style: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 400, lineHeight: 1.5 }, text: 'This is how regular body text looks in the SquadHub web app. Used for task descriptions, comments, and most UI copy.' },
              { label: 'Body strong (14px / 600)', style: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 600 }, text: 'Emphasized labels, active navigation items, and key actions.' },
              { label: 'Body muted (13px / 400 / muted)', style: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 400, color: '#616061' }, text: 'Secondary information, timestamps, helper text. The muted variant (#616061) creates clear hierarchy.' },
              { label: 'Section link (13px / 500)', style: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#2962FF' }, text: 'Clickable links and interactive text elements.' },
            ]}
          />
          <FontCard
            name="Instrument Serif"
            cssVar="--font-serif"
            weights="Weights: 400, Italic"
            previews={[
              { label: 'Dashboard greeting (28px / 400 / -0.015em)', style: { fontFamily: "'Instrument Serif', serif", fontSize: 28, fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1.15 }, text: 'Good morning, Alex' },
              { label: 'Section heading (22px / 400 / -0.01em)', style: { fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.1 }, text: 'Active Projects' },
              { label: 'Drawer title (24px / 500 / -0.015em)', style: { fontFamily: "'Instrument Serif', serif", fontSize: 24, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.15 }, text: 'Project Roadmap — Q2' },
              { label: 'Stat value (38px / 400 / -0.02em)', style: { fontFamily: "'Instrument Serif', serif", fontSize: 38, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.1 }, text: '1,247' },
            ]}
          />
          <FontCard
            name="Plus Jakarta Sans"
            cssVar="--font-jakarta (planned)"
            weights="Weights: 400, 500, 600, 700, 800"
            previews={[
              { label: 'Card title (12.5px / 600 / -0.005em)', style: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.005em' }, text: 'Project Roadmap — Q2 Planning' },
              { label: 'Section title (13px / 600 / -0.005em)', style: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em' }, text: 'Active Tasks · 12' },
              { label: 'Breadcrumb (13px / 500 / muted)', style: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 500, color: '#616061' }, text: 'Projects / Design / UI Kit' },
              { label: 'Subtoolbar item (13px / 500)', style: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 500 }, text: 'Filters · Sort by date' },
            ]}
          />
          <FontCard
            name="JetBrains Mono"
            cssVar="--font-mono"
            weights="Weights: 400, 500"
            previews={[
              { label: 'Eyebrow label (10.5px / 500 / 0.1em uppercase)', style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#616061' }, text: 'Tasks · Due Today' },
              { label: 'Mono utility (12px / 400)', style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 400, color: '#616061' }, text: 'feature/auth-onboarding · src/views/app/' },
              { label: 'Small meta (11px / 500)', style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, color: '#616061' }, text: '12 min ago · edited' },
            ]}
          />
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Colors</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Surface &amp; Text</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {webColors.map((c) => <ColorSwatch key={c.token} {...c} />)}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Slate Gray Scale</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {webSlateColors.map((c) => <ColorSwatch key={c.token} {...c} />)}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Monochrome Shell (sh-*)</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {webShellColors.map((c) => <ColorSwatch key={c.token} {...c} />)}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Sidebar &amp; Dividers</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {webSidebarColors.map((c) => <ColorSwatch key={c.token} {...c} />)}
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Composed UI</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">How tokens come together in the web app</h3>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2">
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">Dashboard Card</span>
            </div>
            <div className="p-5" style={{ background: '#F0F2F5' }}>
              <div className="rounded-lg border p-4" style={{ background: '#ffffff', borderColor: 'rgba(29,28,29,0.13)' }}>
                <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#616061', marginBottom: 8 }}>Projects · Active</p>
                <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.1, color: '#1D1C1D', marginBottom: 8 }}>Product Design — Q3</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 400, color: '#616061', lineHeight: 1.5, marginBottom: 12 }}>Design system audit, component library updates, and handoff to engineering. Currently in review phase with 8 assets pending.</p>
                <div style={{ display: 'flex', gap: 4 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#1D1C1D', color: '#fff' }}>Design</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#fff', border: '1px solid rgba(29,28,29,0.13)', color: '#1D1C1D' }}>In Review</span>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2">
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-semibold uppercase tracking-[0.08em] text-[#90A1B9]">Stat Cards</span>
            </div>
            <div className="space-y-3 p-5" style={{ background: '#F0F2F5' }}>
              <div className="rounded-lg border p-4" style={{ background: '#ffffff', borderColor: 'rgba(29,28,29,0.13)' }}>
                <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#616061', marginBottom: 4 }}>Completion Rate</p>
                <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 38, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.1, color: '#1D1C1D' }}>92%</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 400, color: '#616061', marginTop: 4 }}>Across all active projects</p>
              </div>
              <div className="rounded-lg border p-4" style={{ background: '#ffffff', borderColor: 'rgba(29,28,29,0.13)' }}>
                <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#616061', marginBottom: 4 }}>Tasks Today</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p style={{ fontFamily: "'Instrument Serif', serif", fontSize: 38, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.1, color: '#1D1C1D' }}>12</p>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2962FF', color: '#fff' }}>3 emergencies</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">CSS Custom Properties</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Full token reference</h3>
        <TokenTable rows={webTokenTable} />
      </section>

      <footer className="border-t border-[#E2E8F0] pt-6 text-center">
        <p className="font-[family-name:var(--font-mono)] text-[10px] text-[#90A1B9]">
          SquadHub Web App &middot; Design system tokens from <code className="text-[#62748E]">web/src/styles/globals.css</code>
        </p>
      </footer>
    </>
  );
}

// ── Root ───────────────────────────────────────────────────────

export default function AdminDesignSystem() {
  const [mode, setMode] = useState<Mode>('admin');

  useEffect(() => {
    if (mode === 'web') {
      const existing = document.getElementById('sh-web-fonts');
      if (!existing) {
        const link = document.createElement('link');
        link.id = 'sh-web-fonts';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;450;500;600;700&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
        document.head.appendChild(link);
      }
    }
  }, [mode]);

  return (
    <div>
      {/* Header with mode toggle */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Design System</h2>
            <p className="mt-1 text-sm text-[#62748E]">
              {mode === 'admin' ? 'Typography, colors, and visual tokens used across the SquadHub admin panel.' : 'Typography, colors, and visual tokens used across the SquadHub web app.'}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white p-1">
            <button
              onClick={() => setMode('admin')}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${mode === 'admin' ? 'bg-[#0F172B] text-white' : 'text-[#62748E] hover:text-[#0F172B]'}`}
            >
              Admin
            </button>
            <button
              onClick={() => setMode('web')}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${mode === 'web' ? 'bg-[#0F172B] text-white' : 'text-[#62748E] hover:text-[#0F172B]'}`}
            >
              Web App
            </button>
          </div>
        </div>
      </div>

      {mode === 'admin' ? <AdminView /> : <WebView />}
    </div>
  );
}
