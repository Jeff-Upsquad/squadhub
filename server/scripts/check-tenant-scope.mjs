#!/usr/bin/env node
// ============================================================
// Tenant-scope leak guard.
//
// The server talks to Postgres with the service-role key, so RLS protects
// nothing: every query on a tenant table must scope itself. This guard flags
// any `.from('<tenant table>')` chain in server/src/routes that has neither
//   • a workspace filter — `workspace_id` appears in the chain
//     (.eq/.in('workspace_id', …), an insert payload carrying it, …), nor
//   • an explicit allow comment `// tenant-scope: <reason>` on the chain or on
//     one of the 3 lines above it (e.g. "access checked via checkResourceAccess").
// Inserts/upserts into tables whose workspace_id is filled (and verified
// against the parent row) by a DB trigger count as scoped.
//
// Tenant tables = tables whose baseline definition carries
// `workspace_id uuid NOT NULL` (supabase/migrations/0001_saas_baseline.sql), so
// the list can't drift from the schema.
//
// Existing, not-yet-reviewed chains are recorded per file in
// tenant-scope-baseline.json (a ratchet): the check FAILS when a file gains
// unscoped chains or a new file appears, and tells you to tighten the baseline
// when a file improves. Usage:
//   node server/scripts/check-tenant-scope.mjs            # check (CI)
//   node server/scripts/check-tenant-scope.mjs --list     # print every unscoped chain
//   node server/scripts/check-tenant-scope.mjs --update   # rewrite the baseline
// ============================================================

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..');
const ROOT = resolve(SERVER, '..');
const ROUTES = join(SERVER, 'src', 'routes');
const BASELINE_SQL = join(ROOT, 'supabase', 'migrations', '0001_saas_baseline.sql');
const BASELINE_JSON = join(HERE, 'tenant-scope-baseline.json');

const args = new Set(process.argv.slice(2));

// ---- tenant tables from the schema --------------------------------------
function tenantTables() {
  const sql = readFileSync(BASELINE_SQL, 'utf8');
  const tables = new Set();
  const triggerFilled = new Set();
  const re = /CREATE TABLE public\.(\w+) \(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    if (/\n\s*workspace_id uuid NOT NULL/.test(m[2])) tables.add(m[1]);
  }
  const trg = /CREATE TRIGGER trg_(\w+)_workspace BEFORE INSERT/g;
  while ((m = trg.exec(sql))) triggerFilled.add(m[1]);
  return { tables, triggerFilled };
}

// ---- source scanning -----------------------------------------------------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Text of the statement that starts at `.from(` — up to the `;` that ends it. */
function chainAt(src, idx) {
  let depth = 0;
  for (let i = idx; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth < 0) return src.slice(idx, i);
    } else if (c === ';' && depth <= 0) return src.slice(idx, i);
  }
  return src.slice(idx);
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

export function scanFile(file, { tables, triggerFilled }) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const findings = [];
  const re = /\.from\(\s*['"`](\w+)['"`]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1];
    if (!tables.has(table)) continue;
    const chain = chainAt(src, m.index);
    if (/workspace_id/.test(chain)) continue;
    if (/tenant-scope:/.test(chain)) continue;
    const line = lineOf(src, m.index);
    const endLine = lineOf(src, m.index + chain.length);
    const above = lines.slice(Math.max(0, line - 4), endLine).join('\n');
    if (/tenant-scope:/.test(above)) continue;
    if (/\.(insert|upsert)\(/.test(chain) && triggerFilled.has(table)) continue;
    findings.push({ file: relative(ROOT, file), line, table });
  }
  return findings;
}

function main() {
  const schema = tenantTables();
  const findings = walk(ROUTES).flatMap((f) => scanFile(f, schema));
  const perFile = {};
  for (const f of findings) perFile[f.file] = (perFile[f.file] || 0) + 1;

  if (args.has('--list')) {
    for (const f of findings) console.log(`${f.file}:${f.line}  ${f.table}`);
    console.log(`\n${findings.length} unscoped chain(s) in ${Object.keys(perFile).length} file(s)`);
    return;
  }

  if (args.has('--update')) {
    const sorted = Object.fromEntries(Object.entries(perFile).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_JSON, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`Baseline updated: ${findings.length} unscoped chain(s) recorded.`);
    return;
  }

  const baseline = existsSync(BASELINE_JSON) ? JSON.parse(readFileSync(BASELINE_JSON, 'utf8')) : {};
  let failed = false;
  for (const [file, count] of Object.entries(perFile)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) {
      failed = true;
      console.error(`✗ ${file}: ${count} unscoped tenant-table chain(s) (baseline ${allowed})`);
      for (const f of findings.filter((x) => x.file === file)) console.error(`    ${f.file}:${f.line}  .from('${f.table}')`);
    }
  }
  const improved = Object.entries(baseline).filter(([file, n]) => (perFile[file] ?? 0) < n);
  if (failed) {
    console.error(
      '\nEvery query on a tenant table must filter by workspace_id or carry a\n' +
        '`// tenant-scope: <reason>` comment explaining why it is safe (see server/scripts/check-tenant-scope.mjs).',
    );
    process.exit(1);
  }
  if (improved.length) {
    console.log(`Tighten the baseline (npm run check:tenant-scope -- --update): ${improved.map(([f]) => f).join(', ')}`);
  }
  console.log(`tenant-scope: OK (${findings.length} known unscoped chain(s) remain in the baseline)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
