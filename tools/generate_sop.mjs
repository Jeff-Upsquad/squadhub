#!/usr/bin/env node
// SOP auto-generator — drives the running web app with Playwright to produce a
// DRAFT "Systems & Processes" guide: real screenshots with auto-placed markings
// (derived from live element positions), an optional GIF of a flow, and the
// explanatory text from the spec. See workflows/generate_sop.md for the full SOP.
//
// Usage:
//   node tools/generate_sop.mjs --spec tools/sop_specs/how-to-use-inbox.json \
//        [--base http://localhost:3000] [--email testlocal@test.com] [--headed] [--dry]
//
// Prereqs: the web app (and its API) must be running and reachable at --base,
// with representative data for the account in --email. Leaves the SOP as a
// DRAFT for an admin to review/annotate-further/publish.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  loadEnv, mintSession, r2ClientFrom, uploadToR2, decodePng, downscale, encodeGif,
  tiptapDoc, supa, ensureCategory, createDraftSop, insertBlocks,
} from './generate_sop.lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.spec) { console.error('Missing --spec <path>'); process.exit(1); }
const BASE = args.base || 'http://localhost:3000';
const env = loadEnv();
const EMAIL = args.email || env.SOP_GEN_USER_EMAIL || 'testlocal@test.com';
const spec = JSON.parse(readFileSync(args.spec, 'utf8'));

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const pctX = (v, r) => ((v - r.x) / r.width) * 100;
const pctY = (v, r) => ((v - r.y) / r.height) * 100;

run().catch((e) => { console.error('\n✗ generate_sop failed:', e.message); process.exit(1); });

async function run() {
  log(`Spec: ${spec.title}`);
  log(`Auth: minting session for ${EMAIL}…`);
  const { payload, userId } = await mintSession(env, EMAIL);

  const browser = await chromium.launch({ headless: !args.headed });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  log(`Open: ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((p) => localStorage.setItem('squadhub-auth', JSON.stringify(p)), payload);
  // The app holds a socket connection open, so 'networkidle' never settles —
  // wait on DOM + a fixed hydrate delay instead.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500); // let the SPA shell hydrate

  if (await page.locator('text=Sign in or create an account').count()) {
    throw new Error('Not authenticated — login screen still showing. Check the account email / server.');
  }

  await runNav(page, spec.nav || []);

  const db = supa(env);

  let itemId = 'dry-item', lessonId = 'dry-lesson';
  if (!args.dry) {
    const categoryId = await ensureCategory(db, spec.category);
    log('Create draft item…');
    ({ itemId, lessonId } = await createDraftSop(db, { title: spec.title, summary: spec.summary, categoryId, createdBy: userId }));
  }

  const emit = makeEmitter(env, itemId, lessonId, args.dry);
  const blocks = [];
  let shotN = 0;
  for (const b of spec.blocks || []) {
    if (b.kind === 'text') {
      const parts = [];
      if (b.heading) parts.push({ kind: 'heading', text: b.heading });
      for (const p of b.paragraphs || []) parts.push({ kind: 'paragraph', text: p });
      blocks.push({ type: 'text', text_content: tiptapDoc(parts) });
    } else if (b.kind === 'shot') {
      shotN++;
      log(`Shot ${shotN}: ${b.region}  (${(b.markings || []).length} markings)`);
      blocks.push(await buildShot(page, emit, b, shotN));
    } else if (b.kind === 'gif') {
      log(`GIF: ${b.region}  (${(b.frames || []).length} frames)`);
      const block = await buildGif(page, emit, b);
      if (block) blocks.push(block);
    }
  }

  if (args.dry) {
    log('Dry run — assembled blocks (no upload, no DB write):');
    console.log(JSON.stringify(blocks.map(summarizeBlock), null, 2));
  } else {
    await insertBlocks(db, lessonId, blocks);
  }

  await browser.close();
  if (!args.dry) console.log(`SOP_ITEM_ID=${itemId}`); // machine-readable for callers
  const adminBase = BASE.replace(/:3000$/, ':3001');
  log(`\n✓ Draft created: "${spec.title}"`);
  log(`  Review/publish in admin → ${adminBase}/admin/learning/${itemId}`);
}

// Returns an async (filename, buffer, contentType) -> URL.
//  - dry run        → placeholder
//  - R2 creds set   → upload to R2, return public URL
//  - no R2 creds     → inline data URL (so it still works in dev)
function makeEmitter(env, itemId, lessonId, dry) {
  if (dry) return async () => '(dry-run: not uploaded)';
  const hasR2 = env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_PUBLIC_URL;
  if (hasR2) {
    const r2 = r2ClientFrom(env);
    return (filename, body, contentType) => uploadToR2(r2, env, { itemId, lessonId, filename, body, contentType });
  }
  log('  ! No R2 credentials in server/.env — inlining images as data URLs (dev fallback)');
  return async (_filename, body, contentType) => `data:${contentType};base64,${Buffer.from(body).toString('base64')}`;
}

// ---- screenshot + auto-marking ----
async function buildShot(page, emit, b, shotN) {
  if (b.wait) await page.waitForTimeout(b.wait);
  const region = page.locator(b.region).first();
  if (!(await region.count())) throw new Error(`Region not found: ${b.region}`);

  const marks = (b.markings || []).map((m) => ({ selector: m.selector || null, matchText: m.matchText || null }));
  const rects = await page.evaluate(({ regionSel, marks }) => {
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    // Resolve a marking to a DOM element by CSS selector, or by the SMALLEST
    // visible element whose text contains matchText (so labels target tightly).
    const resolve = (m) => {
      if (m.selector) return document.querySelector(m.selector);
      if (m.matchText) {
        // Case-insensitive (the UI often CSS-uppercases labels, so DOM text
        // differs from what's on screen). Smallest matching visible element wins.
        const needle = m.matchText.toLowerCase();
        const els = [...document.querySelectorAll('button,a,[role=button],h1,h2,h3,h4,p,span,div,li')]
          .filter((e) => (e.textContent || '').toLowerCase().includes(needle) && e.getClientRects().length);
        els.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        return els[0] || null;
      }
      return null;
    };
    const rEl = document.querySelector(regionSel);
    return { region: rEl ? rectOf(rEl) : null, marks: marks.map((m) => { const el = resolve(m); return el ? rectOf(el) : null; }) };
  }, { regionSel: b.region, marks });

  const R = rects.region;
  const annotations = [];
  let badgeN = 0;
  (b.markings || []).forEach((m, i) => {
    const M = rects.marks[i];
    if (!M) { log(`  ! marking not found, skipped: ${m.selector || m.matchText}`); return; }
    const color = m.color || 'red';
    if (m.type === 'rect') {
      const pad = m.pad ?? 6;
      annotations.push({ id: `m${i}`, type: 'rect', color,
        x: clamp(pctX(M.x - pad, R)), y: clamp(pctY(M.y - pad, R)),
        w: clamp(((M.width + pad * 2) / R.width) * 100), h: clamp(((M.height + pad * 2) / R.height) * 100) });
    } else if (m.type === 'badge') {
      badgeN++;
      annotations.push({ id: `m${i}`, type: 'badge', color,
        x: clamp(pctX(M.x + M.width / 2, R)), y: clamp(pctY(M.y + M.height / 2, R)), label: m.label || String(badgeN) });
    } else if (m.type === 'arrow') {
      const hx = clamp(pctX(M.x + M.width / 2, R)), hy = clamp(pctY(M.y + M.height / 2, R));
      const off = m.fromOffset || { dx: 16, dy: -16 };
      annotations.push({ id: `m${i}`, type: 'arrow', color, x1: clamp(hx + off.dx), y1: clamp(hy + off.dy), x2: hx, y2: hy });
    } else if (m.type === 'text') {
      annotations.push({ id: `m${i}`, type: 'text', color,
        x: clamp(pctX(M.x + M.width, R) + 1), y: clamp(pctY(M.y, R)), text: m.text || '', wPct: m.wPct || 28 });
    }
  });

  const png = await region.screenshot({ type: 'png' });
  const dims = decodePng(png);
  const url = await emit(`shot-${shotN}.png`, png, 'image/png');
  return {
    type: 'image', file_url: url, file_name: `shot-${shotN}.png`, mime_type: 'image/png', caption: b.caption || null,
    metadata: { alt: b.alt || b.caption || '', annotations: { version: 1, naturalWidth: dims.width, naturalHeight: dims.height, annotations } },
  };
}

// ---- GIF of a flow ----
async function buildGif(page, emit, b) {
  const region = page.locator(b.region).first();
  if (!(await region.count())) throw new Error(`GIF region not found: ${b.region}`);
  const maxW = b.maxWidth || 800;
  const frames = [];
  for (const step of b.frames || []) {
    await applyStep(page, step);
    if (step.wait) await page.waitForTimeout(step.wait);
    const png = await region.screenshot({ type: 'png' });
    frames.push(downscale(decodePng(png), maxW));
  }
  if (!frames.length) return null;
  const gif = encodeGif(frames, b.delay || 900);
  if (gif.length > 19 * 1024 * 1024) log(`  ! GIF is ${(gif.length / 1048576).toFixed(1)}MB (near 20MB cap) — consider fewer/smaller frames`);
  const url = await emit('flow.gif', gif, 'image/gif');
  return { type: 'image', file_url: url, file_name: 'flow.gif', mime_type: 'image/gif', caption: b.caption || null, metadata: { alt: b.alt || b.caption || '' } };
}

// ---- navigation primitives ----
async function runNav(page, steps) { for (const s of steps) { await applyStep(page, s); if (s.wait) await page.waitForTimeout(s.wait); } }

async function applyStep(page, step) {
  if (step.goto) { await page.goto(step.goto, { waitUntil: 'domcontentloaded' }); return; }
  if (step.click) { await page.locator(step.click).first().click(); return; }
  if (step.clickText) {
    await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button,a,[role=button]')];
      const e = els.find((x) => (x.getAttribute('aria-label') || x.title || x.textContent || '').trim() === t)
             || els.find((x) => (x.textContent || '').includes(t));
      if (!e) throw new Error('clickText target not found: ' + t);
      e.click();
    }, step.clickText);
    return;
  }
  if (step.eval) { await page.evaluate(step.eval); return; }
  // bare { wait } handled by callers
}

function summarizeBlock(b) {
  if (b.type === 'text') return { type: 'text', text: b.text_content?.content?.length + ' node(s)' };
  return { type: 'image', file_url: b.file_url, markings: b.metadata?.annotations?.annotations?.length ?? 0, caption: b.caption };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') out.dry = true;
    else if (a === '--headed') out.headed = true;
    else if (a.startsWith('--')) { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

function log(m) { console.log(m); }
