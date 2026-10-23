"""Shared helpers for the Hub -> SaaS migration (plan / copy / freeze).

Hub access is READ-ONLY by construction: HubRestReader can only issue HTTP GET
requests against PostgREST's /rest/v1/<table> endpoint for an allow-listed set
of tables. There is no code path that sends POST/PATCH/DELETE or calls an RPC.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
TMP_DIR = REPO_ROOT / ".tmp"
DEFAULT_HUB_ENV = Path("/Users/jeffzeena/squadhub web/server/.env")

# Fixed namespace: every SaaS row id the migration writes is uuid5(NS, ...), so
# a re-run produces the same ids and ON CONFLICT (id) DO NOTHING skips them.
NS = uuid.UUID("6f1d4c2e-6a55-4b8e-9a63-3c1f5d0b7e21")


def det_id(*parts: Any) -> str:
    return str(uuid.uuid5(NS, ":".join(str(p) for p in parts)))


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# --------------------------------------------------------------------- env
def load_env_file(path: Path) -> Dict[str, str]:
    """Parse KEY=VALUE lines. Values are never printed by any caller."""
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def hub_credentials() -> Tuple[str, str]:
    env_path = Path(os.environ.get("HUB_ENV_FILE", str(DEFAULT_HUB_ENV)))
    env = load_env_file(env_path)
    url = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    if not url or not key:
        raise SystemExit(f"SUPABASE_URL / service key missing in {env_path}")
    return url, key


def hub_project_ref() -> Optional[str]:
    """The Hub's Supabase project ref (from its URL), used to refuse writes to it."""
    try:
        url, _ = hub_credentials()
    except SystemExit:
        return os.environ.get("HUB_PROJECT_REF") or "kfxdbhwxzvptzzcuzlal"
    host = urllib.parse.urlparse(url).hostname or ""
    return host.split(".")[0] if host.endswith("supabase.co") else host


# --------------------------------------------------------------------- readers
# Columns read from the Hub, per table. Nothing else is ever requested.
HUB_COLUMNS: Dict[str, List[str]] = {
    "users": ["id", "email", "display_name", "avatar_url", "created_at", "status",
              "user_type", "is_admin", "phone"],
    "clients": ["id", "submission_id", "business_name", "contact_person", "email", "status",
                "squadhire_business_user_id", "created_at"],
    "client_user_access": ["id", "client_id", "user_id", "created_at"],
    "partner_client_assignments": ["user_id", "client_id"],
    "client_submissions": ["id", "email", "business_name"],
    "client_submission_subscriptions": ["id", "submission_id"],
    "client_space_templates": ["id", "slug", "name"],
    "subscription_cards": ["id", "state", "card_type", "service_type", "brand_name",
                           "customer_name", "customer_company", "customer_email",
                           "submission_subscription_id", "client_id", "linked_folder_id",
                           "selected_recipient_type", "selected_recipient_id",
                           "selected_talent_user_id", "assignee_id", "collaborator_ids",
                           "assigned_at", "paused_at", "cancelled_at", "archived_at",
                           "deleted_at", "card_code"],
    "subscription_assignment_terms": ["id", "card_id", "recipient_type", "recipient_id",
                                      "status", "assigned_date", "unassigned_date"],
    "subscription_card_external_recipients": ["card_id", "external_user_id", "email",
                                              "selected_at", "archived_at"],
    "spaces": ["id", "workspace_id", "name", "color", "icon", "is_private", "created_by",
               "position", "description", "deleted_at", "status", "is_locked", "client_id",
               "kind", "group_tasks", "auto_assignee_ids", "default_task_type_id"],
    "folders": ["id", "space_id", "name", "is_private", "created_by", "position", "deleted_at",
                "status", "is_locked", "client_id", "client_space_template_id",
                "subscription_card_id", "folder_type", "parent_folder_id", "group_tasks",
                "auto_assignee_ids", "default_task_type_id"],
    "lists": ["id", "folder_id", "space_id", "name", "is_private", "created_by", "position",
              "deleted_at", "status", "is_locked", "group_tasks", "auto_assignee_ids",
              "default_task_type_id"],
    "space_statuses": ["id", "space_id", "name", "color", "position", "is_default", "category"],
    "task_types": ["id", "key"],
    "tasks": ["id", "list_id", "title", "description", "status", "priority", "assignee_ids",
              "due_date", "created_by", "created_at", "time_estimate", "time_tracked",
              "metadata", "display_number", "task_type_id", "work_date", "start_date",
              "parent_task_id", "last_modified_by", "recurrence", "recurrence_paused",
              "recurring_parent_id", "recurrence_instance_date", "created_via"],
    "task_comments": ["id", "task_id", "user_id", "content", "created_at", "mentions"],
    "task_attachments": ["id", "task_id", "object_key", "file_url", "file_name", "file_size",
                         "mime_type", "uploaded_by", "uploaded_at"],
    "channels": ["id", "workspace_id", "name", "description", "is_private", "created_by",
                 "created_at", "deleted_at", "linked_resource_type", "linked_resource_id",
                 "linked_label", "linked_subtitle", "channel_kind"],
    "messages": ["id", "channel_id", "dm_conversation_id", "sender_id", "content", "type",
                 "file_url", "created_at", "updated_at", "is_deleted", "mentions", "file_name",
                 "file_size", "file_mime", "duration_ms", "unfurl", "reply_count",
                 "parent_message_id", "edited_at", "metadata", "mention_all"],
    "message_threads": ["parent_message_id", "reply_message_id"],
    "reactions": ["id", "message_id", "user_id", "emoji"],
    "resource_memberships": ["id", "resource_type", "resource_id", "user_id", "access_level",
                             "invited_by", "created_at"],
    "dm_participants": ["conversation_id", "user_id"],
}


class HubRestReader:
    """GET-only PostgREST client for the Hub. Cannot write: no other verb exists."""

    PAGE = 1000

    def __init__(self) -> None:
        self._url, self._key = hub_credentials()
        self.source = "hub"

    def _get(self, table: str, params: List[Tuple[str, str]], offset: int) -> List[dict]:
        if table not in HUB_COLUMNS:
            raise ValueError(f"table {table!r} is not allow-listed for reading")
        query = urllib.parse.urlencode(params + [("limit", str(self.PAGE)), ("offset", str(offset))],
                                       safe=",.()*:")
        path = f"/rest/v1/{table}?{query}"
        assert path.startswith("/rest/v1/") and "/rpc/" not in path
        req = urllib.request.Request(self._url + path, method="GET", headers={
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
        })
        if req.get_method() != "GET":  # belt and braces
            raise RuntimeError("Hub reader refuses anything but GET")
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))

    @staticmethod
    def _filter_params(where: Optional[Dict[str, Any]]) -> List[Tuple[str, str]]:
        params: List[Tuple[str, str]] = []
        for col, cond in (where or {}).items():
            if cond is None:
                params.append((col, "is.null"))
            elif cond == "not_null":
                params.append((col, "not.is.null"))
            elif isinstance(cond, tuple) and cond[0] == "in":
                vals = ",".join(f'"{v}"' for v in cond[1])
                params.append((col, f"in.({vals})"))
            else:
                params.append((col, f"eq.{cond}"))
        return params

    def fetch(self, table: str, where: Optional[Dict[str, Any]] = None) -> List[dict]:
        # `in` filters are chunked so URLs stay short.
        in_cols = [c for c, v in (where or {}).items() if isinstance(v, tuple) and v[0] == "in"]
        if in_cols:
            col = in_cols[0]
            values = sorted(set(where[col][1]))  # type: ignore[index]
            out: List[dict] = []
            for i in range(0, len(values), 60):
                chunk = dict(where or {})
                chunk[col] = ("in", values[i:i + 60])
                out.extend(self._fetch_all(table, chunk))
            return out
        return self._fetch_all(table, where)

    def _fetch_all(self, table: str, where: Optional[Dict[str, Any]]) -> List[dict]:
        cols = HUB_COLUMNS[table]
        order = "id" if "id" in cols else cols[0]
        params = [("select", ",".join(cols)), ("order", f"{order}.asc")] + self._filter_params(where)
        out: List[dict] = []
        offset = 0
        while True:
            page = self._get(table, params, offset)
            out.extend(page)
            if len(page) < self.PAGE:
                return out
            offset += self.PAGE


class FixtureReader:
    """Same interface as HubRestReader, over a JSON dump {table: [rows]} (tests)."""

    def __init__(self, path: Path) -> None:
        self.data: Dict[str, List[dict]] = json.loads(Path(path).read_text())
        self.source = f"fixture:{Path(path).name}"

    def fetch(self, table: str, where: Optional[Dict[str, Any]] = None) -> List[dict]:
        if table not in HUB_COLUMNS:
            raise ValueError(f"table {table!r} is not allow-listed for reading")
        rows = self.data.get(table, [])
        out = []
        for r in rows:
            ok = True
            for col, cond in (where or {}).items():
                v = r.get(col)
                if cond is None:
                    ok = v is None
                elif cond == "not_null":
                    ok = v is not None
                elif isinstance(cond, tuple) and cond[0] == "in":
                    ok = v in set(cond[1])
                else:
                    ok = v == cond
                if not ok:
                    break
            if ok:
                out.append({c: r.get(c) for c in HUB_COLUMNS[table]})
        return out


def make_reader(fixture: Optional[str]):
    return FixtureReader(Path(fixture)) if fixture else HubRestReader()


# --------------------------------------------------------------------- domain helpers
PLACEHOLDER_EMAIL_RE = re.compile(r"@placeholder\.|@example\.|@test\.|@invalid\b|noemail|no-email", re.I)


def email_problem(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip()
    if not e or "@" not in e:
        return "no_real_email"
    if PLACEHOLDER_EMAIL_RE.search(e):
        return "placeholder_email"
    return None


SERVICE_CATEGORY = {
    "Designers": "designer",
    "Editors": "video-editor",
    "Designer plus Editor": "designer-editor",
    "Accountants": "accountant",
    "Ads Specialist": "ads-specialist",
}
TEMPLATE_CATEGORY = {"design-space": "designer", "video-editing-space": "video-editor"}
# A card category reaches these template categories (designer-editor covers both).
CATEGORY_SPACES = {
    "designer": {"designer"},
    "video-editor": {"video-editor"},
    "designer-editor": {"designer", "video-editor"},
}


def card_category(service_type: Optional[str]) -> str:
    if not service_type:
        return "other"
    return SERVICE_CATEGORY.get(service_type) or re.sub(r"[^a-z0-9]+", "-", service_type.lower()).strip("-")


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:40]
    return s or "workspace"


# --------------------------------------------------------------------- content collection
class Content:
    """Every Hub row that one target workspace will receive."""

    def __init__(self) -> None:
        self.spaces: List[dict] = []      # {saas_id, name, source_type, source_id, status_space_id, row, category}
        self.folders: List[dict] = []     # hub row + _space (saas id), _parent (hub folder id|None)
        self.lists: List[dict] = []       # hub row + _space, _folder (hub folder id|None)
        self.tasks: List[dict] = []
        self.comments: List[dict] = []
        self.attachments: List[dict] = []
        self.channels: List[dict] = []    # hub row + _link (type, saas id) | None
        self.messages: List[dict] = []
        self.threads: List[dict] = []
        self.reactions: List[dict] = []
        self.memberships: List[dict] = [] # hub row + _rtype, _rid (saas ids)
        self.statuses: Dict[str, List[dict]] = {}  # saas space id -> hub status rows
        self.skipped: Dict[str, int] = {}

    def skip(self, why: str, n: int = 1) -> None:
        self.skipped[why] = self.skipped.get(why, 0) + n

    def counts(self) -> Dict[str, int]:
        return {
            "spaces": len(self.spaces), "folders": len(self.folders), "lists": len(self.lists),
            "tasks": len(self.tasks), "comments": len(self.comments),
            "attachments": len(self.attachments), "channels": len(self.channels),
            "messages": len(self.messages),
            "message_attachments": sum(1 for m in self.messages if m.get("file_url")),
            "reactions": len(self.reactions), "memberships": len(self.memberships),
        }

    def user_ids(self) -> Dict[str, set]:
        """Hub user ids referenced by the content, keyed by how they're referenced."""
        refs: Dict[str, set] = {"required": set(), "optional": set()}
        for r in self.spaces:
            refs["optional"].add(r["row"].get("created_by"))
        for r in self.folders + self.lists:
            refs["optional"].add(r.get("created_by"))
        for t in self.tasks:
            refs["optional"].update([t.get("created_by"), t.get("last_modified_by")])
            refs["optional"].update(t.get("assignee_ids") or [])
        for c in self.comments:
            refs["required"].add(c.get("user_id"))
            refs["optional"].update(c.get("mentions") or [])
        for a in self.attachments:
            refs["required"].add(a.get("uploaded_by"))
        for ch in self.channels:
            refs["optional"].add(ch.get("created_by"))
        for m in self.messages:
            refs["required"].add(m.get("sender_id"))
            refs["optional"].update(m.get("mentions") or [])
        for r in self.reactions:
            refs["required"].add(r.get("user_id"))
        for r in self.memberships:
            refs["required"].add(r.get("user_id"))
            refs["optional"].add(r.get("invited_by"))
        for k in refs:
            refs[k].discard(None)
        refs["optional"] -= refs["required"]
        return refs


class HubIndex:
    """Structural Hub tables loaded once (small), plus lazy content fetches."""

    def __init__(self, reader) -> None:
        self.reader = reader
        self.spaces = {r["id"]: r for r in reader.fetch("spaces")}
        self.folders = {r["id"]: r for r in reader.fetch("folders")}
        self.lists = {r["id"]: r for r in reader.fetch("lists")}
        self.channels = {r["id"]: r for r in reader.fetch("channels")}
        self.templates = {r["id"]: r for r in reader.fetch("client_space_templates")}
        self.children: Dict[str, List[str]] = {}
        for f in self.folders.values():
            if f.get("parent_folder_id"):
                self.children.setdefault(f["parent_folder_id"], []).append(f["id"])

    def folder_subtree(self, root: str, exclude: Iterable[str] = ()) -> List[str]:
        """Live descendants of `root` (not including it), parents before children."""
        excl = set(exclude)
        out: List[str] = []
        stack = list(self.children.get(root, []))
        while stack:
            fid = stack.pop(0)
            f = self.folders.get(fid)
            if fid in excl or not f or f.get("deleted_at"):
                continue
            out.append(fid)
            stack.extend(self.children.get(fid, []))
        return out


def space_saas_id(source_type: str, source_id: str) -> str:
    return det_id("space", source_type, source_id)


def collect_content(idx: HubIndex, specs: List[dict]) -> Content:
    """Resolve content specs into concrete Hub rows.

    spec = {source_type: 'folder'|'space', source_id, name, category?, exclude_folder_ids?}
    A folder source becomes a SaaS SPACE; its live descendant folders become
    SaaS folders; lists directly in it become space-level lists.
    """
    c = Content()
    reader = idx.reader
    folder_target: Dict[str, Tuple[str, Optional[str]]] = {}   # hub folder -> (saas space, hub parent|None)
    space_root_folder: Dict[str, str] = {}                     # hub folder used as a space -> saas space id
    list_ids: List[str] = []
    for spec in specs:
        sid = space_saas_id(spec["source_type"], spec["source_id"])
        if spec["source_type"] == "folder":
            root = idx.folders.get(spec["source_id"])
            if not root or root.get("deleted_at"):
                c.skip("source_folder_missing_or_deleted")
                continue
            status_space = root["space_id"]
            row = root
            space_root_folder[root["id"]] = sid
            sub = idx.folder_subtree(root["id"], spec.get("exclude_folder_ids") or [])
            for fid in sub:
                f = idx.folders[fid]
                parent = f.get("parent_folder_id")
                folder_target[fid] = (sid, None if parent == root["id"] else parent)
            container_folders = {root["id"], *sub}
            for l in idx.lists.values():
                if l.get("folder_id") in container_folders:
                    if l.get("deleted_at"):
                        c.skip("deleted_lists")
                        continue
                    c.lists.append(dict(l, _space=sid, _folder=None if l["folder_id"] == root["id"] else l["folder_id"]))
                    list_ids.append(l["id"])
        else:
            sp = idx.spaces.get(spec["source_id"])
            if not sp or sp.get("deleted_at"):
                c.skip("source_space_missing_or_deleted")
                continue
            status_space = sp["id"]
            row = sp
            tops = [f for f in idx.folders.values() if f["space_id"] == sp["id"] and not f.get("parent_folder_id")]
            live = []
            for f in tops:
                if f.get("deleted_at"):
                    continue
                live.append(f["id"])
                live.extend(idx.folder_subtree(f["id"]))
            for fid in live:
                folder_target[fid] = (sid, idx.folders[fid].get("parent_folder_id"))
            for l in idx.lists.values():
                if l.get("space_id") != sp["id"] or l.get("deleted_at"):
                    continue
                if l.get("folder_id") and l["folder_id"] not in folder_target:
                    c.skip("lists_in_deleted_folders")
                    continue
                c.lists.append(dict(l, _space=sid, _folder=l.get("folder_id")))
                list_ids.append(l["id"])
        c.spaces.append({"saas_id": sid, "name": spec["name"], "source_type": spec["source_type"],
                         "source_id": spec["source_id"], "category": spec.get("category"),
                         "status_space_id": status_space, "row": row})
    for fid, (sid, parent) in folder_target.items():
        c.folders.append(dict(idx.folders[fid], _space=sid, _parent=parent))

    # statuses of each source space (the Hub's per-space status catalog)
    status_space_ids = sorted({s["status_space_id"] for s in c.spaces})
    if status_space_ids:
        rows = reader.fetch("space_statuses", {"space_id": ("in", status_space_ids)})
        by_space: Dict[str, List[dict]] = {}
        for r in rows:
            by_space.setdefault(r["space_id"], []).append(r)
        for s in c.spaces:
            c.statuses[s["saas_id"]] = by_space.get(s["status_space_id"], [])

    # tasks and their children
    if list_ids:
        c.tasks = reader.fetch("tasks", {"list_id": ("in", list_ids)})
    task_ids = [t["id"] for t in c.tasks]
    if task_ids:
        c.comments = reader.fetch("task_comments", {"task_id": ("in", task_ids)})
        c.attachments = reader.fetch("task_attachments", {"task_id": ("in", task_ids)})

    # channels linked to anything copied
    folder_ids = set(folder_target)
    list_set = set(list_ids)
    for ch in idx.channels.values():
        lt, lid = ch.get("linked_resource_type"), ch.get("linked_resource_id")
        link = None
        if lt == "folder" and lid in space_root_folder:
            link = ("space", space_root_folder[lid])
        elif lt == "folder" and lid in folder_ids:
            link = ("folder", det_id("folder", lid))
        elif lt == "list" and lid in list_set:
            link = ("list", det_id("list", lid))
        elif lt == "space" and any(s["source_type"] == "space" and s["source_id"] == lid for s in c.spaces):
            link = ("space", space_saas_id("space", lid))
        if link is None:
            continue
        if ch.get("deleted_at"):
            c.skip("deleted_linked_channels")
            continue
        c.channels.append(dict(ch, _link=link))
    channel_ids = [ch["id"] for ch in c.channels]
    if channel_ids:
        c.messages = reader.fetch("messages", {"channel_id": ("in", channel_ids)})
    msg_ids = [m["id"] for m in c.messages]
    if msg_ids:
        c.reactions = reader.fetch("reactions", {"message_id": ("in", msg_ids)})
        mset = set(msg_ids)
        c.threads = [t for t in reader.fetch("message_threads", {"parent_message_id": ("in", msg_ids)})
                     if t["reply_message_id"] in mset]

    # memberships on every copied container (folder-as-space -> space membership)
    res: Dict[Tuple[str, str], Tuple[str, str]] = {}
    for hub_fid, sid in space_root_folder.items():
        res[("folder", hub_fid)] = ("space", sid)
    for s in c.spaces:
        if s["source_type"] == "space":
            res[("space", s["source_id"])] = ("space", s["saas_id"])
    for fid in folder_ids:
        res[("folder", fid)] = ("folder", det_id("folder", fid))
    for lid in list_ids:
        res[("list", lid)] = ("list", det_id("list", lid))
    for chid in channel_ids:
        res[("channel", chid)] = ("channel", det_id("channel", chid))
    if res:
        ids = sorted({rid for (_, rid) in res})
        for m in reader.fetch("resource_memberships", {"resource_id": ("in", ids)}):
            tgt = res.get((m["resource_type"], m["resource_id"]))
            if tgt:
                c.memberships.append(dict(m, _rtype=tgt[0], _rid=tgt[1]))
    return c
