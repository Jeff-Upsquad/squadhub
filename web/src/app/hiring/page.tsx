const FORM_URL = 'https://forms.clickup.com/3498755/f/3arr3-61916/3UYKEIC6PQM2C8ZLGL';

const positions = [
  {
    title: 'Designers',
    desc: 'Visual and graphic designers to craft brand identities, social assets, and creative deliverables.',
    tags: ['Graphics', 'Branding', 'Social'],
    iconBg: '#e8edf8',
    iconStroke: '#3b5ccc',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b5ccc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
  {
    title: 'Video Editor',
    desc: 'Post-production specialists for short-form, long-form, reels, and motion graphics content.',
    tags: ['Editing', 'Reels', 'Motion'],
    iconBg: '#fce8d8',
    iconStroke: '#d97706',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
        <line x1="17" y1="17" x2="22" y2="17" />
      </svg>
    ),
  },
  {
    title: 'Editor + Design Opus',
    desc: 'Hybrid creatives who can handle both video editing and design work — the full creative package.',
    tags: ['Video', 'Design', 'All-in-One'],
    iconBg: '#e2f5ee',
    iconStroke: '#16a34a',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
];

export default function HiringPage() {
  return (
    <div style={{ fontFamily: "'Lato', system-ui, -apple-system, sans-serif", background: '#faf9f6', color: '#0F172A', minHeight: '100vh' }}>
      {/* Google Fonts */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;600;700;900&display=swap" rel="stylesheet" />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1200, margin: '0 auto', padding: '20px 40px' }}>
        <a href="https://upsquadconnect.com" style={{ fontSize: 22, fontWeight: 900, textDecoration: 'none', color: '#0F172A' }}>
          Up<span style={{ color: '#4CAF50' }}>Squad</span>
        </a>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 40px 40px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#eef2e6', color: '#4a7c10', fontSize: 13, fontWeight: 700, letterSpacing: '0.03em', padding: '8px 18px', borderRadius: 999, marginBottom: 28 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4CAF50', animation: 'pulse 2s infinite' }} />
          Open Positions
        </div>
        <h1 style={{ fontSize: 48, fontWeight: 900, lineHeight: 1.15, color: '#0F172A', marginBottom: 16 }}>
          We&apos;re Building<br />
          <span style={{ color: '#94a3b8' }}>the Squad.</span>
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: '#64748b', maxWidth: 540, margin: '0 auto 20px' }}>
          Join our growing team of creatives. Fill out the form and we&apos;ll review your profile.
        </p>
      </section>

      {/* Positions */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 40px 100px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#94a3b8', marginBottom: 12 }}>Open Roles</div>
        <h2 style={{ fontSize: 32, fontWeight: 900, color: '#0F172A', marginBottom: 8 }}>Apply to join the squad</h2>
        <p style={{ fontSize: 15, color: '#64748b', marginBottom: 40 }}>Pick a role that fits you best. All positions are remote-friendly.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {positions.map((pos) => (
            <a
              key={pos.title}
              href={FORM_URL}
              target="_blank"
              rel="noopener"
              className="position-card"
              style={{ background: '#f3f1ec', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 16, padding: 28, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', transition: 'all 200ms ease', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: pos.iconBg }}>
                  {pos.icon}
                </div>
                <span style={{ display: 'inline-block', background: '#d4edda', color: '#2d6a3f', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6 }}>Hiring</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', marginBottom: 8 }}>{pos.title}</div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#64748b', marginBottom: 24, flex: 1 }}>{pos.desc}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 24 }}>
                {pos.tags.map((tag) => (
                  <span key={tag} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#475569' }}>{tag}</span>
                ))}
              </div>
              <div
                style={{ display: 'block', width: '100%', background: '#0F172A', color: '#fff', padding: 14, borderRadius: 12, fontSize: 15, fontWeight: 700, textAlign: 'center', marginTop: 'auto' }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#1e293b'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = '#0F172A'; }}
              >
                Apply Now →
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px 100px', textAlign: 'center' }}>
        <div style={{ background: '#0F172A', borderRadius: 20, padding: '60px 40px', color: '#fff' }}>
          <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 12 }}>Ready to join the squad?</h2>
          <p style={{ fontSize: 15, color: '#94a3b8', marginBottom: 28 }}>Fill out the form and our team will review your profile. We&apos;ll be in touch.</p>
          <a
            href={FORM_URL}
            target="_blank"
            rel="noopener"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#0F172A', padding: '14px 28px', borderRadius: 10, fontSize: 15, fontWeight: 700, textDecoration: 'none', transition: 'background 150ms' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
          >
            Apply Now →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: '#0F172A', color: '#94a3b8', padding: '48px 40px 32px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>Up<span style={{ color: '#4CAF50' }}>Squad</span></div>
          <p style={{ fontSize: 13 }}>&copy; 2025, D-var Dynamics Technologies Pvt Ltd. All rights reserved.</p>
          <a href="mailto:hello@upsquad.com" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13 }}>hello@upsquad.com</a>
        </div>
      </footer>
    </div>
  );
}
