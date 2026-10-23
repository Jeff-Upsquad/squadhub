"""Step 5 — FREEZE: generate (never apply) the Hub-side SQL that puts moved
users into read-only / redirect mode.

    python3 -m tools.migrate_from_hub.freeze --plan .tmp/migration_plan.json [--block-login]

Writes .tmp/hub_freeze.sql and .tmp/hub_freeze_rollback.sql for review. This
script never connects to any database for writing; it only reads the Hub
(GET-only, or --fixture) to expand copied folders into their descendants.

The freeze SQL:
  1. adds users.moved_to_saas_at / users.saas_redirect_url (marker the Hub login
     guard should read to show "your workspace moved to app.squadhub.in"),
  2. snapshots then downgrades the moved users' resource_memberships to 'viewer'
     (Hub's permissions middleware treats viewer as read-only),
  3. snapshots then sets is_locked on every copied space/folder/list,
  4. with --block-login: snapshots status and sets users.status = 'suspended'
     (blocks sign-in with today's code, before any login-guard change ships).
It ENDS WITH ROLLBACK on purpose: change the last line to COMMIT after review.
"""
import sys

if __name__ == "__main__" and not __package__:
    sys.exit("Run as a module from the repo root: python3 -m tools.migrate_from_hub.freeze")

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List

from .common import TMP_DIR, HubIndex, log, make_reader

MOVED_ROLES = {"business_owner", "business_member", "talent_owner"}


def in_list(ids: Iterable[str]) -> str:
    vals = sorted({i for i in ids if i})
    for v in vals:  # ids come from the plan; refuse anything that isn't a uuid
        if not all(ch in "0123456789abcdef-" for ch in v.lower()) or len(v) != 36:
            raise SystemExit(f"refusing non-uuid id in plan: {v!r}")
    return "(" + ", ".join(f"'{v}'" for v in vals) + ")" if vals else "(NULL)"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", default=str(TMP_DIR / "migration_plan.json"))
    ap.add_argument("--fixture", help="read Hub structure from a JSON fixture (tests)")
    ap.add_argument("--redirect-url", default="https://app.squadhub.in")
    ap.add_argument("--block-login", action="store_true", help="also set status='suspended' for moved users")
    ap.add_argument("--out-dir", default=str(TMP_DIR))
    args = ap.parse_args()

    plan = json.loads(Path(args.plan).read_text())
    moved = [uid for uid, u in plan["users"].items() if set(u["roles"]) & MOVED_ROLES]
    idx = HubIndex(make_reader(args.fixture))
    spaces: List[str] = []
    folders: List[str] = []
    lists: List[str] = []
    for acc in plan["accounts"] + plan["shared_workspaces"]:
        for spec in acc.get("content_specs", []):
            if spec.get("personal"):
                continue  # personal spaces stay usable read-only via memberships
            if spec["source_type"] == "space":
                spaces.append(spec["source_id"])
                fs = [f["id"] for f in idx.folders.values() if f["space_id"] == spec["source_id"] and not f.get("deleted_at")]
                folders += fs
                lists += [l["id"] for l in idx.lists.values() if l.get("space_id") == spec["source_id"]]
            else:
                sub = [spec["source_id"]] + idx.folder_subtree(spec["source_id"], spec.get("exclude_folder_ids") or [])
                folders += sub
                lists += [l["id"] for l in idx.lists.values() if l.get("folder_id") in set(sub)]
    U, S, F, L = in_list(moved), in_list(spaces), in_list(folders), in_list(lists)
    ts = datetime.now(timezone.utc).isoformat()
    url = args.redirect_url.replace("'", "''")

    freeze = f"""-- Hub freeze for users moved to Squad Hub SaaS — REVIEW ONLY, NOT APPLIED.
-- Generated {ts} from plan generated {plan['generated_at']} ({plan['source']}).
-- {len(set(moved))} moved users, {len(set(spaces))} spaces, {len(set(folders))} folders, {len(set(lists))} lists.
-- Apply only after the copy is verified and the switch (SSO / app URLs) is live.
-- Ends with ROLLBACK: change the final line to COMMIT once reviewed.
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS moved_to_saas_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS saas_redirect_url text;

CREATE TABLE IF NOT EXISTS public.saas_freeze_snapshot (
  kind text NOT NULL,          -- 'membership' | 'space' | 'folder' | 'list' | 'user_status'
  row_id uuid NOT NULL,
  previous_value text,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, row_id)
);
REVOKE ALL ON public.saas_freeze_snapshot FROM anon, authenticated;

-- 1. redirect marker
UPDATE public.users SET moved_to_saas_at = now(), saas_redirect_url = '{url}'
 WHERE id IN {U} AND moved_to_saas_at IS NULL;

-- 2. moved users become read-only on everything they were shared into
INSERT INTO public.saas_freeze_snapshot (kind, row_id, previous_value)
SELECT 'membership', id, access_level FROM public.resource_memberships
 WHERE user_id IN {U} AND access_level <> 'viewer'
ON CONFLICT DO NOTHING;
UPDATE public.resource_memberships SET access_level = 'viewer'
 WHERE user_id IN {U} AND access_level <> 'viewer';

-- 3. lock the copied client containers (no edits by anyone until archived)
INSERT INTO public.saas_freeze_snapshot (kind, row_id, previous_value)
SELECT 'space', id, is_locked::text FROM public.spaces WHERE id IN {S} ON CONFLICT DO NOTHING;
INSERT INTO public.saas_freeze_snapshot (kind, row_id, previous_value)
SELECT 'folder', id, is_locked::text FROM public.folders WHERE id IN {F} ON CONFLICT DO NOTHING;
INSERT INTO public.saas_freeze_snapshot (kind, row_id, previous_value)
SELECT 'list', id, is_locked::text FROM public.lists WHERE id IN {L} ON CONFLICT DO NOTHING;
UPDATE public.spaces SET is_locked = true WHERE id IN {S};
UPDATE public.folders SET is_locked = true WHERE id IN {F};
UPDATE public.lists SET is_locked = true WHERE id IN {L};
"""
    if args.block_login:
        freeze += f"""
-- 4. block sign-in with today's code (status check) until the login guard reads moved_to_saas_at
INSERT INTO public.saas_freeze_snapshot (kind, row_id, previous_value)
SELECT 'user_status', id, status FROM public.users WHERE id IN {U} AND status <> 'suspended' ON CONFLICT DO NOTHING;
UPDATE public.users SET status = 'suspended' WHERE id IN {U};
"""
    freeze += "\nROLLBACK;  -- change to COMMIT after review\n"

    rollback = f"""-- Undo hub_freeze.sql (restores from public.saas_freeze_snapshot). REVIEW ONLY.
-- Generated {ts}.
BEGIN;
UPDATE public.resource_memberships rm SET access_level = s.previous_value
  FROM public.saas_freeze_snapshot s WHERE s.kind = 'membership' AND s.row_id = rm.id;
UPDATE public.spaces x SET is_locked = s.previous_value::boolean
  FROM public.saas_freeze_snapshot s WHERE s.kind = 'space' AND s.row_id = x.id;
UPDATE public.folders x SET is_locked = s.previous_value::boolean
  FROM public.saas_freeze_snapshot s WHERE s.kind = 'folder' AND s.row_id = x.id;
UPDATE public.lists x SET is_locked = s.previous_value::boolean
  FROM public.saas_freeze_snapshot s WHERE s.kind = 'list' AND s.row_id = x.id;
UPDATE public.users u SET status = s.previous_value
  FROM public.saas_freeze_snapshot s WHERE s.kind = 'user_status' AND s.row_id = u.id;
UPDATE public.users SET moved_to_saas_at = NULL, saas_redirect_url = NULL WHERE id IN {U};
DELETE FROM public.saas_freeze_snapshot;
ROLLBACK;  -- change to COMMIT after review
"""
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "hub_freeze.sql").write_text(freeze)
    (out / "hub_freeze_rollback.sql").write_text(rollback)
    log(f"wrote {out/'hub_freeze.sql'} and {out/'hub_freeze_rollback.sql'} (NOT applied)")


if __name__ == "__main__":
    main()
