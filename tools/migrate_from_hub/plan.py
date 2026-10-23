"""Step 1 — DRY RUN (read-only). Build the Hub -> SaaS migration plan.

    python3 -m tools.migrate_from_hub.plan                 # live Hub, read-only
    python3 -m tools.migrate_from_hub.plan --fixture F.json --out-dir DIR   # tests

Outputs .tmp/migration_plan.json (input to copy.py / freeze.py) and
.tmp/migration_plan.md (human review). Both contain personal data and live in
the gitignored .tmp/ only.
"""
import sys

if __name__ == "__main__" and not __package__:
    sys.exit("Run as a module from the repo root: python3 -m tools.migrate_from_hub.plan")

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from .common import (CATEGORY_SPACES, TEMPLATE_CATEGORY, TMP_DIR, HubIndex, card_category,
                     collect_content, det_id, email_problem, hub_project_ref, log, make_reader,
                     slugify)

ACTIVE_USER = "active"
TALENT_TYPES = {"partner", "partner_employee"}
CLIENT_TYPES = {"client", "client_staff"}


class Planner:
    def __init__(self, reader, include_suspended: bool = False) -> None:
        self.r = reader
        self.include_suspended = include_suspended
        self.problems: List[dict] = []
        self.users: Dict[str, dict] = {}          # hub user id -> user plan entry
        self.new_users: Dict[str, dict] = {}      # 'email:<lower>' -> user without Hub row

    def problem(self, category: str, severity: str, **detail) -> None:
        self.problems.append({"category": category, "severity": severity, **detail})

    # ------------------------------------------------------------------ users
    def use_user(self, hub_id: str, why: str) -> Optional[dict]:
        u = self.hub_users.get(hub_id)
        if not u:
            return None
        entry = self.users.get(hub_id)
        if not entry:
            entry = {"hub_user_id": hub_id, "email": u["email"], "display_name": u["display_name"],
                     "avatar_url": u.get("avatar_url"), "phone": u.get("phone"),
                     "user_type": u["user_type"], "hub_status": u["status"], "roles": []}
            self.users[hub_id] = entry
        if why not in entry["roles"]:
            entry["roles"].append(why)
        return entry

    def use_email_user(self, email: str, name: str, why: str) -> dict:
        key = "email:" + email.strip().lower()
        entry = self.new_users.get(key)
        if not entry:
            entry = {"hub_user_id": None, "key": key, "email": email.strip(), "display_name": name or email,
                     "avatar_url": None, "phone": None, "user_type": "client" if "business" in why else "partner",
                     "hub_status": None, "roles": []}
            self.new_users[key] = entry
        if why not in entry["roles"]:
            entry["roles"].append(why)
        return entry

    # ------------------------------------------------------------------ load
    def load(self) -> None:
        r = self.r
        log("reading Hub tables (read-only)…")
        self.hub_users = {u["id"]: u for u in r.fetch("users")}
        self.clients = {c["id"]: c for c in r.fetch("clients")}
        self.access = r.fetch("client_user_access")
        self.pca = r.fetch("partner_client_assignments")
        self.cards = {c["id"]: c for c in r.fetch("subscription_cards", {"deleted_at": None})}
        self.terms = r.fetch("subscription_assignment_terms")
        self.recipients = r.fetch("subscription_card_external_recipients")
        self.css = {x["id"]: x for x in r.fetch("client_submission_subscriptions")}
        self.submissions = {x["id"]: x for x in r.fetch("client_submissions")}
        self.idx = HubIndex(r)
        self.email_to_user: Dict[str, str] = {}
        for u in self.hub_users.values():
            if u.get("email"):
                self.email_to_user.setdefault(u["email"].strip().lower(), u["id"])

    # ------------------------------------------------------------------ resolution
    def card_client(self, card: dict) -> Optional[str]:
        if card.get("client_id") in self.clients:
            return card["client_id"]
        f = self.idx.folders.get(card.get("linked_folder_id") or "")
        while f:
            if f.get("client_id") in self.clients:
                return f["client_id"]
            f = self.idx.folders.get(f.get("parent_folder_id") or "")
        css = self.css.get(card.get("submission_subscription_id") or "")
        sub = self.submissions.get(css["submission_id"]) if css else None
        if css:
            for c in self.clients.values():
                if c.get("submission_id") == css["submission_id"]:
                    return c["id"]
        email = (card.get("customer_email") or (sub or {}).get("email") or "").strip().lower()
        if email:
            for c in self.clients.values():
                if (c.get("email") or "").strip().lower() == email:
                    return c["id"]
        company = (card.get("customer_company") or (sub or {}).get("business_name") or "").strip().lower()
        if company:
            for c in self.clients.values():
                if (c.get("business_name") or "").strip().lower() == company:
                    return c["id"]
        return None

    def active_assignments(self) -> List[dict]:
        """One entry per live engagement (card assigned, not cancelled/deleted)."""
        terms_by_card = defaultdict(list)
        for t in self.terms:
            terms_by_card[t["card_id"]].append(t)
        out = []
        for card in self.cards.values():
            active_terms = [t for t in terms_by_card.get(card["id"], []) if t["status"] == "active"]
            if card.get("cancelled_at") or (card["state"] != "assigned" and not active_terms):
                continue
            if card["state"] != "assigned":
                self.problem("active_term_on_unassigned_card", "warn", hub_card_id=card["id"], card_state=card["state"])
            term = sorted(active_terms, key=lambda t: t.get("assigned_date") or "")[-1] if active_terms else None
            if not term:
                self.problem("assigned_card_without_active_term", "warn", hub_card_id=card["id"])
            sh_talent = (term or {}).get("recipient_id") or (
                card.get("selected_recipient_id") if card.get("selected_recipient_type") != "partner" else None)
            hub_talent = card.get("selected_talent_user_id") if card.get("selected_talent_user_id") in self.hub_users else None
            if card.get("selected_recipient_type") == "partner" and card.get("selected_recipient_id") in self.hub_users:
                hub_talent = card["selected_recipient_id"]
            talent_email = None
            if sh_talent:
                for rc in self.recipients:
                    if rc["card_id"] == card["id"] and str(rc.get("external_user_id")) == str(sh_talent):
                        talent_email = rc.get("email")
                        break
            if not hub_talent and talent_email:
                hub_talent = self.email_to_user.get(talent_email.strip().lower())
            out.append({"card": card, "term": term, "sh_talent": sh_talent, "hub_talent": hub_talent,
                        "talent_email": talent_email, "client_id": self.card_client(card),
                        "category": card_category(card.get("service_type")),
                        "status": "paused" if card.get("paused_at") else "active"})
        return out

    # ------------------------------------------------------------------ build
    def build(self) -> dict:
        self.load()
        P = self.problem
        assignments = self.active_assignments()

        # ---- talents
        talents: Dict[str, dict] = {}
        sh_ids_by_user: Dict[str, set] = defaultdict(set)
        for rc in self.recipients:
            uid = self.email_to_user.get((rc.get("email") or "").strip().lower())
            if uid and rc.get("external_user_id"):
                sh_ids_by_user[uid].add(str(rc["external_user_id"]))
        on_active_card = {a["hub_talent"] for a in assignments if a["hub_talent"]}
        for u in self.hub_users.values():
            if u["user_type"] not in TALENT_TYPES:
                continue
            if u["status"] != ACTIVE_USER and not self.include_suspended and u["id"] not in on_active_card:
                P("inactive_talent_not_moved", "info", hub_user_id=u["id"], hub_status=u["status"])
                continue
            if u["status"] != ACTIVE_USER:
                P("inactive_talent_moved", "warn", hub_user_id=u["id"], hub_status=u["status"])
            if u["user_type"] == "partner_employee":
                P("partner_employee_without_employer_link", "warn", hub_user_id=u["id"],
                  note="Hub has no employer link; planned as its own talent account")
            sh = sorted(sh_ids_by_user.get(u["id"], set()))
            if len(sh) > 1:
                P("talent_multiple_squadhire_ids", "warn", hub_user_id=u["id"], squadhire_ids=sh)
            self.use_user(u["id"], "talent_owner")
            talents["talent:" + u["id"]] = {
                "key": "talent:" + u["id"], "kind": "talent", "name": u["display_name"] or u["email"],
                "hub_partner_user_id": u["id"], "squadhire_talent_id": sh[0] if len(sh) == 1 else None,
                "owner": {"hub_user_id": u["id"]}, "members": [], "content_specs": [],
            }
        for a in assignments:
            if a["hub_talent"] or not a["sh_talent"]:
                continue
            key = "talent:sh:" + str(a["sh_talent"])
            if key in talents:
                continue
            if not a["talent_email"] or email_problem(a["talent_email"]):
                P("active_talent_unresolvable", "blocker", hub_card_id=a["card"]["id"])
                continue
            P("talent_without_hub_user", "warn", hub_card_id=a["card"]["id"], squadhire_talent_id=a["sh_talent"])
            nu = self.use_email_user(a["talent_email"], a["talent_email"].split("@")[0], "talent_owner")
            talents[key] = {"key": key, "kind": "talent", "name": nu["display_name"], "hub_partner_user_id": None,
                            "squadhire_talent_id": str(a["sh_talent"]), "owner": {"email_key": nu["key"]},
                            "members": [], "content_specs": []}

        # ---- businesses
        access_by_client = defaultdict(list)
        for row in self.access:
            access_by_client[row["client_id"]].append(row)
        clients_with_cards = defaultdict(list)
        for a in assignments:
            if a["client_id"]:
                clients_with_cards[a["client_id"]].append(a)
            else:
                P("card_client_unresolved", "blocker", hub_card_id=a["card"]["id"])
        access_users = {row["user_id"] for row in self.access}
        for u in self.hub_users.values():
            if u["user_type"] in CLIENT_TYPES and u["status"] == ACTIVE_USER and u["id"] not in access_users:
                P("client_user_without_client", "warn", hub_user_id=u["id"])
            if u["id"] in access_users and u["user_type"] in TALENT_TYPES:
                P("user_is_client_and_partner", "warn", hub_user_id=u["id"])
            if u["id"] in access_users and u["user_type"] == "internal":
                P("internal_user_with_client_access", "warn", hub_user_id=u["id"],
                  note="internal user is not moved as a business member")
        businesses: Dict[str, dict] = {}
        for cid, client in self.clients.items():
            rows = sorted(access_by_client.get(cid, []), key=lambda x: x.get("created_at") or "")
            live = []
            for row in rows:
                u = self.hub_users.get(row["user_id"])
                if not u:
                    P("client_access_to_missing_user", "info", hub_client_id=cid)
                elif u["user_type"] == "internal":
                    continue
                elif u["status"] != ACTIVE_USER:
                    P("inactive_client_user_not_moved", "info", hub_client_id=cid, hub_user_id=u["id"], hub_status=u["status"])
                else:
                    live.append(u)
            if not live and not clients_with_cards.get(cid):
                continue
            key = "business:" + cid
            owner = None
            cemail = (client.get("email") or "").strip().lower()
            for u in live:
                if cemail and (u["email"] or "").strip().lower() == cemail:
                    owner = u
                    break
            owner = owner or next((u for u in live if u["user_type"] == "client"), None) or (live[0] if live else None)
            biz = {"key": key, "kind": "business", "name": client.get("business_name") or "Business",
                   "hub_client_id": cid, "squadhire_business_id": client.get("squadhire_business_user_id"),
                   "members": [], "content_specs": [], "hub_client_status": client.get("status")}
            if owner:
                self.use_user(owner["id"], "business_owner")
                biz["owner"] = {"hub_user_id": owner["id"]}
            elif cemail and not email_problem(cemail):
                P("business_owner_without_hub_user", "warn", hub_client_id=cid,
                  note="owner will be created from the client's contact email")
                nu = self.use_email_user(client["email"], client.get("contact_person") or client["business_name"], "business_owner")
                biz["owner"] = {"email_key": nu["key"]}
            else:
                P("business_without_owner", "blocker", hub_client_id=cid,
                  note="no active client user and no real contact email; account not created")
                continue
            for u in live:
                if owner and u["id"] == owner["id"]:
                    continue
                role = "member" if u["user_type"] == "client_staff" else "admin"
                self.use_user(u["id"], "business_member")
                biz["members"].append({"hub_user_id": u["id"], "role": role})
            businesses[key] = biz

        # ---- client content (client folders + legacy client spaces)
        roots_by_client = defaultdict(list)
        for f in self.idx.folders.values():
            if f.get("folder_type") == "client" and not f.get("parent_folder_id") and not f.get("deleted_at"):
                if f.get("client_id") in self.clients:
                    roots_by_client[f["client_id"]].append(f)
                else:
                    P("orphan_client_folder", "warn", hub_folder_id=f["id"], note="client_id missing in clients")
        legacy_by_client = defaultdict(list)
        for s in self.idx.spaces.values():
            if s.get("client_id") and not s.get("deleted_at"):
                if s["client_id"] in self.clients:
                    legacy_by_client[s["client_id"]].append(s)
                else:
                    P("orphan_client_space", "warn", hub_space_id=s["id"])
        for a in assignments:
            lf = a["card"].get("linked_folder_id")
            if lf and (lf not in self.idx.folders or self.idx.folders[lf].get("deleted_at")):
                P("card_linked_folder_missing", "warn", hub_card_id=a["card"]["id"])
        for ch in self.idx.channels.values():
            lt, lid = ch.get("linked_resource_type"), ch.get("linked_resource_id")
            if ch.get("deleted_at") or lt not in ("folder", "list", "space"):
                continue
            target = {"folder": self.idx.folders, "list": self.idx.lists, "space": self.idx.spaces}[lt].get(lid)
            if not target or target.get("deleted_at"):
                P("orphan_linked_channel", "info", hub_channel_id=ch["id"], linked_type=lt)

        def client_specs(cid: str) -> List[dict]:
            specs = []
            roots = roots_by_client.get(cid, [])
            for root in roots:
                prefix = (root["name"] + " · ") if len(roots) > 1 else ""
                template_children = [fid for fid in self.idx.children.get(root["id"], [])
                                     if self.idx.folders[fid].get("client_space_template_id")
                                     and not self.idx.folders[fid].get("deleted_at")]
                specs.append({"source_type": "folder", "source_id": root["id"], "name": root["name"],
                              "category": None, "exclude_folder_ids": template_children})
                for fid in template_children:
                    f = self.idx.folders[fid]
                    tpl = self.idx.templates.get(f["client_space_template_id"]) or {}
                    specs.append({"source_type": "folder", "source_id": fid, "name": prefix + f["name"],
                                  "category": TEMPLATE_CATEGORY.get(tpl.get("slug"), tpl.get("slug"))})
            for s in legacy_by_client.get(cid, []):
                specs.append({"source_type": "space", "source_id": s["id"], "name": s["name"], "category": None})
            return specs

        # ---- shared workspaces (one per business with live engagements)
        shared: Dict[str, dict] = {}
        for cid, items in clients_with_cards.items():
            bkey = "business:" + cid
            if bkey not in businesses:
                P("shared_workspace_blocked", "blocker", hub_client_id=cid, reason="business account not planned")
                continue
            biz = businesses[bkey]
            sw = {"key": "shared:" + cid, "kind": "shared", "name": biz["name"], "host_key": bkey,
                  "hub_client_id": cid, "links": [], "staff": [], "content_specs": client_specs(cid)}
            by_talent: Dict[str, List[dict]] = defaultdict(list)
            for a in items:
                tkey = ("talent:" + a["hub_talent"]) if a["hub_talent"] else (
                    ("talent:sh:" + str(a["sh_talent"])) if a["sh_talent"] else None)
                if not tkey or tkey not in talents:
                    if a["hub_talent"] and a["hub_talent"] in self.hub_users:
                        P("active_talent_not_planned", "blocker", hub_card_id=a["card"]["id"],
                          hub_user_type=self.hub_users[a["hub_talent"]]["user_type"])
                    elif not a["sh_talent"] and not a["hub_talent"]:
                        P("active_card_without_talent", "blocker", hub_card_id=a["card"]["id"])
                    continue
                by_talent[tkey].append(a)
                mgrs = [a["card"].get("assignee_id")] + list(a["card"].get("collaborator_ids") or [])
                mgrs = [m for m in mgrs if m]
                if not mgrs:
                    P("card_without_account_manager", "warn", hub_card_id=a["card"]["id"])
                for m in mgrs:
                    u = self.hub_users.get(m)
                    if not u:
                        P("account_manager_missing", "warn", hub_card_id=a["card"]["id"])
                    elif u["user_type"] != "internal" or u["status"] != ACTIVE_USER:
                        P("account_manager_not_active_internal", "warn", hub_card_id=a["card"]["id"],
                          hub_user_type=u["user_type"], hub_status=u["status"])
                    elif m not in sw["staff"]:
                        sw["staff"].append(m)
                        self.use_user(m, "upsquad_staff")
            for tkey, alist in by_talent.items():
                alist.sort(key=lambda a: a["card"].get("assigned_at") or "")
                main = alist[-1]
                if len(alist) > 1:
                    P("talent_multiple_cards_same_business", "info", talent_key=tkey, hub_client_id=cid,
                      hub_card_ids=[a["card"]["id"] for a in alist],
                      note="one link per talent; latest card stored on the link, all categories granted")
                cats = set()
                folders = set()
                for a in alist:
                    cats |= CATEGORY_SPACES.get(a["category"], {a["category"]})
                    if a["card"].get("linked_folder_id"):
                        folders.add(a["card"]["linked_folder_id"])
                sw["links"].append({"talent_key": tkey, "hub_card_id": main["card"]["id"],
                                    "card_category": main["category"], "status": main["status"],
                                    "hub_term_id": (main["term"] or {}).get("id"),
                                    "all_hub_card_ids": [a["card"]["id"] for a in alist],
                                    "space_categories": sorted(cats), "linked_folder_ids": sorted(folders)})
            if not sw["links"]:
                P("shared_workspace_blocked", "blocker", hub_client_id=cid, reason="no resolvable talent")
                continue
            if not sw["content_specs"]:
                P("client_without_space", "info", hub_client_id=cid, note="shared workspace starts empty")
            shared[sw["key"]] = sw
            cats_with_space = {s.get("category") for s in sw["content_specs"]}
            for l in sw["links"]:
                if not (set(l["space_categories"]) & cats_with_space):
                    P("talent_category_has_no_space", "info", hub_client_id=cid, hub_card_id=l["hub_card_id"],
                      card_category=l["card_category"])

        # clients with content but no live engagement keep it in their business workspace
        for bkey, biz in businesses.items():
            cid = biz["hub_client_id"]
            if "shared:" + cid not in shared:
                biz["content_specs"] = client_specs(cid)
                if not biz["content_specs"]:
                    P("client_without_space", "info", hub_client_id=cid)

        # personal spaces of every moved account owner go to their own account
        owners = {}
        for acc in list(businesses.values()) + list(talents.values()):
            hid = acc["owner"].get("hub_user_id")
            if hid:
                owners[hid] = acc
        for s in self.idx.spaces.values():
            if s.get("kind") == "personal" and not s.get("deleted_at") and s.get("created_by") in owners:
                owners[s["created_by"]]["content_specs"].append(
                    {"source_type": "space", "source_id": s["id"], "name": s["name"], "category": None, "personal": True})

        # ---- content counts + referenced users
        all_targets = list(businesses.values()) + list(talents.values()) + list(shared.values())
        totals = Counter()
        internal_affected = defaultdict(set)
        for acc in all_targets:
            content = collect_content(self.idx, acc["content_specs"])
            acc["counts"] = content.counts()
            acc["skipped"] = content.skipped
            totals.update(acc["counts"])
            refs = content.user_ids()
            missing_required = [u for u in refs["required"] if u not in self.hub_users]
            if missing_required:
                P("content_by_deleted_user", "warn", target=acc["key"], user_count=len(missing_required),
                  note="rows authored by users missing from Hub are skipped")
            refs_all = (refs["required"] | refs["optional"]) & set(self.hub_users)
            acc["referenced_hub_user_ids"] = sorted(refs_all)
            for uid in refs_all:
                if uid not in self.users:
                    self.use_user(uid, "referenced_author")
                u = self.hub_users[uid]
                if u["user_type"] == "internal":
                    internal_affected[uid].add("content_author_or_member")
            # status catalog mismatches
            names = {sid: {s["name"].lower() for s in st} for sid, st in content.statuses.items()}
            list_space = {l["id"]: l["_space"] for l in content.lists}
            off = sum(1 for t in content.tasks if (t.get("status") or "").lower() not in names.get(list_space.get(t["list_id"]), set()))
            if off:
                P("task_status_not_in_space_statuses", "info", target=acc["key"], task_count=off)
        for sw in shared.values():
            for m in sw["staff"]:
                internal_affected[m].add("account_manager")
        for uid, why in internal_affected.items():
            P("internal_user_affected", "info", hub_user_id=uid, reasons=sorted(why))

        # ---- e-mail sanity for everyone who gets a SaaS user
        seen = {}
        for entry in list(self.users.values()) + list(self.new_users.values()):
            ep = email_problem(entry["email"])
            if ep:
                P(ep, "warn" if "referenced_author" in entry["roles"] and len(entry["roles"]) == 1 else "blocker",
                  hub_user_id=entry["hub_user_id"], roles=entry["roles"])
            k = (entry["email"] or "").strip().lower()
            if k and k in seen and seen[k] is not entry:
                P("duplicate_email", "blocker", hub_user_ids=[seen[k].get("hub_user_id"), entry.get("hub_user_id")])
            seen[k] = entry
            roles = set(entry["roles"])
            if {"talent_owner"} & roles and {"business_owner", "business_member"} & roles:
                P("user_in_business_and_talent_roles", "warn", hub_user_id=entry["hub_user_id"])

        # ---- DMs involving moved (non-internal) users are not copied
        moved = {uid for uid, e in self.users.items() if set(e["roles"]) - {"referenced_author", "upsquad_staff"}}
        if moved:
            convs = {p["conversation_id"] for p in self.r.fetch("dm_participants", {"user_id": ("in", sorted(moved))})}
            if convs:
                P("dm_conversations_not_copied", "info", conversation_count=len(convs),
                  note="DMs are not copied; decide before go-live")

        sev = Counter(p["severity"] for p in self.problems)
        cats = Counter(p["category"] for p in self.problems)
        role_counts = Counter(r for e in list(self.users.values()) + list(self.new_users.values()) for r in e["roles"])
        return {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": self.r.source,
            "hub_project_ref": hub_project_ref() if self.r.source == "hub" else None,
            "users": self.users,
            "new_users": self.new_users,
            "accounts": list(businesses.values()) + list(talents.values()),
            "shared_workspaces": list(shared.values()),
            "problems": self.problems,
            "summary": {
                "business_accounts": len(businesses),
                "business_members_excl_owner": sum(len(b["members"]) for b in businesses.values()),
                "talent_accounts": len(talents),
                "shared_workspaces": len(shared),
                "talent_links": sum(len(s["links"]) for s in shared.values()),
                "staff_memberships": sum(len(s["staff"]) for s in shared.values()),
                "active_assignments": len(assignments),
                "saas_users_total": len(self.users) + len(self.new_users),
                "saas_users_by_role": dict(role_counts),
                "content_totals": dict(totals),
                "problems_by_severity": dict(sev),
                "problems_by_category": dict(cats),
            },
        }


def render_md(plan: dict) -> str:
    s = plan["summary"]
    users = plan["users"]
    newu = plan["new_users"]

    def who(ref: dict) -> str:
        if ref.get("hub_user_id"):
            u = users.get(ref["hub_user_id"], {})
            return f"{u.get('display_name')} <{u.get('email')}>"
        u = newu.get(ref.get("email_key"), {})
        return f"{u.get('display_name')} <{u.get('email')}> (new, no Hub user)"

    out = [f"# Hub → SaaS migration plan (dry run)", "",
           f"Generated {plan['generated_at']} from `{plan['source']}`. READ-ONLY run: nothing was written anywhere.",
           "", "## Summary", ""]
    for k, v in s.items():
        if isinstance(v, dict):
            out.append(f"- **{k}**: " + ", ".join(f"{a}={b}" for a, b in sorted(v.items())))
        else:
            out.append(f"- **{k}**: {v}")
    out += ["", "## Business accounts", ""]
    for a in [x for x in plan["accounts"] if x["kind"] == "business"]:
        out.append(f"### {a['name']}  (hub client `{a['hub_client_id']}`)")
        out.append(f"- owner: {who(a['owner'])}")
        for m in a["members"]:
            out.append(f"- {m['role']}: {who(m)}")
        out.append(f"- SquadHire business id: {a.get('squadhire_business_id') or '—'}")
        out.append(f"- content kept in business workspace: {a['counts']}")
        out.append("")
    out += ["## Talent accounts", ""]
    for a in [x for x in plan["accounts"] if x["kind"] == "talent"]:
        out.append(f"- {who(a['owner'])} — SquadHire talent id {a.get('squadhire_talent_id') or '—'}; "
                   f"personal content {a['counts']}")
    out += ["", "## Shared workspaces", ""]
    for sw in plan["shared_workspaces"]:
        out.append(f"### {sw['name']}  (host {sw['host_key']})")
        for l in sw["links"]:
            acc = next((a for a in plan["accounts"] if a["key"] == l["talent_key"]), None)
            out.append(f"- talent {who(acc['owner']) if acc else l['talent_key']} — card `{l['hub_card_id']}` "
                       f"category **{l['card_category']}** ({l['status']}); spaces {l['space_categories']}")
        for m in sw["staff"]:
            out.append(f"- Upsquad staff: {who({'hub_user_id': m})}")
        for spec in sw["content_specs"]:
            out.append(f"- space “{spec['name']}” ← hub {spec['source_type']} `{spec['source_id']}`"
                       f" (category {spec.get('category') or '—'})")
        out.append(f"- content: {sw['counts']}")
        if sw.get("skipped"):
            out.append(f"- skipped: {sw['skipped']}")
        out.append("")
    out += ["## Problems", ""]
    by_cat = defaultdict(list)
    for p in plan["problems"]:
        by_cat[(p["severity"], p["category"])].append(p)
    order = {"blocker": 0, "warn": 1, "info": 2}
    for (sev, cat), items in sorted(by_cat.items(), key=lambda kv: (order.get(kv[0][0], 9), kv[0][1])):
        out.append(f"### [{sev}] {cat} ({len(items)})")
        for p in items[:50]:
            detail = {k: v for k, v in p.items() if k not in ("category", "severity")}
            if detail.get("hub_user_id") in users:
                detail["user"] = who({"hub_user_id": detail["hub_user_id"]})
            out.append(f"- {json.dumps(detail, default=str)}")
        out.append("")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixture", help="read a JSON fixture instead of the live Hub (tests)")
    ap.add_argument("--out-dir", default=str(TMP_DIR))
    ap.add_argument("--include-suspended", action="store_true", help="also move suspended talents")
    args = ap.parse_args()
    plan = Planner(make_reader(args.fixture), include_suspended=args.include_suspended).build()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "migration_plan.json").write_text(json.dumps(plan, indent=2, default=str))
    (out / "migration_plan.md").write_text(render_md(plan))
    s = plan["summary"]
    log(f"wrote {out/'migration_plan.json'} and {out/'migration_plan.md'}")
    log(json.dumps({k: s[k] for k in ("business_accounts", "talent_accounts", "shared_workspaces",
                                      "talent_links", "saas_users_total", "problems_by_severity")}))


if __name__ == "__main__":
    main()
