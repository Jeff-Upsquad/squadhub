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
// There is no baseline: every finding fails the check. Usage:
//   node server/scripts/check-tenant-scope.mjs            # check (CI)
//   node server/scripts/check-tenant-scope.mjs --list     # print every unscoped chain
//
// `workspace_id` inside a .select(...) column list does NOT count as scoping —
// reading the column is not filtering by it. Resolve a resource's workspace
// with workspaceIdOf() (middleware/workspace.ts) instead of an ad-hoc lookup.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..');
const ROOT = resolve(SERVER, '..');
const ROUTES = join(SERVER, 'src', 'routes');
const BASELINE_SQL = join(ROOT, 'supabase', 'migrations', '0001_saas_baseline.sql');

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

/** The chain with every `.select(...)` argument list removed. */
function stripSelects(chain) {
  let out = '';
  let i = 0;
  while (i < chain.length) {
    const j = chain.indexOf('.select(', i);
    if (j < 0) {
      out += chain.slice(i);
      break;
    }
    out += chain.slice(i, j);
    let depth = 0;
    let k = j + '.select'.length;
    for (; k < chain.length; k++) {
      if (chain[k] === '(') depth++;
      else if (chain[k] === ')' && --depth === 0) break;
    }
    i = k + 1;
  }
  return out;
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
    if (/workspace_id/.test(stripSelects(chain))) continue;
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
  const files = new Set(findings.map((f) => f.file));

  if (args.has('--list')) {
    for (const f of findings) console.log(`${f.file}:${f.line}  ${f.table}`);
    console.log(`\n${findings.length} unscoped chain(s) in ${files.size} file(s)`);
    return;
  }

  if (findings.length) {
    for (const f of findings) console.error(`✗ ${f.file}:${f.line}  .from('${f.table}')`);
    console.error(
      `\n${findings.length} unscoped tenant-table chain(s). Every query on a tenant table must filter by\n` +
        'workspace_id or carry a `// tenant-scope: <reason>` comment explaining why it is safe\n' +
        '(see server/scripts/check-tenant-scope.mjs).',
    );
    process.exit(1);
  }
  console.log('tenant-scope: OK (0 unscoped chains)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
