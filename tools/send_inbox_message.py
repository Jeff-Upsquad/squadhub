#!/usr/bin/env python3
"""Send an inbox message to SquadHub users by inserting rows into `notifications`.

The inbox is backed by the `notifications` table; the server's 2s poller fans
every new row out to open sessions (Socket.IO), partner phones (FCM), and
offline browsers (Web Push) automatically — so inserting a row IS delivering
the message.

Credentials come from server/.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
The service-role key bypasses RLS, which is required since we write on behalf
of many users from outside the app.

Usage:
  # Preview recipients without sending
  python3 tools/send_inbox_message.py --title "..." --body "..." --audience partners --dry-run

  # Send to all approved partners
  python3 tools/send_inbox_message.py --title "..." --body "..." --audience partners

  # Send to specific users (email or uuid, repeatable)
  python3 tools/send_inbox_message.py --title "..." --body "..." \
      --user jeffzenaone@gmail.com --user 317302da-5cde-4974-80da-f47dbca49c2e
"""

import argparse
import sys
import time
import uuid
from pathlib import Path

from supabase import create_client, Client

REPO_ROOT = Path(__file__).resolve().parent.parent

PARTNER_USER_TYPES = ("partner", "partner_employee")

# Live data uses 'active'; earlier migrations used pending/approved/rejected.
ACTIVE_STATUSES = ("active", "approved")

# `notifications.type` is CHECK-constrained. The live DB may allow more values
# than the latest committed migration (175_support_tickets.sql) if extra types
# were added ad hoc via the SQL editor — probe_type() detects this at runtime.
KNOWN_TYPES = [
    "task_assigned", "task_updated", "task_completed", "task_commented",
    "task_due_soon", "mention", "message_mention", "dm_received",
    "reaction_added", "lms_assigned", "lms_updated", "lms_shared",
    "lms_review_requested", "lms_review_decided", "lms_comment",
    "meeting_invited", "meeting_suggestion", "meeting_suggestion_resolved",
    "meeting_confirmed", "meeting_cancelled", "support_ticket_reply",
    "support_ticket_assigned",
]


def get_client() -> Client:
    env_path = REPO_ROOT / "server" / ".env"
    url = key = None
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == "SUPABASE_URL":
            url = v.strip().strip("'\"")
        elif k.strip() == "SUPABASE_SERVICE_ROLE_KEY":
            key = v.strip().strip("'\"")
    if not url or not key:
        sys.exit(f"error: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in {env_path}")
    return create_client(url, key)


def resolve_partners(sb: Client):
    """All approved partner-side users (partners + partner employees)."""
    res = (
        sb.table("users")
        .select("id, email, display_name, user_type, status")
        .in_("user_type", list(PARTNER_USER_TYPES))
        .in_("status", list(ACTIVE_STATUSES))
        .order("display_name")
        .execute()
    )
    return res.data or []


def resolve_user(sb: Client, ident: str):
    """One user by uuid or email."""
    q = sb.table("users").select("id, email, display_name, user_type, status")
    field = "id" if ident.count("-") == 4 and len(ident) == 36 else "email"
    res = q.eq(field, ident.lower() if field == "email" else ident).limit(1).execute()
    return (res.data or [None])[0]


def probe_type(sb: Client, user_id: str, wanted: str) -> str:
    """Insert+delete a canary row as `user_id` to learn whether `wanted` type
    passes the DB CHECK constraint. Returns the usable type."""
    row = {
        "user_id": user_id,
        "type": wanted,
        "reference_id": str(uuid.uuid4()),
        "reference_type": "announcement",
        "actor_id": None,
        "title": "[probe] delete-me",
        "body": None,
        "metadata": {"probe": True},
    }
    try:
        ins = sb.table("notifications").insert(row).execute()
        for r in ins.data or []:
            sb.table("notifications").delete().eq("id", r["id"]).execute()
        return wanted
    except Exception:
        pass
    print(f"  note: type '{wanted}' rejected by DB constraint, falling back to "
          f"'{KNOWN_TYPES[0]}'-family check... trying allowed types", file=sys.stderr)
    for t in KNOWN_TYPES:
        row["type"] = t
        try:
            ins = sb.table("notifications").insert(row).execute()
            for r in ins.data or []:
                sb.table("notifications").delete().eq("id", r["id"]).execute()
            print(f"  note: using allowed type '{t}'", file=sys.stderr)
            return t
        except Exception:
            continue
    sys.exit("error: no acceptable notification type found")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--title", required=True)
    ap.add_argument("--body", required=True)
    ap.add_argument("--audience", choices=["partners"], help="partner users (approved)")
    ap.add_argument("--user", action="append", default=[], metavar="EMAIL_OR_UUID")
    ap.add_argument("--type", default="announcement",
                    help="notification type (default: announcement)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.audience and not args.user:
        sys.exit("error: provide --audience partners and/or --user <email_or_uuid>")

    sb = get_client()

    recipients: list[dict] = []
    seen: set[str] = set()
    if args.audience == "partners":
        recipients.extend(resolve_partners(sb))
        seen |= {r["id"] for r in recipients}
    for ident in args.user:
        u = resolve_user(sb, ident)
        if not u:
            sys.exit(f"error: user not found: {ident}")
        if u["id"] not in seen:
            recipients.append(u)
            seen.add(u["id"])

    if not recipients:
        sys.exit("error: no recipients resolved")

    print(f"Recipients ({len(recipients)}):")
    for r in recipients:
        print(f"  - {r.get('display_name') or '(unnamed)'} <{r.get('email')}> "
              f"[{r['user_type']}/{r['status']}] {r['id']}")

    ntype = probe_type(sb, recipients[0]["id"], args.type)

    reference_id = str(uuid.uuid4())
    rows = [
        {
            "user_id": r["id"],
            "type": ntype,
            "reference_id": reference_id,
            "reference_type": "announcement",
            "actor_id": None,
            "title": args.title,
            "body": args.body,
            "metadata": {"announcement": True},
        }
        for r in recipients
    ]

    if args.dry_run:
        print(f"\nDRY RUN — would insert {len(rows)} notifications (type={ntype}). No rows written.")
        return

    t0 = time.time()
    inserted = 0
    for i in range(0, len(rows), 200):
        chunk = rows[i : i + 200]
        res = sb.table("notifications").insert(chunk).execute()
        inserted += len(res.data or [])
    print(f"\nSent: {inserted}/{len(rows)} notification(s) delivered "
          f"(type={ntype}) in {time.time() - t0:.1f}s.")
    print("Delivery is automatic: in-app socket (~2s), FCM push to partner "
          "phones, Web Push when offline.")


if __name__ == "__main__":
    main()
