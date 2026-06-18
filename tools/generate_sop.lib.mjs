// Helpers for the SOP auto-generator (tools/generate_sop.mjs).
// Deterministic plumbing: env loading, headless auth, R2 upload, GIF encoding,
// Tiptap doc building, and draft-SOP creation via the Supabase service role.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ---- env ----
// Reads server/.env for local CLI runs; in the prod container (spawned by the
// server) that file doesn't exist, so fall back to the inherited process.env.
export function loadEnv() {
  const file = path.join(REPO_ROOT, 'server', '.env');
  let fileEnv = {};
  try {
    const txt = readFileSync(file, 'utf8');
    fileEnv = Object.fromEntries(
      txt.split('\n')
        .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { /* no file — rely on process.env (prod) */ }
  return { ...process.env, ...fileEnv };
}

// ---- auth: mint a real Supabase session for a user via the service role ----
// Returns the localStorage payload the web app expects plus the user id.
export async function mintSession(env, email) {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr) throw new Error(`generateLink: ${linkErr.message}`);

  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`);

  const { data: profile } = await admin.from('users').select('*').eq('id', v.session.user.id).single();
  const payload = {
    state: { user: profile, accessToken: v.session.access_token, refreshToken: v.session.refresh_token, isAuthenticated: true },
    version: 0,
  };
  return { payload, userId: v.session.user.id };
}

// ---- R2 ----
export function r2ClientFrom(env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

// Mirror the server's LMS key layout: lms/<itemId>/<lessonId>/<ts>_<file>.
export async function uploadToR2(client, env, { itemId, lessonId, filename, body, contentType }) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `lms/${itemId}/${lessonId}/${Date.now()}_${safe}`;
  await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: contentType }));
  return `${env.R2_PUBLIC_URL}/${key}`;
}

// ---- GIF encoding (PNG frames -> animated GIF) ----
export function decodePng(buf) {
  const png = PNG.sync.read(buf);
  return { data: new Uint8Array(png.data), width: png.width, height: png.height };
}

// Integer-factor nearest-neighbour downscale to keep GIFs small.
export function downscale(frame, maxW) {
  if (frame.width <= maxW) return frame;
  const factor = Math.ceil(frame.width / maxW);
  const w = Math.floor(frame.width / factor);
  const h = Math.floor(frame.height / factor);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y * factor) * frame.width + x * factor) * 4;
      const di = (y * w + x) * 4;
      out[di] = frame.data[si];
      out[di + 1] = frame.data[si + 1];
      out[di + 2] = frame.data[si + 2];
      out[di + 3] = frame.data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

export function encodeGif(frames, delay = 900) {
  const gif = GIFEncoder();
  for (const f of frames) {
    const palette = quantize(f.data, 256);
    const index = applyPalette(f.data, palette);
    gif.writeFrame(index, f.width, f.height, { palette, delay });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

// ---- Tiptap doc builder (text blocks) ----
// parts: array of { kind: 'heading'|'paragraph', text, level? }
export function tiptapDoc(parts) {
  return {
    type: 'doc',
    content: parts.map((p) =>
      p.kind === 'heading'
        ? { type: 'heading', attrs: { level: p.level || 2 }, content: [{ type: 'text', text: p.text }] }
        : { type: 'paragraph', content: [{ type: 'text', text: p.text }] }
    ),
  };
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

// ---- Supabase (service role) draft-SOP creation ----
export function supa(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function ensureCategory(db, name) {
  if (!name) return null;
  const { data: existing } = await db.from('lms_categories').select('id').eq('name', name).limit(1).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db
    .from('lms_categories')
    .insert({ name, slug: `${slugify(name)}-${Date.now().toString(36)}`, color: '#6366f1', position: 100 })
    .select('id').single();
  if (error) throw new Error(`ensureCategory: ${error.message}`);
  return data.id;
}

// Create the draft item (status='draft'), then fill the auto-created lesson with
// the assembled blocks. Returns the new item id. Leaves it UNPUBLISHED so an
// admin reviews before it goes out.
export async function createDraftSop(db, { title, summary, categoryId, createdBy }) {
  const slug = `${slugify(title)}-${Date.now().toString(36)}`;
  const { data: item, error } = await db
    .from('lms_items')
    .insert({ kind: 'post', track: 'sop', title, slug, summary: summary ?? null, category_id: categoryId, status: 'draft', created_by: createdBy })
    .select('id').single();
  if (error) throw new Error(`createDraftSop item: ${error.message}`);

  // The post auto-create-lesson trigger fires on insert.
  const { data: lesson, error: lErr } = await db
    .from('lms_lessons').select('id').eq('item_id', item.id).order('position').limit(1).single();
  if (lErr) throw new Error(`createDraftSop lesson: ${lErr.message}`);
  return { itemId: item.id, lessonId: lesson.id };
}

export async function insertBlocks(db, lessonId, blocks) {
  const rows = blocks.map((b, i) => ({
    lesson_id: lessonId,
    type: b.type,
    position: i,
    text_content: b.text_content ?? null,
    file_url: b.file_url ?? null,
    file_name: b.file_name ?? null,
    mime_type: b.mime_type ?? null,
    caption: b.caption ?? null,
    metadata: b.metadata ?? {},
  }));
  const { error } = await db.from('lms_content_blocks').insert(rows);
  if (error) throw new Error(`insertBlocks: ${error.message}`);
}
