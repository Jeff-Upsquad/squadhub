"""Step 2 — COPY accounts, shared workspaces and content into the SaaS database.

    # default: dry run — builds every SQL batch into .tmp/copy_dry_run/, touches no database
    python3 -m tools.migrate_from_hub.copy --plan .tmp/migration_plan.json

    # real writes need BOTH flags; the target must not be the Hub's database
    python3 -m tools.migrate_from_hub.copy --plan PLAN --execute --target postgresql://... \
        --auth-mode supabase-admin          # or local-stub for a throwaway local Postgres

Idempotent: every SaaS row id is uuid5(namespace, hub table + hub id), every
insert is ON CONFLICT DO NOTHING, every copied row is recorded in
hub_migration.id_map, and finished targets are recorded in
hub_migration.targets so a re-run skips them (use --resync to top up new Hub
rows). Files are NOT copied: file_url / object_key keep pointing at R2.
Hub content is re-read (read-only) at copy time, from the live Hub or --fixture.
"""
import sys

if __name__ == "__main__" and not __package__:
    sys.exit("Run as a module from the repo root: python3 -m tools.migrate_from_hub.copy")
if __name__ == "copy":  # imported as the stdlib name -> it would shadow `copy`
    raise ImportError("tools/migrate_from_hub/copy.py must not be imported as 'copy'")

import argparse
import json
import os
import secrets
import subprocess
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .common import (TMP_DIR, Content, HubIndex, collect_content, det_id, hub_credentials,
                     hub_project_ref, log, make_reader, slugify)

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}

# Insert-time triggers that would emit notifications or auto-create rows we copy
# ourselves. Disabled INSIDE each copy transaction and re-enabled before COMMIT
# (DDL is transactional, so a failure rolls back to "enabled"). They take an
# ACCESS EXCLUSIVE lock for the transaction: run in a maintenance window.
SUPPRESSED_TRIGGERS = [
    ("spaces", "trg_space_auto_member"), ("spaces", "trg_space_statuses"),
    ("folders", "trg_folder_auto_member"), ("lists", "trg_list_auto_member"),
    ("channels", "trg_channel_auto_member"),
    ("tasks", "trg_notify_task_assigned"), ("task_comments", "trg_notify_task_commented"),
    ("messages", "trg_notify_dm_received"), ("messages", "trg_notify_message_mention"),
    ("messages", "trg_notify_thread_reply"),
]

BOOKKEEPING_SQL = """
CREATE SCHEMA IF NOT EXISTS hub_migration;
REVOKE ALL ON SCHEMA hub_migration FROM PUBLIC;
CREATE TABLE IF NOT EXISTS hub_migration.id_map (
  hub_table text NOT NULL,
  hub_id text NOT NULL,
  saas_id uuid NOT NULL,
  saas_workspace_id uuid,
  run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_table, hub_id)
);
CREATE TABLE IF NOT EXISTS hub_migration.targets (
  target_key text PRIMARY KEY,
  saas_workspace_id uuid NOT NULL,
  run_id text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now()
);
"""


# =============================================================== safety
def check_target(url: str) -> urllib.parse.ParseResult:
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("postgres", "postgresql"):
        raise SystemExit("--target must be a postgresql:// URL")
    ref = hub_project_ref() or "kfxdbhwxzvptzzcuzlal"
    host = (p.hostname or "").lower()
    hub_host = ""
    try:
        hub_url, _ = hub_credentials()
        hub_host = (urllib.parse.urlparse(hub_url).hostname or "").lower()
    except SystemExit:
        pass
    if ref.lower() in url.lower() or (hub_host and host in (hub_host, "db." + hub_host)):
        raise SystemExit("REFUSED: --target points at the Hub's database. The copy only ever writes to the SaaS DB.")
    return p


def psql_env(p: urllib.parse.ParseResult) -> Dict[str, str]:
    env = dict(os.environ)
    q = urllib.parse.parse_qs(p.query)
    env.update({
        "PGHOST": p.hostname or "127.0.0.1",
        "PGPORT": str(p.port or 5432),
        "PGUSER": urllib.parse.unquote(p.username or "postgres"),
        "PGDATABASE": (p.path or "/postgres").lstrip("/") or "postgres",
    })
    if p.password:
        env["PGPASSWORD"] = urllib.parse.unquote(p.password)
    if "sslmode" in q:
        env["PGSSLMODE"] = q["sslmode"][0]
    return env


class Target:
    def __init__(self, url: str) -> None:
        self.parsed = check_target(url)
        self.env = psql_env(self.parsed)
        self.is_local = (self.parsed.hostname or "") in LOCAL_HOSTS

    def run(self, sql: str) -> None:
        proc = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                              input=sql, text=True, env=self.env, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip()[-4000:])

    def query(self, sql: str) -> list:
        wrapped = f"SELECT coalesce(json_agg(q), '[]'::json) FROM ({sql}) q"
        proc = subprocess.run(["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", wrapped],
                              text=True, env=self.env, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip()[-4000:])
        return json.loads(proc.stdout.strip() or "[]")


# =============================================================== SQL building
def dq(payload: str) -> str:
    tag = "$j" + secrets.token_hex(4) + "$"
    while tag in payload:
        tag = "$j" + secrets.token_hex(4) + "$"
    return f"{tag}{payload}{tag}"


def insert(table: str, rows: List[dict], conflict: str = "(id)", schema: str = "public") -> str:
    if not rows:
        return ""
    cols = list(rows[0].keys())
    collist = ", ".join(f'"{c}"' for c in cols)
    out = []
    for i in range(0, len(rows), 400):
        payload = json.dumps(rows[i:i + 400], default=str, ensure_ascii=False)
        out.append(f"INSERT INTO {schema}.{table} ({collist}) SELECT {collist} FROM "
                   f"jsonb_populate_recordset(NULL::{schema}.{table}, {dq(payload)}::jsonb) "
                   f"ON CONFLICT {conflict} DO NOTHING;")
    return "\n".join(out) + "\n"


def lit(v: Optional[str]) -> str:
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def topo(rows: List[dict], parent_key: str) -> List[dict]:
    ids = {r["id"] for r in rows}
    done, out = set(), []
    pending = list(rows)
    while pending:
        nxt = []
        for r in pending:
            p = r.get(parent_key)
            if p and p in ids and p not in done:
                nxt.append(r)
            else:
                out.append(r)
                done.add(r["id"])
        if len(nxt) == len(pending):  # cycle: break it
            out.extend(nxt)
            break
        pending = nxt
    return out


# =============================================================== the copier
class Copier:
    def __init__(self, plan: dict, reader, target: Optional[Target], auth_mode: str, run_id: str,
                 resync: bool = False) -> None:
        self.plan = plan
        self.reader = reader
        self.t = target
        self.auth_mode = auth_mode
        self.run_id = run_id
        self.resync = resync
        self.user_map: Dict[str, str] = {}       # hub user id | email key -> saas user id
        self.user_type: Dict[str, str] = {}
        self.ws_map: Dict[str, str] = {}         # plan key -> saas workspace id
        self.task_type_map: Dict[str, str] = {}  # hub task_type id -> saas id
        self.default_plan_id: Optional[str] = None
        self.report: Dict[str, dict] = {}
        self.dry_dir = TMP_DIR / "copy_dry_run"

    # ---------------------------------------------------------- helpers
    def emit(self, name: str, sql: str) -> None:
        if not sql.strip():
            return
        if self.t is None:
            self.dry_dir.mkdir(parents=True, exist_ok=True)
            (self.dry_dir / f"{name}.sql").write_text(sql)
        else:
            self.t.run(sql)

    def wrap(self, body: str) -> str:
        dis = "\n".join(f"ALTER TABLE public.{t} DISABLE TRIGGER {n};" for t, n in self.present_triggers)
        en = "\n".join(f"ALTER TABLE public.{t} ENABLE TRIGGER {n};" for t, n in self.present_triggers)
        return f"BEGIN;\nSET LOCAL search_path = public, extensions;\n{dis}\n{body}\n{en}\nCOMMIT;\n"

    def u(self, hub_id: Optional[str]) -> Optional[str]:
        return self.user_map.get(hub_id) if hub_id else None

    def map_users(self, ids: Iterable[str]) -> List[str]:
        return [self.user_map[i] for i in (ids or []) if i in self.user_map]

    def idmap(self, rows: List[Tuple[str, str, str, Optional[str]]]) -> str:
        return insert("id_map", [{"hub_table": a, "hub_id": b, "saas_id": c, "saas_workspace_id": d,
                                  "run_id": self.run_id} for a, b, c, d in rows],
                      conflict="(hub_table, hub_id)", schema="hub_migration")

    # ---------------------------------------------------------- setup
    def prepare(self) -> None:
        self.present_triggers = list(SUPPRESSED_TRIGGERS)
        if self.t is None:
            return
        self.t.run(BOOKKEEPING_SQL)
        have = {(r["t"], r["n"]) for r in self.t.query(
            "SELECT c.relname AS t, tg.tgname AS n FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid "
            "JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND NOT tg.tgisinternal")}
        missing = [x for x in SUPPRESSED_TRIGGERS if x not in have]
        if missing:
            log(f"note: triggers not present on target (skipped): {missing}")
        self.present_triggers = [x for x in SUPPRESSED_TRIGGERS if x in have]
        tt = {r["key"]: r["id"] for r in self.t.query("SELECT id, key FROM public.task_types")}
        for r in self.reader.fetch("task_types"):
            if r["key"] in tt:
                self.task_type_map[r["id"]] = tt[r["key"]]
        rows = self.t.query("SELECT id FROM public.plans WHERE is_default LIMIT 1")
        self.default_plan_id = rows[0]["id"] if rows else None

    # ---------------------------------------------------------- users
    def provision_auth(self, users: List[dict]) -> str:
        """Create auth identities. Returns SQL to run (local-stub) or '' (API mode)."""
        if not users:
            return ""
        if self.auth_mode == "local-stub":
            if self.t is not None and not self.t.is_local:
                raise SystemExit("REFUSED: --auth-mode local-stub is only for a local throwaway Postgres")
            return insert("users", [{"id": x["id"], "email": x["email"],
                                     "raw_user_meta_data": {"hub_user_id": x.get("hub_user_id"),
                                                            "migrated_from_hub": True}} for x in users],
                          schema="auth")
        if self.auth_mode == "supabase-admin":
            if self.t is None:
                return ""
            base = os.environ.get("SAAS_SUPABASE_URL", "").rstrip("/")
            key = os.environ.get("SAAS_SUPABASE_SERVICE_ROLE_KEY", "")
            ref = (hub_project_ref() or "kfxdbhwxzvptzzcuzlal").lower()
            if not base or not key:
                raise SystemExit("supabase-admin auth mode needs SAAS_SUPABASE_URL + SAAS_SUPABASE_SERVICE_ROLE_KEY")
            if ref in base.lower():
                raise SystemExit("REFUSED: SAAS_SUPABASE_URL is the Hub's project")
            for x in users:
                body = json.dumps({"id": x["id"], "email": x["email"], "email_confirm": True,
                                   "user_metadata": {"hub_user_id": x.get("hub_user_id"), "migrated_from_hub": True,
                                                     "display_name": x["display_name"]}}).encode()
                req = urllib.request.Request(base + "/auth/v1/admin/users", data=body, method="POST", headers={
                    "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
                try:
                    urllib.request.urlopen(req, timeout=30).read()
                except urllib.error.HTTPError as e:  # 422 = already exists -> adopted below by email lookup
                    if e.code != 422:
                        raise RuntimeError(f"auth create failed ({e.code}) for a user")
            return ""
        if self.t is not None:
            raise SystemExit("--execute needs --auth-mode local-stub|supabase-admin")
        return ""

    def copy_users(self) -> None:
        entries = [dict(e, _k=e["hub_user_id"]) for e in self.plan["users"].values()] + \
                  [dict(e, _k=e["key"]) for e in self.plan["new_users"].values()]
        existing_by_hub, existing_by_email, auth_by_email = {}, {}, {}
        if self.t is not None:
            emails = json.dumps(sorted({(e["email"] or "").strip().lower() for e in entries}))
            for r in self.t.query(f"SELECT id, lower(email) AS email, hub_user_id FROM public.users "
                                  f"WHERE hub_user_id IS NOT NULL OR lower(email) IN "
                                  f"(SELECT jsonb_array_elements_text({dq(emails)}::jsonb))"):
                if r["hub_user_id"]:
                    existing_by_hub[r["hub_user_id"]] = r
                existing_by_email[r["email"]] = r
            for r in self.t.query(f"SELECT id, lower(email) AS email FROM auth.users WHERE lower(email) IN "
                                  f"(SELECT jsonb_array_elements_text({dq(emails)}::jsonb))"):
                auth_by_email[r["email"]] = r["id"]
        new_rows, auth_needed, patches, idm = [], [], [], []
        for e in entries:
            hub = e["hub_user_id"]
            email = (e["email"] or "").strip()
            ex = existing_by_hub.get(hub) if hub else None
            ex = ex or existing_by_email.get(email.lower())
            if ex:
                if hub and ex["hub_user_id"] and ex["hub_user_id"] != hub:
                    raise SystemExit(f"CONFLICT: SaaS user for a moved Hub user is already linked to another Hub user "
                                     f"(hub id {hub}); resolve by hand")
                sid = ex["id"]
                if hub and not ex["hub_user_id"]:
                    patches.append(f"UPDATE public.users SET hub_user_id = {lit(hub)} WHERE id = {lit(sid)} AND hub_user_id IS NULL;")
            else:
                sid = auth_by_email.get(email.lower()) or det_id("user", e["_k"])
                roles = set(e["roles"])
                referenced_only = roles <= {"referenced_author"}
                status = "suspended" if referenced_only and e["user_type"] != "internal" else "active"
                new_rows.append({"id": sid, "email": email, "display_name": e["display_name"] or email,
                                 "avatar_url": e.get("avatar_url"), "status": status,
                                 "user_type": e["user_type"], "phone": e.get("phone"), "hub_user_id": hub})
                if email.lower() not in auth_by_email:
                    auth_needed.append({"id": sid, "email": email, "hub_user_id": hub, "display_name": e["display_name"]})
            self.user_map[e["_k"]] = sid
            self.user_type[e["_k"]] = e["user_type"]
            if hub:
                idm.append(("users", hub, sid, None))
        sql = self.provision_auth(auth_needed) + insert("users", new_rows) + "\n".join(patches) + "\n" + self.idmap(idm)
        self.emit("00_users", f"BEGIN;\n{sql}\nCOMMIT;\n")
        self.report["users"] = {"created": len(new_rows), "adopted": len(entries) - len(new_rows),
                                "auth_created": len(auth_needed)}

    # ---------------------------------------------------------- accounts
    def owner_id(self, acc: dict) -> str:
        o = acc["owner"]
        return self.user_map[o.get("hub_user_id") or o.get("email_key")]

    def find_existing_workspace(self, acc: dict) -> Optional[str]:
        if self.t is None:
            return None
        if acc["kind"] == "shared":
            host = self.ws_map.get(acc["host_key"])
            rows = self.t.query(f"SELECT id FROM public.workspaces WHERE kind = 'shared' AND host_workspace_id = {lit(host)} "
                                f"ORDER BY created_at LIMIT 1") if host else []
            return rows[0]["id"] if rows else None
        for col in ("hub_client_id", "hub_partner_user_id", "squadhire_business_id", "squadhire_talent_id"):
            v = acc.get(col)
            if v:
                rows = self.t.query(f"SELECT id FROM public.workspaces WHERE kind = {lit(acc['kind'])} AND {col} = {lit(v)}")
                if rows:
                    return rows[0]["id"]
        return None

    def target_done(self, key: str) -> bool:
        if self.t is None or self.resync:
            return False
        return bool(self.t.query(f"SELECT 1 FROM hub_migration.targets WHERE target_key = {lit(key)}"))

    def account_sql(self, acc: dict, ws_id: str, existed: bool) -> str:
        owner = self.owner_id(acc)
        parts = []
        if not existed:
            row = {"id": ws_id, "name": (acc["name"] or acc["kind"])[:80],
                   "slug": f"{slugify(acc['name'])}-{ws_id[:6]}", "kind": acc["kind"], "status": "active",
                   "owner_user_id": owner, "plan_id": None if acc["kind"] == "shared" else self.default_plan_id,
                   "hub_client_id": acc.get("hub_client_id") if acc["kind"] == "business" else None,
                   "hub_partner_user_id": acc.get("hub_partner_user_id"),
                   "squadhire_business_id": acc.get("squadhire_business_id"),
                   "squadhire_talent_id": acc.get("squadhire_talent_id"),
                   "host_workspace_id": self.ws_map.get(acc.get("host_key")) if acc["kind"] == "shared" else None,
                   "created_by": owner}
            parts.append(insert("workspaces", [row]))
            parts.append(insert("platform_audit_log", [{"id": det_id("audit", ws_id), "action": "account.created",
                                                        "workspace_id": ws_id, "actor_user_id": owner,
                                                        "details": {"kind": acc["kind"], "source": "hub_migration",
                                                                    "plan_key": acc["key"], "run_id": self.run_id}}]))
        else:
            for col in ("hub_partner_user_id", "squadhire_business_id", "squadhire_talent_id") + (
                    ("hub_client_id",) if acc["kind"] == "business" else ()):
                if acc.get(col):
                    parts.append(f"UPDATE public.workspaces SET {col} = {lit(acc[col])} WHERE id = {lit(ws_id)} AND {col} IS NULL;")
        members = [{"id": det_id("wm", ws_id, owner), "workspace_id": ws_id, "user_id": owner, "role": "owner",
                    "is_upsquad_staff": False}]
        for m in acc.get("members", []):
            uid = self.user_map[m.get("hub_user_id") or m.get("email_key")]
            members.append({"id": det_id("wm", ws_id, uid), "workspace_id": ws_id, "user_id": uid,
                            "role": m["role"], "is_upsquad_staff": bool(m.get("staff"))})
        parts.append(insert("workspace_members", members, conflict="(workspace_id, user_id)"))
        if acc["kind"] == "talent":
            parts.append(insert("workspace_mini_apps", [{"workspace_id": ws_id, "slug": s, "enabled": True}
                                                        for s in ("check-ins", "partner-payments")],
                                conflict="(workspace_id, slug)"))
        gen = det_id("general", ws_id)
        if not existed:
            parts.append(insert("channels", [{"id": gen, "workspace_id": ws_id, "name": "general",
                                              "description": "Announcements and work-based matters",
                                              "is_private": False, "created_by": owner}]))
            parts.append(insert("resource_memberships", [
                {"id": det_id("rm", "channel", gen, m["user_id"]), "resource_type": "channel", "resource_id": gen,
                 "user_id": m["user_id"], "access_level": "manager" if m["role"] == "owner" else "member",
                 "invited_by": owner, "workspace_id": ws_id} for m in members],
                conflict="(resource_type, resource_id, user_id)"))
        return "".join(parts)

    # ---------------------------------------------------------- content
    def content_sql(self, ws_id: str, c: Content, grants: Dict[str, List[Tuple[str, str]]]) -> Tuple[str, dict]:
        """grants: saas user id -> [(access_level, scope)] where scope is 'all' or a space-scope token."""
        U, parts, idm = self.u, [], []
        skipped: Dict[str, int] = dict(c.skipped)

        def skip(k: str) -> None:
            skipped[k] = skipped.get(k, 0) + 1

        tt = lambda x: self.task_type_map.get(x) if x else None
        spaces = []
        for s in c.spaces:
            r = s["row"]
            is_space = s["source_type"] == "space"
            spaces.append({
                "id": s["saas_id"], "workspace_id": ws_id, "name": s["name"],
                "color": r.get("color") if is_space and r.get("color") else "#8b5cf6",
                "icon": r.get("icon") if is_space and r.get("icon") else "folder",
                "is_private": bool(r.get("is_private", True)), "created_by": U(r.get("created_by")),
                "position": r.get("position") or 0, "description": r.get("description") if is_space else None,
                "status": r.get("status") or "active", "is_locked": bool(r.get("is_locked")),
                "kind": "personal" if is_space and r.get("kind") == "personal" else "normal",
                "group_tasks": bool(r.get("group_tasks")),
                "auto_assignee_ids": self.map_users(r.get("auto_assignee_ids")),
                "default_task_type_id": tt(r.get("default_task_type_id"))})
            idm.append(("space:" + s["source_type"], s["source_id"], s["saas_id"], ws_id))
        parts.append(insert("spaces", spaces))
        statuses = []
        for s in c.spaces:
            rows = c.statuses.get(s["saas_id"]) or [
                {"name": "To Do", "color": "#6b7280", "position": 0, "is_default": True, "category": "todo"},
                {"name": "In Progress", "color": "#2962FF", "position": 1, "is_default": False, "category": "active"},
                {"name": "Done", "color": "#16a34a", "position": 2, "is_default": False, "category": "done"}]
            for st in rows:
                statuses.append({"id": det_id("space_status", s["saas_id"], st["name"].lower()), "space_id": s["saas_id"],
                                 "name": st["name"], "color": st.get("color") or "#6b7280",
                                 "position": st.get("position") or 0, "is_default": bool(st.get("is_default")),
                                 "category": st.get("category") or "active", "workspace_id": ws_id})
        parts.append(insert("space_statuses", statuses))
        folders = []
        for f in topo(c.folders, "_parent"):
            fid = det_id("folder", f["id"])
            folders.append({"id": fid, "space_id": f["_space"], "workspace_id": ws_id, "name": f["name"],
                            "is_private": bool(f.get("is_private", True)), "created_by": U(f.get("created_by")),
                            "position": f.get("position") or 0, "status": f.get("status") or "active",
                            "is_locked": bool(f.get("is_locked")), "folder_type": f.get("folder_type") or "folder",
                            "parent_folder_id": det_id("folder", f["_parent"]) if f.get("_parent") else None,
                            "group_tasks": bool(f.get("group_tasks")),
                            "auto_assignee_ids": self.map_users(f.get("auto_assignee_ids")),
                            "default_task_type_id": tt(f.get("default_task_type_id"))})
            idm.append(("folders", f["id"], fid, ws_id))
        parts.append(insert("folders", folders))
        lists = []
        for l in c.lists:
            lid = det_id("list", l["id"])
            lists.append({"id": lid, "space_id": l["_space"], "workspace_id": ws_id,
                          "folder_id": det_id("folder", l["_folder"]) if l.get("_folder") else None,
                          "name": l["name"], "is_private": bool(l.get("is_private", True)),
                          "created_by": U(l.get("created_by")), "position": l.get("position") or 0,
                          "status": l.get("status") or "active", "is_locked": bool(l.get("is_locked")),
                          "group_tasks": bool(l.get("group_tasks")),
                          "auto_assignee_ids": self.map_users(l.get("auto_assignee_ids")),
                          "default_task_type_id": tt(l.get("default_task_type_id"))})
            idm.append(("lists", l["id"], lid, ws_id))
        parts.append(insert("lists", lists))
        task_ids = {t["id"] for t in c.tasks}
        tasks = []
        for t in topo(c.tasks, "parent_task_id"):
            tid = det_id("task", t["id"])
            tasks.append({"id": tid, "list_id": det_id("list", t["list_id"]), "workspace_id": ws_id,
                          "title": t["title"], "description": t.get("description"), "status": t.get("status") or "todo",
                          "priority": t.get("priority") or "none", "assignee_ids": self.map_users(t.get("assignee_ids")),
                          "due_date": t.get("due_date"), "created_by": U(t.get("created_by")),
                          "created_at": t.get("created_at"), "time_estimate": t.get("time_estimate"),
                          "time_tracked": t.get("time_tracked") or 0,
                          "metadata": dict(t.get("metadata") or {}, hub_task_id=t["id"]),
                          "display_number": t.get("display_number"), "task_type_id": tt(t.get("task_type_id")),
                          "work_date": t.get("work_date"), "start_date": t.get("start_date"),
                          "parent_task_id": det_id("task", t["parent_task_id"]) if t.get("parent_task_id") in task_ids else None,
                          "last_modified_by": U(t.get("last_modified_by")), "recurrence": t.get("recurrence"),
                          "recurrence_paused": bool(t.get("recurrence_paused")),
                          "recurring_parent_id": det_id("task", t["recurring_parent_id"]) if t.get("recurring_parent_id") in task_ids else None,
                          "recurrence_instance_date": t.get("recurrence_instance_date") if t.get("recurring_parent_id") in task_ids else None,
                          "created_via": "hub_migration"})
            idm.append(("tasks", t["id"], tid, ws_id))
        parts.append(insert("tasks", tasks))
        comments = []
        for cm in c.comments:
            if not U(cm.get("user_id")):
                skip("comments_unmapped_author")
                continue
            cid = det_id("comment", cm["id"])
            comments.append({"id": cid, "task_id": det_id("task", cm["task_id"]), "workspace_id": ws_id,
                             "user_id": U(cm["user_id"]), "content": cm["content"], "created_at": cm.get("created_at"),
                             "mentions": self.map_users(cm.get("mentions"))})
            idm.append(("task_comments", cm["id"], cid, ws_id))
        parts.append(insert("task_comments", comments))
        atts = []
        for a in c.attachments:
            if not U(a.get("uploaded_by")):
                skip("attachments_unmapped_uploader")
                continue
            aid = det_id("attachment", a["id"])
            atts.append({"id": aid, "task_id": det_id("task", a["task_id"]), "workspace_id": ws_id,
                         "object_key": a["object_key"], "file_url": a["file_url"], "file_name": a["file_name"],
                         "file_size": a.get("file_size") or 0, "mime_type": a.get("mime_type") or "application/octet-stream",
                         "uploaded_by": U(a["uploaded_by"]), "uploaded_at": a.get("uploaded_at")})
            idm.append(("task_attachments", a["id"], aid, ws_id))
        parts.append(insert("task_attachments", atts))
        channels = []
        for ch in c.channels:
            chid = det_id("channel", ch["id"])
            channels.append({"id": chid, "workspace_id": ws_id, "name": ch["name"], "description": ch.get("description"),
                             "is_private": bool(ch.get("is_private", True)), "created_by": U(ch.get("created_by")),
                             "created_at": ch.get("created_at"), "linked_resource_type": ch["_link"][0],
                             "linked_resource_id": ch["_link"][1], "linked_label": ch.get("linked_label"),
                             "linked_subtitle": ch.get("linked_subtitle"), "channel_kind": ch.get("channel_kind") or "standard"})
            idm.append(("channels", ch["id"], chid, ws_id))
        parts.append(insert("channels", channels))
        msg_ids = {m["id"] for m in c.messages if U(m.get("sender_id"))}
        msgs = []
        for m in topo(c.messages, "parent_message_id"):
            if m["id"] not in msg_ids:
                skip("messages_unmapped_sender")
                continue
            mid = det_id("message", m["id"])
            parent = m.get("parent_message_id")
            if parent and parent not in msg_ids:
                skip("thread_replies_without_parent")
                continue
            msgs.append({"id": mid, "channel_id": det_id("channel", m["channel_id"]), "workspace_id": ws_id,
                         "sender_id": U(m["sender_id"]), "content": m.get("content"), "type": m.get("type") or "text",
                         "file_url": m.get("file_url"), "created_at": m.get("created_at"), "updated_at": m.get("updated_at"),
                         "is_deleted": bool(m.get("is_deleted")), "mentions": self.map_users(m.get("mentions")),
                         "file_name": m.get("file_name"), "file_size": m.get("file_size"), "file_mime": m.get("file_mime"),
                         "duration_ms": m.get("duration_ms"), "unfurl": m.get("unfurl"),
                         "reply_count": m.get("reply_count") or 0,
                         "parent_message_id": det_id("message", parent) if parent else None,
                         "edited_at": m.get("edited_at"), "metadata": m.get("metadata"),
                         "mention_all": bool(m.get("mention_all"))})
            idm.append(("messages", m["id"], mid, ws_id))
        parts.append(insert("messages", msgs))
        copied = {m["id"] for m in c.messages if det_id("message", m["id"]) in {x["id"] for x in msgs}}
        parts.append(insert("message_threads", [
            {"parent_message_id": det_id("message", t["parent_message_id"]), "reply_message_id": det_id("message", t["reply_message_id"])}
            for t in c.threads if t["parent_message_id"] in copied and t["reply_message_id"] in copied],
            conflict="(parent_message_id, reply_message_id)"))
        reacts = []
        for r in c.reactions:
            if r["message_id"] not in copied or not U(r.get("user_id")):
                skip("reactions_unmapped")
                continue
            reacts.append({"id": det_id("reaction", r["id"]), "message_id": det_id("message", r["message_id"]),
                           "user_id": U(r["user_id"]), "emoji": r["emoji"], "workspace_id": ws_id})
        parts.append(insert("reactions", reacts, conflict="(message_id, user_id, emoji)"))

        # memberships: Hub grants that map, then the migration's own grants
        rms: Dict[Tuple[str, str, str], dict] = {}
        for m in c.memberships:
            uid = U(m.get("user_id"))
            if not uid:
                skip("memberships_unmapped_user")
                continue
            rms[(m["_rtype"], m["_rid"], uid)] = {"access_level": m.get("access_level") or "member",
                                                  "invited_by": U(m.get("invited_by"))}
        space_scope = {s["saas_id"]: s for s in c.spaces}
        folder_space = {det_id("folder", f["id"]): f["_space"] for f in c.folders}
        list_space = {det_id("list", l["id"]): l["_space"] for l in c.lists}

        def resource_space(rtype: str, rid: str) -> str:
            return rid if rtype == "space" else folder_space.get(rid) or list_space.get(rid) or ""

        resources = [("space", s) for s in space_scope] + [("folder", f) for f in folder_space] + \
                    [("list", l) for l in list_space] + [("channel", ch["id"]) for ch in channels]
        chan_space = {ch["id"]: resource_space(ch["linked_resource_type"], ch["linked_resource_id"]) for ch in channels}
        rank = {"viewer": 0, "commenter": 1, "member": 2, "manager": 3}
        for uid, rules in grants.items():
            for level, scope in rules:
                for rtype, rid in resources:
                    sp = chan_space[rid] if rtype == "channel" else resource_space(rtype, rid)
                    if scope != "all" and not scope(space_scope.get(sp)):
                        continue
                    cur = rms.get((rtype, rid, uid))
                    if not cur or rank[level] > rank.get(cur["access_level"], 0):
                        rms[(rtype, rid, uid)] = {"access_level": level, "invited_by": cur["invited_by"] if cur else None}
        parts.append(insert("resource_memberships", [
            {"id": det_id("rm", rt, rid, uid), "resource_type": rt, "resource_id": rid, "user_id": uid,
             "access_level": v["access_level"], "invited_by": v["invited_by"], "workspace_id": ws_id}
            for (rt, rid, uid), v in rms.items()], conflict="(resource_type, resource_id, user_id)"))
        parts.append(self.idmap(idm))
        counts = {"spaces": len(spaces), "folders": len(folders), "lists": len(lists), "tasks": len(tasks),
                  "comments": len(comments), "attachments": len(atts), "channels": len(channels),
                  "messages": len(msgs), "reactions": len(reacts), "memberships": len(rms)}
        return "".join(parts), {"counts": counts, "skipped": skipped}

    # ---------------------------------------------------------- per target
    def copy_target(self, acc: dict, idx: HubIndex, n: int) -> None:
        key = acc["key"]
        if self.target_done(key):
            rows = self.t.query(f"SELECT saas_workspace_id FROM hub_migration.targets WHERE target_key = {lit(key)}")
            self.ws_map[key] = rows[0]["saas_workspace_id"]
            self.report[key] = {"skipped": "already migrated (use --resync to top up)"}
            return
        existing = self.find_existing_workspace(acc)
        ws_id = existing or det_id("workspace", key)
        self.ws_map[key] = ws_id
        if acc["kind"] == "shared":
            host = next(a for a in self.plan["accounts"] if a["key"] == acc["host_key"])
            members = list(host.get("members", []))
            talents = {a["key"]: a for a in self.plan["accounts"] if a["kind"] == "talent"}
            for l in acc["links"]:
                o = talents[l["talent_key"]]["owner"]
                members.append(dict(o, role="member"))
            for s in acc["staff"]:
                members.append({"hub_user_id": s, "role": "member", "staff": True})
            acc = dict(acc, owner=host["owner"], members=members)
        sql = self.account_sql(acc, ws_id, existed=bool(existing))

        # grants for the migration's own access model
        owner = self.owner_id(acc)
        grants: Dict[str, List] = {owner: [("manager", "all")]}
        for m in acc.get("members", []):
            uid = self.user_map[m.get("hub_user_id") or m.get("email_key")]
            if m.get("staff"):
                grants.setdefault(uid, []).append(("member", "all"))
            elif acc["kind"] != "shared" or m["role"] in ("admin", "member") and m.get("hub_user_id") not in self._talent_owner_ids():
                grants.setdefault(uid, []).append(("manager" if m["role"] == "admin" else "member", "all"))
        links_sql = ""
        if acc["kind"] == "shared":
            talents = {a["key"]: a for a in self.plan["accounts"] if a["kind"] == "talent"}
            link_rows = [{"id": det_id("swl", ws_id, self.ws_map[acc["host_key"]]), "shared_workspace_id": ws_id,
                          "participant_workspace_id": self.ws_map[acc["host_key"]], "participant_role": "host",
                          "hub_card_id": None, "card_category": None, "status": "active"}]
            for l in acc["links"]:
                t_ws = self.ws_map[l["talent_key"]]
                link_rows.append({"id": det_id("swl", ws_id, t_ws), "shared_workspace_id": ws_id,
                                  "participant_workspace_id": t_ws, "participant_role": "talent",
                                  "hub_card_id": l["hub_card_id"], "card_category": l["card_category"],
                                  "status": l["status"]})
                o = talents[l["talent_key"]]["owner"]
                uid = self.user_map[o.get("hub_user_id") or o.get("email_key")]
                cats, lfs = set(l["space_categories"]), set(l["linked_folder_ids"])
                scope = (lambda cats, lfs: lambda s: bool(s) and (
                    s.get("category") in cats or (s["source_type"] == "folder" and s["source_id"] in lfs)))(cats, lfs)
                grants.setdefault(uid, []).append(("member", scope))
            links_sql = insert("shared_workspace_links", link_rows, conflict="(shared_workspace_id, participant_workspace_id)")
        content = collect_content(idx, acc.get("content_specs", []))
        csql, rep = self.content_sql(ws_id, content, grants)
        done = insert("targets", [{"target_key": key, "saas_workspace_id": ws_id, "run_id": self.run_id,
                                   "counts": rep["counts"]}], conflict="(target_key)", schema="hub_migration")
        if self.resync:
            done = f"UPDATE hub_migration.targets SET run_id = {lit(self.run_id)}, completed_at = now() WHERE target_key = {lit(key)};\n" + done
        self.emit(f"{n:02d}_{acc['kind']}_{ws_id[:8]}", self.wrap(sql + links_sql + csql + done))
        rep["saas_workspace_id"] = ws_id
        rep["adopted_existing"] = bool(existing)
        self.report[key] = rep

    def _talent_owner_ids(self) -> set:
        return {a["owner"].get("hub_user_id") for a in self.plan["accounts"] if a["kind"] == "talent"}

    def run(self, only: Optional[str]) -> dict:
        self.prepare()
        self.copy_users()
        idx = HubIndex(self.reader)
        order = [a for a in self.plan["accounts"] if a["kind"] == "business"] + \
                [a for a in self.plan["accounts"] if a["kind"] == "talent"] + self.plan["shared_workspaces"]
        if only:
            needed = {only}
            sw = next((s for s in self.plan["shared_workspaces"] if s["key"] == only), None)
            if sw:
                needed |= {sw["host_key"]} | {l["talent_key"] for l in sw["links"]}
            order = [a for a in order if a["key"] in needed]
        for n, acc in enumerate(order, start=1):
            log(f"[{n}/{len(order)}] {acc['key']}")
            self.copy_target(acc, idx, n)
        return self.report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", default=str(TMP_DIR / "migration_plan.json"))
    ap.add_argument("--fixture", help="read Hub content from a JSON fixture instead of the live Hub")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="(default) build SQL only")
    mode.add_argument("--execute", action="store_true", help="really write to --target")
    ap.add_argument("--target", help="SaaS Postgres URL (or env SAAS_DB_URL); refused if it is the Hub")
    ap.add_argument("--auth-mode", choices=["local-stub", "supabase-admin"],
                    help="how auth identities are created (local-stub: throwaway local DB only)")
    ap.add_argument("--only", help="migrate one plan key (plus the accounts a shared workspace needs)")
    ap.add_argument("--resync", action="store_true", help="re-run finished targets to top up new Hub rows")
    ap.add_argument("--allow-blockers", action="store_true", help="execute even though the plan lists blockers")
    args = ap.parse_args()

    plan = json.loads(Path(args.plan).read_text())
    if plan.get("source") == "hub" and args.fixture:
        raise SystemExit("plan was built from the live Hub; don't mix it with --fixture")
    target = None
    if args.execute:
        url = args.target or os.environ.get("SAAS_DB_URL")
        if not url:
            raise SystemExit("--execute requires --target <saas db url> (or SAAS_DB_URL)")
        target = Target(url)
        blockers = [p for p in plan["problems"] if p["severity"] == "blocker"]
        if blockers and not args.allow_blockers:
            raise SystemExit(f"plan has {len(blockers)} blocker problem(s); fix them or pass --allow-blockers "
                             f"(blocked items are already left out of the plan)")
        if not args.auth_mode:
            raise SystemExit("--execute requires --auth-mode")
    elif args.target:
        check_target(args.target)  # validate even in dry run
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    reader = make_reader(args.fixture or None)
    copier = Copier(plan, reader, target, args.auth_mode or "", run_id, resync=args.resync)
    report = copier.run(args.only)
    out = TMP_DIR / f"copy_report_{'execute' if target else 'dryrun'}_{run_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=str))
    log(f"{'EXECUTED' if target else 'DRY RUN (no database touched)'}; report: {out}")
    if not target:
        log(f"SQL batches written to {copier.dry_dir}")


if __name__ == "__main__":
    main()
