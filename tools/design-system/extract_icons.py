#!/usr/bin/env python3
"""Harvest every inline <svg> icon from web/ and admin/ into icons-data.js.

Dedupes by shape geometry, names icons from curated map + source context.
Rerun after UI changes:  python3 tools/design-system/extract_icons.py
"""
import json, os, re, sys
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'admin', 'public', 'design-library', 'squadhub', 'assets', 'icons-data.js')

SITE_MARKERS = ['/app/connect/', '/app/help/', '/app/onboard/', '/app/download-app/',
                '/app/partner-app/', '/app/squad-chat-clients/', '/app/squad-chat-team/',
                '/app/(auth)/', 'views/LoginPage', 'views/SignupPage']

KEBAB = {'strokeWidth': 'stroke-width', 'strokeLinecap': 'stroke-linecap',
         'strokeLinejoin': 'stroke-linejoin', 'strokeDasharray': 'stroke-dasharray',
         'strokeDashoffset': 'stroke-dashoffset', 'strokeMiterlimit': 'stroke-miterlimit',
         'fillRule': 'fill-rule', 'clipRule': 'clip-rule', 'fillOpacity': 'fill-opacity',
         'strokeOpacity': 'stroke-opacity', 'vectorEffect': 'vector-effect',
         'shapeRendering': 'shape-rendering'}

# curated names keyed by a distinctive fragment of the shape signature
CURATED = [
    ('plus', 'M12 5v14M5 12h14'), ('close', 'M18 6L6 18M6 6l12 12'),
    ('search', 'M21 21l-4.3-4.3'), ('search', 'M21 21l-4.35-4.35'),
    ('caret-down', 'M6 9l6 6 6-6'), ('chevron-left', 'M15 6l-6 6 6 6'),
    ('chevron-right', 'M9 6l6 6-6 6'), ('more', 'cx=5 cy=12 r=1.3'),
    ('filter', 'M3 6h18M6 12h12M10 18h4'), ('sort', 'M3 6h13M3 12h9M3 18h5'),
    ('grid', 'x=3 y=3 w=7 h=7'), ('calendar', 'M16 3v4M8 3v4M3 10h18'),
    ('link', 'M10 13a5 5 0 007 0l3-3'), ('arrow-up-right', 'M7 17L17 7M7 7h10v10'),
    ('paperclip', 'M21 12.5l-9 9a5 5 0 11-7-7'), ('download', 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16'),
    ('inbox', 'M22 12h-6l-2 3h-4l-2-3H2'), ('keyboard', 'M6 10h.01M10 10h.01'),
    ('share', 'M8.59 13.51l6.83 3.98'), ('check', 'M5 12l5 5 9-11'), ('check', 'M5 13l4 4L19 7'),
    ('check', 'M20 6L9 17l-5-5'), ('back-arrow', 'M15 19l-7-7 7-7'),
    ('arrow-left', 'M10 19l-7-7m0 0l7-7m-7 7h18'), ('download-line', 'M12 3v12m0 0l-4.5-4.5'),
    ('chat-bubble', 'M4.5 5h15c.8 0 1.5.7 1.5 1.5'), ('apple', 'M18.71 19.5c-.83 1.24'),
    ('windows', 'M3 12V6.75l8-1.25'), ('warning-triangle', 'M12 9v3.75m-9.303'),
    ('dashboard', 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2'), ('check-circle', 'M9 12l2 2 4-4m6 2a9 9'),
    ('envelope', 'M21.75 6.75v10.5a2.25'), ('users', 'M12 4.354a4 4 0 110 5.292'),
    ('shield-check', 'M9 12l2 2 4-4m5.618-4.016'), ('building', 'M19 21V5a2 2 0 00-2-2H7'),
    ('clipboard', 'M3.75 7.5a1.5 1.5 0 011.5-1.5h13.5'), ('trash', 'M19 7l-.867 12.142'),
    ('cards-grid', 'M2.25 7.125C2.25 6.504'), ('eye', 'M2.458 12C3.732 7.943'),
    ('chart-bars', 'M3 13.125C3 12.504'), ('document', 'M19.5 14.25v-2.625'),
    ('book', 'M12 6.253v13m0-13C10.832'), ('logout', 'M17 16l4-4m0 0l-4-4'),
    ('x-mark', 'M6 18L18 6M6 6l12 12'),
]

svg_re = re.compile(r'<svg\b[\s\S]*?</svg>')
shape_re = re.compile(r'<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)/?>', re.I)

def normalize(block):
    b = re.sub(r'\{\s*\.\.\.[A-Za-z_$][\w$.]*\s*\}', '', block)
    b = re.sub(r'\s(?:className|style|key|ref|onClick|onMouseDown|aria-hidden)=(?:"[^"]*"|\{[^{}]*\})', '', b)
    b = re.sub(r'\s(?:width|height)=(?:"[^"]*"|\{[^{}]*\})', '', b)
    def attr_expr(m):
        name, val = m.group(1), m.group(2).strip()
        if re.fullmatch(r'-?[\d.]+', val): return ' %s="%s"' % (name, val)
        if re.fullmatch(r"'[^']*'", val) or re.fullmatch(r'"[^"]*"', val):
            return ' %s=%s' % (name, '"' + val[1:-1] + '"')
        return ' %s={DYNAMIC}' % name
    b = re.sub(r'\s([A-Za-z-]+)=\{([^{}]*)\}', attr_expr, b)
    for camel, kebab in KEBAB.items():
        b = b.replace(camel + '=', kebab + '=')
    b = re.sub(r'\s+', ' ', b).replace('> <', '><').strip()
    return b

def signature(block):
    parts = []
    for m in shape_re.finditer(block):
        tag, attrs = m.group(1).lower(), m.group(2)
        if tag == 'path':
            d = re.search(r'\bd="([^"]+)"', attrs)
            if d: parts.append(re.sub(r'\s+', ' ', d.group(1).strip()))
        else:
            geo = {k: v for k, v in re.findall(r'\b([a-z0-9]+)="([^"]+)"', attrs)
                   if k in ('cx','cy','r','x','y','width','height','points','x1','y1','x2','y2','rx','ry')}
            short = {'width':'w','height':'h'}
            parts.append(tag + ':' + ' '.join('%s=%s' % (short.get(k,k), geo[k]) for k in sorted(geo)))
    return ' | '.join(parts)

def context_name(text, start, end):
    before = text[max(0, start - 260):start]
    after = text[end:end + 120]
    m = re.search(r'(?:title|aria-label)=["\']([\w \-/]{2,28})["\']\s*$', before) \
        or re.search(r'\{\s*/\*\s*([\w \-/]{2,28})\s*\*/\s*\}\s*$', before) \
        or re.search(r'(?:const|function)\s+Icon(\w{2,24})[^=]*=?\s*\(?[^<]*$', before) \
        or re.search(r"['\"]?([\w-]{3,24})['\"]?\s*:\s*\(?\s*$", before) \
        or re.search(r"case\s+'([\w-]{3,24})'\s*:[^<]*$", before)
    if m: return re.sub(r'[\s/]+', '-', m.group(1).strip().lower())
    m = re.search(r'^\s*(?:<\/svg>)?\s*([A-Z][\w&’\' -]{2,22})\s*<', after)
    if m: return re.sub(r'[\s&’\']+', '-', m.group(1).strip().lower())
    return None

def surface_of(path):
    p = path.replace('\\', '/')
    if '/admin/src/' in p: return 'admin'
    for mk in SITE_MARKERS:
        if mk in p: return 'site'
    return 'webapp'

icons = {'site': {}, 'webapp': {}, 'admin': {}}
skipped = defaultdict(int)
files_scanned = 0

for app in ('web/src', 'admin/src'):
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, app)):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.next', 'dist')]
        for fn in filenames:
            if not fn.endswith(('.tsx', '.jsx')): continue
            fp = os.path.join(dirpath, fn)
            rel = os.path.relpath(fp, ROOT)
            text = open(fp, encoding='utf-8', errors='ignore').read()
            if '<svg' not in text: continue
            files_scanned += 1
            for m in svg_re.finditer(text):
                norm = normalize(m.group(0))
                if '{' in norm: skipped['dynamic'] += 1; continue
                if len(norm) > 4000: skipped['oversize'] += 1; continue
                sig = signature(norm)
                if not sig: skipped['no-shapes'] += 1; continue
                surf = surface_of(fp)
                bucket = icons[surf]
                if sig in bucket:
                    bucket[sig]['c'] += 1
                    continue
                name = None
                for nm, frag in CURATED:
                    if frag in sig: name = nm; break
                if not name: name = context_name(text, m.start(), m.end())
                if not name: name = os.path.splitext(fn)[0].lower()
                bucket[sig] = {'n': name, 's': norm, 'c': 1, 'f': rel}

# de-conflict duplicate names within a surface
out = {}
for surf, bucket in icons.items():
    seen = defaultdict(int)
    items = sorted(bucket.values(), key=lambda x: (-x['c'], x['n']))
    for it in items:
        seen[it['n']] += 1
        if seen[it['n']] > 1: it['n'] = '%s-%d' % (it['n'], seen[it['n']])
    out[surf] = items

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('/* GENERATED by tools/design-system/extract_icons.py — do not edit by hand */\n')
    f.write('window.DS_ICONS = ')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

print('files with <svg>:', files_scanned)
for surf in ('site', 'webapp', 'admin'):
    print('%s: %d unique icons' % (surf, len(out[surf])))
print('skipped:', dict(skipped))
print('wrote', os.path.relpath(OUT, ROOT))
