/**
 * Minimal in-memory stand-in for the supabase-js query builder, enough to run
 * real Express routes against seeded rows in tests. Supports the filters the
 * routes use (eq/neq/in/is/not/contains/or/gte/lte/gt/lt/ilike), ordering,
 * limit/range, single/maybeSingle, head counts, insert/update/upsert/delete and
 * rpc (always empty). Embedded selects (`users!fk(...)`) are ignored — rows
 * come back flat. Unknown tables read as empty.
 */

type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

function matchOr(row: Row, expr: string): boolean {
  // Split top-level commas.
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(' || ch === '{') depth++;
    if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.some((p) => {
    if (p.startsWith('and(')) {
      return p
        .slice(4, -1)
        .split(',')
        .every((q) => matchOr(row, q));
    }
    const [col, op, ...rest] = p.split('.');
    const val = rest.join('.');
    const v = row[col];
    switch (op) {
      case 'eq':
        return String(v) === val;
      case 'neq':
        return String(v) !== val;
      case 'gt':
        return v > val;
      case 'cs':
        return Array.isArray(v) && val.replace(/[{}]/g, '').split(',').every((x) => v.includes(x));
      case 'in':
        return val.replace(/[()]/g, '').split(',').includes(String(v));
      case 'ilike':
        return String(v ?? '').toLowerCase().includes(val.replace(/%/g, '').toLowerCase());
      case 'is':
        return val === 'null' ? v == null : String(v) === val;
      default:
        return true;
    }
  });
}

class Query implements PromiseLike<any> {
  private filters: ((r: Row) => boolean)[] = [];
  private mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: any = null;
  private wantSingle: 'single' | 'maybe' | null = null;
  private head = false;
  private countMode = false;
  private orderBy: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private returning = false;

  constructor(private db: Tables, private table: string) {}

  private rows(): Row[] {
    return (this.db[this.table] ||= []);
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode === 'select') this.mode = 'select';
    else this.returning = true;
    if (opts?.head) this.head = true;
    if (opts?.count) this.countMode = true;
    return this;
  }
  insert(payload: any) {
    this.mode = 'insert';
    this.payload = payload;
    return this;
  }
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  upsert(payload: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.mode = 'upsert';
    this.payload = payload;
    this.upsertOpts = opts || {};
    return this;
  }
  update(payload: any) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }
  delete() {
    this.mode = 'delete';
    return this;
  }
  eq(col: string, val: any) {
    const key = col.includes('.') ? col.split('.').pop()! : col;
    if (col.includes('.')) return this; // embedded-resource filter: ignored
    this.filters.push((r) => r[key] === val);
    return this;
  }
  neq(col: string, val: any) {
    if (col.includes('.')) return this;
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  in(col: string, vals: any[]) {
    if (col.includes('.')) return this;
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: any) {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  not(col: string, op: string, val: any) {
    if (op === 'is' && val === null) this.filters.push((r) => r[col] != null);
    else if (op === 'in') {
      const set = String(val).replace(/[()]/g, '').split(',');
      this.filters.push((r) => !set.includes(String(r[col])));
    }
    return this;
  }
  contains(col: string, vals: any[]) {
    this.filters.push((r) => Array.isArray(r[col]) && vals.every((v) => r[col].includes(v)));
    return this;
  }
  or(expr: string) {
    this.filters.push((r) => matchOr(r, expr));
    return this;
  }
  ilike(col: string, pattern: string) {
    const p = pattern.replace(/%/g, '').toLowerCase();
    this.filters.push((r) => String(r[col] ?? '').toLowerCase().includes(p));
    return this;
  }
  gte(col: string, v: any) { this.filters.push((r) => r[col] >= v); return this; }
  lte(col: string, v: any) { this.filters.push((r) => r[col] <= v); return this; }
  gt(col: string, v: any) { this.filters.push((r) => r[col] > v); return this; }
  lt(col: string, v: any) { this.filters.push((r) => r[col] < v); return this; }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.lim = to - from + 1; return this; }
  single() { this.wantSingle = 'single'; return this; }
  maybeSingle() { this.wantSingle = 'maybe'; return this; }

  private run(): { data: any; error: any; count?: number } {
    const all = this.rows();
    const hit = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'upsert' && this.upsertOpts.onConflict) {
      const keys = this.upsertOpts.onConflict.split(',').map((k) => k.trim());
      const out: Row[] = [];
      for (const r of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const existing = all.find((x) => keys.every((k) => x[k] === r[k]));
        if (existing) {
          if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, r);
          out.push(existing);
        } else {
          const row = { id: r.id ?? globalThis.crypto.randomUUID(), ...r };
          all.push(row);
          out.push(row);
        }
      }
      return this.finish(out);
    }
    if (this.mode === 'insert' || this.mode === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => ({
        id: r.id ?? globalThis.crypto.randomUUID(),
        ...r,
      }));
      all.push(...list);
      return this.finish(list);
    }
    if (this.mode === 'update') {
      for (const r of hit) Object.assign(r, this.payload);
      return this.finish(hit);
    }
    if (this.mode === 'delete') {
      this.db[this.table] = all.filter((r) => !hit.includes(r));
      return this.finish(hit);
    }
    let out = [...hit];
    for (const o of [...this.orderBy].reverse()) {
      out.sort((a, b) => (a[o.col] > b[o.col] ? 1 : a[o.col] < b[o.col] ? -1 : 0) * (o.asc ? 1 : -1));
    }
    if (this.lim != null) out = out.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count: hit.length };
    const res = this.finish(out);
    if (this.countMode) res.count = hit.length;
    return res;
  }

  private finish(rows: Row[]): { data: any; error: any; count?: number } {
    if (this.wantSingle) {
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0) {
        return this.wantSingle === 'maybe'
          ? { data: null, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
    }
    return { data: rows, error: null };
  }

  then<T1 = any, T2 = never>(onF?: ((v: any) => T1 | PromiseLike<T1>) | null, onR?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.run()).then(onF, onR);
  }
}

export function createFakeSupabase(db: Tables, tokens: Record<string, string>) {
  return {
    supabaseAdmin: {
      from: (table: string) => new Query(db, table),
      rpc: async () => ({ data: [], error: null }),
      auth: { admin: {} },
    },
    supabaseAuth: {
      auth: {
        getUser: async (token: string) => {
          const id = tokens[token];
          return id
            ? { data: { user: { id, email: `${id}@example.test` } }, error: null }
            : { data: { user: null }, error: { message: 'bad token' } };
        },
      },
    },
    supabase: {},
    supabaseForUser: () => ({}),
  };
}
