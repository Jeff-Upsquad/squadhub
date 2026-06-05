'use client';

const colors = [
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

const squadHireColors = [
  { name: 'SH Lime', hex: '#FCF487', token: 'sh-lime', usage: 'Primary CTA background' },
  { name: 'SH Lime Hover', hex: '#E8DD68', token: 'sh-lime-hover', usage: 'CTA hover state' },
  { name: 'SH Cream', hex: '#F7F6F3', token: 'sh-cream', usage: 'Card surface' },
  { name: 'SH Ink', hex: '#0a0a0a', token: 'sh-ink', usage: 'Primary text on cards' },
  { name: 'SH Ink Muted', hex: '#525252', token: 'sh-ink-muted', usage: 'Secondary text' },
  { name: 'SH Mint', hex: '#a8e8e8', token: 'sh-mint', usage: 'Accent highlight' },
  { name: 'SH Success', hex: '#42cc77', token: 'sh-success', usage: 'Success indicators' },
  { name: 'SH Warning', hex: '#F76808', token: 'sh-warning', usage: 'Warning indicators' },
];

const sidebarColors = [
  { name: 'Sidebar', hex: '#ffffff', token: 'sidebar', usage: 'Sidebar panel background' },
  { name: 'Sidebar Hover', hex: '#F1F5F9', token: 'sidebar-hover', usage: 'Nav item hover' },
  { name: 'Sidebar Active', hex: '#F1F5F9', token: 'sidebar-active', usage: 'Nav item active' },
  { name: 'Sidebar Text', hex: '#62748E', token: 'sidebar-text', usage: 'Nav text muted' },
  { name: 'Sidebar Text Bright', hex: '#0F172B', token: 'sidebar-text-bright', usage: 'Active nav text' },
];

function ColorSwatch({ name, hex, token, usage }: { name: string; hex: string; token: string; usage: string }) {
  const isLight = (hex: string) => {
    const c = hex.replace('#', '');
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

export default function AdminDesignSystem() {
  return (
    <div>
      <div className="mb-8">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Design System</h2>
        <p className="mt-1 text-sm text-[#62748E]">Typography, colors, and visual tokens used across the SquadHub admin panel.</p>
      </div>

      {/* Typography */}
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

      {/* Color Palette */}
      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Colors</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Primary Palette</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {colors.map((c) => (
            <ColorSwatch key={c.token} {...c} />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Sidebar</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {sidebarColors.map((c) => (
            <ColorSwatch key={c.token} {...c} />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">SquadHire Palette (Published Cards)</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {squadHireColors.map((c) => (
            <ColorSwatch key={c.token} {...c} />
          ))}
        </div>
      </section>

      {/* How it looks */}

      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">Composed UI</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">How tokens come together in the admin panel</h3>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Sidebar preview */}
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
                      className={`rounded-md px-3 py-2 text-sm transition ${
                        i === 3 ? 'bg-[#F8FAFC] font-medium text-[#0F172B]' : 'text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]'
                      }`}
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

          {/* Cards + data preview */}
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

      {/* Token table */}
      <section className="mb-10">
        <div className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">CSS Custom Properties</div>
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Full token reference</h3>
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
              {[
                ['--color-accent', '#2962FF', 'Primary brand color, links, CTAs'],
                ['--font-display', 'Google Sans Flex', 'Display and heading text'],
                ['--font-body', 'Google Sans Flex', 'Body and UI text'],
                ['--font-mono', 'Geist Mono', 'Monospace, stats, labels'],
                ['--color-sidebar', '#ffffff', 'Sidebar background'],
                ['--color-sidebar-hover', '#F1F5F9', 'Nav item hover state'],
                ['--color-sidebar-active', '#F1F5F9', 'Nav item active state'],
                ['--color-sidebar-text', '#62748E', 'Nav item text (default)'],
                ['--color-sidebar-text-bright', '#0F172B', 'Nav item text (active)'],
              ].map(([token, value, role]) => (
                <tr key={token} className="border-b border-[#E2E8F0] last:border-0">
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-[#45556C]">{token}</td>
                  <td className="px-4 py-3">
                    {token?.toString().includes('color-') && value?.toString().startsWith('#') ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-4 w-4 rounded border border-[#E2E8F0]" style={{ backgroundColor: value.toString() }} />
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
      </section>

      <footer className="border-t border-[#E2E8F0] pt-6 text-center">
        <p className="font-[family-name:var(--font-mono)] text-[10px] text-[#90A1B9]">
          SquadHub Admin &middot; Design system tokens from <code className="text-[#62748E]">admin/src/styles/globals.css</code>
        </p>
      </footer>
    </div>
  );
}
