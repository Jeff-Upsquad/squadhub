/* SquadHub Design System — interactions + token data */
(function () {
  'use strict';

  /* ── Color tokens per surface ─────────────────────────── */
  var COLORS = {
    site: [
      { g: 'Warm paper (connect form)', items: [
        { n: 'Canvas', v: '#F8F6F0' }, { n: 'Surface', v: '#FBFAF6' }, { n: 'Cream deep', v: '#F4F1E8' },
        { n: 'Divider', v: '#E8E5DD' }, { n: 'Border', v: '#D9D5C7' }, { n: 'Placeholder', v: '#9C9486' },
        { n: 'Hint', v: '#7A7568' }, { n: 'Text', v: '#222222' }, { n: 'Ink', v: '#0A0A0A' }
      ]},
      { g: 'Butter lime (brand CTA)', items: [
        { n: 'Lime CTA', v: '#FCF487' }, { n: 'Lime hover', v: '#F0E660' }, { n: 'Lime tint', v: '#F2FCBC' }
      ]},
      { g: 'Slate (auth & app pages)', items: [
        { n: 'Canvas', v: '#F0F2F5' }, { n: 'Border', v: '#E2E8F0' }, { n: 'Text', v: '#0F172B' },
        { n: 'Muted', v: '#62748E' }, { n: 'Dim', v: '#90A1B9' }, { n: 'Accent', v: '#2962FF' },
        { n: 'Accent hover', v: '#1E4BD8' }, { n: 'Indigo (downloads)', v: '#6366F1' }
      ]},
      { g: 'Semantic', items: [
        { n: 'Required', v: '#C13515' }, { n: 'Error text', v: '#8B3A1A' }, { n: 'Error bg', v: '#FBEFE9' },
        { n: 'Error border', v: '#E0B7A2' }, { n: 'Warning', v: '#C97744' }, { n: 'Success', v: '#007A5A' }
      ]}
    ],
    webapp: [
      { g: 'Shell — light (:root)', items: [
        { n: 'canvas', v: '#F0F2F5', t: '--canvas' }, { n: 'surface', v: '#FFFFFF', t: '--surface' },
        { n: 'surface-alt', v: '#F1F5F9', t: '--surface-alt' }, { n: 'foreground', v: '#1D1C1D', t: '--foreground' },
        { n: 'foreground-muted', v: '#616061', t: '--foreground-muted' }, { n: 'divider', v: 'rgba(29,28,29,0.13)', t: '--divider' },
        { n: 'sidebar', v: '#F6F6F6', t: '--sidebar' }, { n: 'icon-bar', v: '#EDEDED', t: '--icon-bar' }
      ]},
      { g: 'Ink scale (monochrome shell)', items: [
        { n: 'sh-ink', v: '#0A0A0A', t: '--sh-ink' }, { n: 'sh-ink-2', v: '#2A2A2A', t: '--sh-ink-2' },
        { n: 'sh-ink-3', v: '#6A6A6A', t: '--sh-ink-3' }, { n: 'sh-ink-4', v: '#A0A0A0', t: '--sh-ink-4' },
        { n: 'sh-hair', v: '#E6E6E6', t: '--sh-hair' }, { n: 'sh-hair-2', v: '#D0D0D0', t: '--sh-hair-2' },
        { n: 'sh-hair-3', v: '#F0F0F0', t: '--sh-hair-3' }
      ]},
      { g: 'Shell — dark (.dark)', items: [
        { n: 'canvas', v: '#0F1117' }, { n: 'surface', v: '#161B22' }, { n: 'surface-alt', v: '#1C2030' },
        { n: 'foreground', v: '#E2E8F0' }, { n: 'foreground-muted', v: '#8B97A8' }, { n: 'divider', v: '#21262D' },
        { n: 'sidebar', v: '#101010' }, { n: 'sh-ink (dark)', v: '#F5F5F5' }, { n: 'sh-hair (dark)', v: '#242424' }
      ]},
      { g: 'Accent & semantic', items: [
        { n: 'accent', v: '#2962FF', t: '--color-accent' }, { n: 'green', v: '#007A5A', t: '--color-green' },
        { n: 'success', v: '#22C55E' }, { n: 'danger', v: '#DC2626' }, { n: 'danger soft', v: '#FEE2E2' },
        { n: 'warning', v: '#F59E0B' }, { n: 'warning soft', v: '#FEF3C7' }, { n: 'info', v: '#1D4ED8' },
        { n: 'info soft', v: '#DBEAFE' }, { n: 'now-line red', v: '#DC2626' }, { n: 'planner block', v: '#FEF9C3' },
        { n: 'planner edge', v: '#CA8A04' }
      ]},
      { g: 'Squad Chat sub-brand', items: [
        { n: 'brand', v: '#FF5A1F', t: '--sh-brand' }, { n: 'brand deep', v: '#D9410D' }, { n: 'brand soft', v: '#FFE6DA' },
        { n: 'accent lime', v: '#C8F560' }, { n: 'live', v: '#19C37D' }, { n: 'link', v: '#1264A3' }
      ]},
      { g: 'Slate scale (@theme gray)', items: [
        { n: 'gray-50', v: '#F8FAFC' }, { n: 'gray-100', v: '#F1F5F9' }, { n: 'gray-200', v: '#E2E8F0' },
        { n: 'gray-300', v: '#CBD5E1' }, { n: 'gray-400', v: '#94A3B8' }, { n: 'gray-500', v: '#64748B' },
        { n: 'gray-600', v: '#475569' }, { n: 'gray-700', v: '#334155' }, { n: 'gray-800', v: '#1E293B' },
        { n: 'gray-900', v: '#0F172A' }, { n: 'gray-950', v: '#020618' }
      ]}
    ],
    admin: [
      { g: 'Slate console', items: [
        { n: 'Accent', v: '#2962FF' }, { n: 'Ink', v: '#0F172B' }, { n: 'Ink hover', v: '#1D293D' },
        { n: 'Muted', v: '#62748E' }, { n: 'Dim', v: '#90A1B9' }, { n: 'Border', v: '#E2E8F0' },
        { n: 'Border input', v: '#CAD5E2' }, { n: 'Surface alt', v: '#F1F5F9' }, { n: 'Canvas', v: '#F8FAFC' }
      ]},
      { g: 'SquadHire palette (.sh-*)', items: [
        { n: 'Lime', v: '#FCF487', t: '--color-sh-lime' }, { n: 'Lime hover', v: '#E8DD68' }, { n: 'Lime soft', v: '#FDFAC2' },
        { n: 'Cream', v: '#F7F6F3', t: '--color-sh-cream' }, { n: 'Warm border', v: '#E8E5DE' },
        { n: 'Ink', v: '#0A0A0A' }, { n: 'Ink muted', v: '#525252' }, { n: 'Ink subtle', v: '#737373' },
        { n: 'Ink faint', v: '#A3A3A3' }, { n: 'Mint', v: '#A8E8E8' }, { n: 'Success', v: '#42CC77' }, { n: 'Warning', v: '#F76808' }
      ]},
      { g: 'Lead pipeline status', items: [
        { n: 'New', v: '#3B82F6' }, { n: 'In progress', v: '#F59E0B' }, { n: 'Selection', v: '#8B5CF6' },
        { n: 'Converted', v: '#10B981' }, { n: 'Onboarding', v: '#6366F1' }, { n: 'Closed', v: '#6B7280' }
      ]},
      { g: 'Published-card states', items: [
        { n: 'Active', v: '#10B981' }, { n: 'Selected', v: '#0EA5E9' }, { n: 'Assigned', v: '#059669' },
        { n: 'Cancelled', v: '#6B7280' }, { n: 'Archived', v: '#7C3AED' }, { n: 'New alert', v: '#DC2626' },
        { n: 'Not on SquadHire', v: '#FEF3C7' }, { n: 'Pending / recalled', v: '#FFE9D9' }
      ]},
      { g: 'Button tints', items: [
        { n: 'Warning bg', v: '#FFF4E5' }, { n: 'Warning text', v: '#C04A05' },
        { n: 'Danger bg', v: '#FDECEC' }, { n: 'Danger text', v: '#B42318' },
        { n: 'Success bg', v: '#E6F8EC' }, { n: 'Success text', v: '#1F7E36' },
        { n: 'Info bg', v: '#E8F0FE' }, { n: 'Info text', v: '#1A56DB' },
        { n: 'Violet bg', v: '#F2EBFE' }, { n: 'Violet text', v: '#6B21A8' }
      ]}
    ]
  };

  /* ── Icons per surface ────────────────────────────────────
     Full set generated by tools/extract_icons.py → icons-data.js
     (window.DS_ICONS). Inline fallback below covers the curated
     core set if the generated file is missing. ──────────────── */
  function S(inner, sw, fill) {
    return '<svg viewBox="0 0 24 24" fill="' + (fill || 'none') + '" stroke="' + (fill ? 'none' : 'currentColor') +
      '" stroke-width="' + (sw || 1.6) + '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  var ICONS_FALLBACK = {
    webapp: [
      { n: 'plus', s: S('<path d="M12 5v14M5 12h14"/>') },
      { n: 'close', s: S('<path d="M18 6L6 18M6 6l12 12"/>') },
      { n: 'search', s: S('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>') },
      { n: 'caret', s: S('<path d="M6 9l6 6 6-6"/>') },
      { n: 'chevron-left', s: S('<path d="M15 6l-6 6 6 6"/>') },
      { n: 'more', s: S('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>') },
      { n: 'filter', s: S('<path d="M3 6h18M6 12h12M10 18h4"/>') },
      { n: 'sort', s: S('<path d="M3 6h13M3 12h9M3 18h5M17 4v16M17 20l4-4M17 20l-4-4"/>') },
      { n: 'grid', s: S('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>') },
      { n: 'calendar', s: S('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>') },
      { n: 'link', s: S('<path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>') },
      { n: 'arrow-up-right', s: S('<path d="M7 17L17 7M7 7h10v10"/>') },
      { n: 'paperclip', s: S('<path d="M21 12.5l-9 9a5 5 0 11-7-7l10-10a3.5 3.5 0 115 5L10 19.5a2 2 0 11-3-3l8.5-8.5"/>') },
      { n: 'download', s: S('<path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16"/>') },
      { n: 'inbox', s: S('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>') },
      { n: 'keyboard', s: S('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>') },
      { n: 'share', s: S('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49"/>') },
      { n: 'check', s: S('<path d="M5 12l5 5 9-11"/>', 2.5) }
    ],
    site: [
      { n: 'check', s: S('<path d="M5 13l4 4L19 7"/>', 2) },
      { n: 'back', s: S('<path d="M15 19l-7-7 7-7"/>', 2) },
      { n: 'download', s: S('<path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16"/>', 1.8) },
      { n: 'chat', s: S('<path d="M4.5 5h15c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H9l-4 4V6.5C5 5.7 5.7 5 6.5 5z"/>', 1.8) },
      { n: 'apple', s: S('<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>', 0, 'currentColor') },
      { n: 'windows', s: S('<path d="M3 12V6.75l8-1.25V12H3zm0 .5h8v6.5L3 17.75V12.5zM11.5 5.34l9.5-1.34v8h-9.5V5.34zM11.5 12.5H21v7.84l-9.5 1.16V12.5z"/>', 0, 'currentColor') },
      { n: 'warning', s: S('<path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>', 1.8) }
    ],
    admin: [
      { n: 'dashboard', s: S('<path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>', 1.5) },
      { n: 'check-circle', s: S('<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>', 1.5) },
      { n: 'envelope', s: S('<path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/>', 1.5) },
      { n: 'users', s: S('<path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>', 1.5) },
      { n: 'shield-check', s: S('<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>', 1.5) },
      { n: 'building', s: S('<path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>', 1.5) },
      { n: 'clipboard', s: S('<path d="M3.75 7.5a1.5 1.5 0 011.5-1.5h13.5a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-9zM8 10h8M8 14h5"/>', 1.5) },
      { n: 'trash', s: S('<path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>', 1.5) },
      { n: 'cards-grid', s: S('<path d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z"/>', 1.5) },
      { n: 'eye', s: S('<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>', 1.5) },
      { n: 'chart', s: S('<path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/>', 1.5) },
      { n: 'document', s: S('<path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>', 1.5) },
      { n: 'book', s: S('<path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>', 1.5) },
      { n: 'back', s: S('<path d="M10 19l-7-7m0 0l7-7m-7 7h18"/>', 1.5) },
      { n: 'logout', s: S('<path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>', 1.5) },
      { n: 'search', s: S('<path d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z"/>', 2) }
    ]
  };

  var ICONS = (window.DS_ICONS && window.DS_ICONS.webapp && window.DS_ICONS.webapp.length)
    ? window.DS_ICONS : ICONS_FALLBACK;

  /* ── Rail nav per surface ─────────────────────────────── */
  var RAIL = {
    site: [
      ['site-type', 'Typography'], ['site-colors', 'Colors'], ['site-icons', 'Icons'],
      ['site-buttons', 'Buttons'], ['site-chips', 'Pills & Chips'], ['site-cards', 'Cards & Banners'],
      ['site-inputs', 'Inputs & Forms'], ['site-patterns', 'Patterns']
    ],
    webapp: [
      ['wa-type', 'Typography'], ['wa-colors', 'Colors'], ['wa-icons', 'Icons'],
      ['wa-buttons', 'Buttons'], ['wa-chips', 'Pills, Badges & Tags'], ['wa-cards', 'Cards & Surfaces'],
      ['wa-inputs', 'Inputs & Nav'], ['wa-motion', 'Patterns & Motion']
    ],
    admin: [
      ['ad-type', 'Typography'], ['ad-colors', 'Colors'], ['ad-icons', 'Icons'],
      ['ad-buttons', 'Buttons'], ['ad-badges', 'Badges & Status'], ['ad-cards', 'Cards & Tables'],
      ['ad-inputs', 'Inputs & Nav'], ['ad-patterns', 'Patterns']
    ]
  };

  /* ── Render swatches ──────────────────────────────────── */
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  document.querySelectorAll('[data-colors]').forEach(function (host) {
    var groups = COLORS[host.getAttribute('data-colors')] || [];
    var html = '';
    groups.forEach(function (grp) {
      html += '<div class="sub-h">' + esc(grp.g) + '</div><div class="swatches">';
      grp.items.forEach(function (c) {
        html += '<div class="sw" data-copy="' + c.v + '" title="Copy ' + c.v + '">' +
          '<div class="chip" style="background:' + c.v + '"></div><div class="b">' +
          '<div class="nm">' + esc(c.n) + '</div>' +
          (c.t ? '<div class="vr">' + esc(c.t) + '</div>' : '') +
          '<div class="hx">' + esc(c.v) + '</div></div></div>';
      });
      html += '</div>';
    });
    host.innerHTML = html;
  });

  /* ── Render icons ─────────────────────────────────────── */
  document.querySelectorAll('[data-icons]').forEach(function (host) {
    var list = ICONS[host.getAttribute('data-icons')] || [];
    var html = '';
    list.forEach(function (ic) {
      var tip = ic.n + (ic.f ? '  ·  ' + ic.f : '') + (ic.c > 1 ? '  ·  used ' + ic.c + '×' : '') + '  —  click to copy SVG';
      html += '<div class="ic" title="' + esc(tip).replace(/"/g, '&quot;') + '">' + ic.s +
        '<span class="inm">' + esc(ic.n) + '</span></div>';
    });
    host.innerHTML = html;
    var note = host.closest('section') && host.closest('section').querySelector('.block-head .note');
    if (note) note.innerHTML = '<b style="color:var(--ink-2)">' + list.length + ' unique icons</b> · every inline svg, deduped by geometry<br/>hover for source file · click to copy SVG';
    host.querySelectorAll('.ic').forEach(function (tile, i) {
      tile.addEventListener('click', function () { copyText(list[i].s, 'SVG · ' + list[i].n); });
    });
  });

  /* ── Avatars (hsl hue generation, real formula) ───────── */
  document.querySelectorAll('[data-avatars]').forEach(function (host) {
    var hues = [210, 340, 25, 90, 150, 270, 45, 180];
    var names = ['JZ', 'AM', 'RK', 'PS', 'DV', 'NT', 'SL', 'MB'];
    var size = host.getAttribute('data-avatars');
    host.innerHTML = hues.map(function (h, i) {
      return '<div class="wa-ava ' + size + '" data-copy="hsl(' + h + ', 60%, 78%)" style="background:hsl(' + h + ',60%,78%);color:hsl(' + h + ',45%,30%)" title="hsl(' + h + ', 60%, 78%)">' + names[i] + '</div>';
    }).join('');
  });

  /* ── Copy to clipboard ────────────────────────────────── */
  var toastEl = document.getElementById('copy-toast');
  var toastTimer = null;
  function copyText(text, label) {
    var done = function () {
      toastEl.querySelector('.tx').textContent = 'Copied · ' + (label || text);
      var sq = toastEl.querySelector('.sq');
      sq.style.background = /^#|^rgba|^hsl|^oklch/.test(text) ? text : 'transparent';
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else { done(); }
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-copy]');
    if (el) copyText(el.getAttribute('data-copy'));
  });

  /* ── Surface switching ────────────────────────────────── */
  var SURFACES = ['site', 'webapp', 'admin'];
  var railHost = document.getElementById('rail-links');
  var observer = null;

  function buildRail(surface) {
    railHost.innerHTML = RAIL[surface].map(function (it, i) {
      return '<a href="#' + it[0] + '"><span class="n">0' + (i + 1) + '</span>' + it[1] + '</a>';
    }).join('');
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          railHost.querySelectorAll('a').forEach(function (a) {
            a.setAttribute('data-on', a.getAttribute('href') === '#' + en.target.id ? 'true' : 'false');
          });
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    RAIL[surface].forEach(function (it) {
      var sec = document.getElementById(it[0]);
      if (sec) observer.observe(sec);
    });
  }

  function setSurface(s, skipScroll) {
    if (SURFACES.indexOf(s) === -1) s = 'webapp';
    document.body.setAttribute('data-surface', s);
    document.querySelectorAll('.switcher button').forEach(function (b) {
      b.setAttribute('data-active', b.getAttribute('data-s') === s ? 'true' : 'false');
    });
    buildRail(s);
    if (history.replaceState) history.replaceState(null, '', '#' + s);
    if (!skipScroll) window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.switcher button').forEach(function (b) {
    b.addEventListener('click', function () { setSurface(b.getAttribute('data-s')); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === '1') setSurface('site');
    if (e.key === '2') setSurface('webapp');
    if (e.key === '3') setSurface('admin');
    if (e.key === 'd' && document.body.getAttribute('data-surface') === 'webapp') toggleTheme();
  });

  /* ── Web-app dark mode ────────────────────────────────── */
  var themeBtn = document.getElementById('theme-toggle');
  function toggleTheme() {
    var root = document.getElementById('surface-webapp');
    var dark = root.classList.toggle('dark');
    themeBtn.setAttribute('data-dark', dark);
    themeBtn.querySelector('.tl').textContent = dark ? 'dark' : 'light';
  }
  themeBtn.addEventListener('click', toggleTheme);

  /* ── Demos ────────────────────────────────────────────── */
  document.querySelectorAll('.wa-checkbox.demo').forEach(function (cb) {
    cb.addEventListener('click', function () {
      var done = cb.getAttribute('data-done') === 'true';
      cb.setAttribute('data-done', !done);
      cb.classList.remove('pop');
      if (!done) { void cb.offsetWidth; cb.classList.add('pop'); }
    });
  });
  var toastBtn = document.getElementById('fire-toast');
  if (toastBtn) {
    toastBtn.addEventListener('click', function () {
      var zone = document.getElementById('live-toast-zone');
      var t = document.createElement('div');
      t.className = 'wa-toast-text';
      t.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12l5 5 9-11"/></svg> Task completed';
      zone.appendChild(t);
      setTimeout(function () { t.classList.add('out'); }, 1800);
      setTimeout(function () { t.remove(); }, 2500);
    });
  }

  /* ── Boot ─────────────────────────────────────────────── */
  var initial = (location.hash || '').replace('#', '');
  setSurface(SURFACES.indexOf(initial) !== -1 ? initial : 'webapp', true);
})();
