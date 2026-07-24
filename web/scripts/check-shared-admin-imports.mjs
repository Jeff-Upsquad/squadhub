#!/usr/bin/env node
// ============================================================
// Guard: the Leads mini app compiles admin panel modules from source.
//
// The web app renders the admin panel's Job Cards / Subscription Cards /
// Assignments modules directly (web/src/views/app/leads/), rather than keeping
// a second copy. web/next.config.mjs maps the `@` alias to TWO roots —
// [web/src, admin/src] — so an admin view file compiled inside web resolves
// `@/services/api`, `@/components/Toast`, `@/stores/authStore` to WEB's copies
// (web/src wins; admin/src is only the fallback for files web doesn't have).
// That one trick is what lets a single implementation serve both apps: each app
// injects its own api client, toast and auth store into the shared modules.
//
// The trap: this only works for imports written as `@/...`. A RELATIVE import
// inside the admin tree (`../../services/api`) always resolves within admin/src,
// no matter which app is compiling it — so when web compiles that file it binds
// to ADMIN's axios instance (baseURL '/api') and every request 404s. There is
// no type error; it fails silently at runtime. We hit exactly this once, via
// admin/src/hooks/useSquadhireConfig.ts.
//
// This guard walks the transitive import closure of the modules web actually
// pulls in, and fails if any file in that closure reaches a WEB-OVERRIDDEN
// module (one that exists in both web/src and admin/src) by a relative path.
// That is the precise danger: web has its own copy, but a relative import
// silently binds to admin's instead. Files outside the closure are unaffected —
// the admin panel compiles them against its own `@` (= admin/src).
//
// Dependency-free on purpose: this repo has no ESLint wired into the build, and
// installing that toolchain for one rule would still not run in the docker
// `next build` gate. A plain node script runs anywhere `node` does.
// ============================================================

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // web/scripts/
const ADMIN_SRC = resolve(HERE, '../../admin/src');
const WEB_SRC = resolve(HERE, '../src');

// Both source trees must be present for the check to mean anything. web's build
// (local and docker) has both — but if this ever runs somewhere admin/src is
// absent, skip rather than fail: a vacuous pass is safe, a false failure is not.
if (!existsSync(ADMIN_SRC) || !existsSync(WEB_SRC)) {
  console.log('• shared-admin import guard skipped (admin/src or web/src not present).');
  process.exit(0);
}

// Entry points = the admin modules web imports from web/src/views/app/leads/
// (LeadsPage + useLeadBadges). Everything reachable from here is compiled into
// the web bundle and must obey the `@/`-only rule for web-overridden modules.
const ENTRY_POINTS = [
  'views/admin/jobs/AdminJobCards.tsx',
  'views/admin/AdminSubscriptionCards.tsx',
].map((p) => resolve(ADMIN_SRC, p));

const CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.jsx'];

/** Given a base path with no extension, return the concrete file it resolves
 *  to (trying extensions and /index), or null. */
function resolveFile(base) {
  const candidates = [
    base,
    ...CANDIDATE_EXTS.map((e) => base + e),
    ...CANDIDATE_EXTS.map((e) => resolve(base, 'index' + e)),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Resolve an import specifier from `fromFile` to an absolute path within
 *  admin/src, or null for bare packages (react, @squadhub/shared, …). `@/x`
 *  and relative both land in admin/src here — that is what web does too when it
 *  falls through to the admin root. */
function resolveInAdmin(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = resolve(ADMIN_SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // bare package import — not our concern
  return resolveFile(base) || base; // unresolved paths are tsc's problem, not ours
}

/** True when web/src has its OWN copy of the module admin resolves `target` to —
 *  i.e. web overrides it and a relative import would bypass that override. */
function webOverrides(target) {
  if (!target.startsWith(ADMIN_SRC + '/')) return false;
  return resolveFile(resolve(WEB_SRC, relative(ADMIN_SRC, target))) !== null;
}

const IMPORT_RE = /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;

function importsOf(file) {
  const specs = [];
  for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) specs.push(m[1] || m[2]);
  return specs;
}

// Walk the closure exactly as web resolves it: for each file, follow every
// import edge, but PRUNE at web-overridden modules (web compiles its own copy,
// so admin's is not in web's closure). A relative import that lands on a
// web-overridden module is the violation — flag the importing file.
const seen = new Set();
const violations = [];
const stack = [...ENTRY_POINTS];

while (stack.length) {
  const file = stack.pop();
  if (seen.has(file) || !existsSync(file)) continue;
  seen.add(file);

  for (const spec of importsOf(file)) {
    const target = resolveInAdmin(spec, file);
    if (!target) continue; // bare package

    if (webOverrides(target)) {
      // web supplies its own copy. Reached by `@/` this is correct and expected;
      // reached by a relative path the override is silently bypassed → the bug.
      if (spec.startsWith('.')) {
        violations.push({
          file: relative(ADMIN_SRC, file),
          spec,
          target: relative(ADMIN_SRC, target),
        });
      }
      continue; // prune — admin's copy is not part of web's closure
    }

    // Genuinely shared (web has no copy): keep walking within admin/src.
    if (target.startsWith(ADMIN_SRC + '/')) stack.push(target);
  }
}

if (violations.length === 0) {
  console.log(
    `✓ shared-admin import guard: ${seen.size} files in the Leads closure, ` +
      `no relative imports of web-overridden modules.`,
  );
  process.exit(0);
}

console.error(
  '\n✗ shared-admin import guard failed.\n\n' +
    'These files are compiled into the web app by the Leads mini app, but reach a\n' +
    'web-overridden module (services/api, components/Toast, stores/*, …) by a\n' +
    "RELATIVE path. In web that silently binds to admin's copy — admin's api\n" +
    'client 404s against the wrong base URL, admin\'s toast/store go unused — with\n' +
    'no type error. Rewrite each as an `@/…` import so web resolves its own copy.\n',
);
for (const v of violations) {
  console.error(`  admin/src/${v.file}\n    import '${v.spec}'  →  admin/src/${v.target}`);
}
console.error(
  `\n${violations.length} violation(s). See web/scripts/check-shared-admin-imports.mjs for the full why.\n`,
);
process.exit(1);
