"""Synthetic Hub fixture for the local copy test. NO production data.

    python3 -m tools.migrate_from_hub.tests.make_fixture OUT.json
"""
import json
import sys
import uuid

NS = uuid.UUID("0d5c2b0e-1111-4c4c-8888-000000000001")


def i(name: str) -> str:
    return str(uuid.uuid5(NS, name))


T0 = "2026-09-01T10:00:00+00:00"


def user(name, email, utype, status="active"):
    return {"id": i("u:" + name), "email": email, "display_name": name.title(), "avatar_url": None,
            "created_at": T0, "status": status, "user_type": utype, "is_admin": utype == "internal", "phone": None}


def build() -> dict:
    users = [
        user("amy", "amy@upsquad.example.org", "internal"),          # account manager
        user("ivan", "ivan@upsquad.example.org", "internal"),        # internal author only
        user("olga", "olga@acme.example.org", "client"),             # C1 owner
        user("sam", "sam@acme.example.org", "client_staff"),         # C1 staff
        user("tom", "tom@talent.example.org", "partner"),            # talent on active card
        user("tia", "tia@talent.example.org", "partner", "suspended"),
        user("eve", "eve@agency.example.org", "partner_employee"),
        user("bob", "bob@beta.example.org", "client"),               # C2 owner (no live card)
        user("pat", "pat@both.example.org", "partner"),              # partner with client access
        user("xena", "xena@placeholder.crm", "client"),              # placeholder email
    ]
    U = {u["display_name"].lower(): u["id"] for u in users}
    clients = [
        {"id": i("c1"), "submission_id": None, "business_name": "Acme", "contact_person": "Olga",
         "email": "olga@acme.example.org", "status": "active", "squadhire_business_user_id": "shb-1", "created_at": T0},
        {"id": i("c2"), "submission_id": None, "business_name": "Beta", "contact_person": "Bob",
         "email": "bob@beta.example.org", "status": "active", "squadhire_business_user_id": None, "created_at": T0},
        {"id": i("c3"), "submission_id": None, "business_name": "Gamma", "contact_person": None,
         "email": None, "status": "active", "squadhire_business_user_id": None, "created_at": T0},
        {"id": i("c4"), "submission_id": None, "business_name": "Delta", "contact_person": None,
         "email": "delta@placeholder.crm", "status": "active", "squadhire_business_user_id": None, "created_at": T0},
    ]
    access = [
        {"id": i("a1"), "client_id": i("c1"), "user_id": U["olga"], "created_at": T0},
        {"id": i("a2"), "client_id": i("c1"), "user_id": U["sam"], "created_at": "2026-09-02T00:00:00+00:00"},
        {"id": i("a3"), "client_id": i("c2"), "user_id": U["bob"], "created_at": T0},
        {"id": i("a4"), "client_id": i("c2"), "user_id": U["pat"], "created_at": "2026-09-03T00:00:00+00:00"},
        {"id": i("a5"), "client_id": i("c2"), "user_id": U["xena"], "created_at": "2026-09-04T00:00:00+00:00"},
    ]
    templates = [{"id": i("tpl:design"), "slug": "design-space", "name": "Design Space"},
                 {"id": i("tpl:video"), "slug": "video-editing-space", "name": "Video Editing Space"}]
    hs, pers = i("space:host"), i("space:tom-personal")
    spaces = [
        {"id": hs, "workspace_id": i("ws"), "name": "Client Spaces", "color": "#7c3aed", "icon": "users",
         "is_private": True, "created_by": U["amy"], "position": 0, "description": None, "deleted_at": None,
         "status": "active", "is_locked": False, "client_id": None, "kind": "workspace", "group_tasks": False,
         "auto_assignee_ids": [], "default_task_type_id": None},
        {"id": pers, "workspace_id": i("ws"), "name": "Tom's space", "color": "#111111", "icon": "user",
         "is_private": True, "created_by": U["tom"], "position": 1, "description": "personal", "deleted_at": None,
         "status": "active", "is_locked": False, "client_id": None, "kind": "personal", "group_tasks": False,
         "auto_assignee_ids": [], "default_task_type_id": None},
    ]

    def folder(key, name, space, client=None, ftype="folder", parent=None, tpl=None, deleted=None):
        return {"id": i(key), "space_id": space, "name": name, "is_private": True, "created_by": U["amy"],
                "position": 0, "deleted_at": deleted, "status": "active", "is_locked": False, "client_id": client,
                "client_space_template_id": tpl, "subscription_card_id": None, "folder_type": ftype,
                "parent_folder_id": parent, "group_tasks": False, "auto_assignee_ids": [U["amy"]],
                "default_task_type_id": i("tt:task")}
    folders = [
        folder("f:r1", "Acme", hs, i("c1"), "client"),
        folder("f:d1", "Design Space", hs, i("c1"), parent=i("f:r1"), tpl=i("tpl:design")),
        folder("f:v1", "Video Editing Space", hs, i("c1"), parent=i("f:r1"), tpl=i("tpl:video")),
        folder("f:d1-sub", "Briefs", hs, i("c1"), parent=i("f:d1")),
        folder("f:r1-old", "Old stuff", hs, i("c1"), parent=i("f:r1"), deleted="2026-09-10T00:00:00+00:00"),
        folder("f:r2", "Beta", hs, i("c2"), "client"),
        folder("f:orphan", "Ghost Co", hs, i("c-missing"), "client"),
    ]

    def lst(key, name, folder_key=None, space=hs, deleted=None):
        return {"id": i(key), "folder_id": i(folder_key) if folder_key else None, "space_id": space, "name": name,
                "is_private": True, "created_by": U["amy"], "position": 0, "deleted_at": deleted, "status": "active",
                "is_locked": False, "group_tasks": False, "auto_assignee_ids": [], "default_task_type_id": None}
    lists = [
        lst("l:r1-general", "General", "f:r1"), lst("l:d1-tasks", "Design Tasks", "f:d1"),
        lst("l:d1-briefs", "Brief list", "f:d1-sub"), lst("l:v1-tasks", "Video Tasks", "f:v1"),
        lst("l:d1-deleted", "Deleted list", "f:d1", deleted="2026-09-11T00:00:00+00:00"),
        lst("l:r2", "Beta work", "f:r2"), lst("l:pers", "My list", None, pers),
    ]

    def task(key, list_key, title, status="To Do", parent=None, by="olga", assignees=("tom",)):
        return {"id": i(key), "list_id": i(list_key), "title": title, "description": "synthetic", "status": status,
                "priority": "none", "assignee_ids": [U[a] for a in assignees], "due_date": None,
                "created_by": U[by], "created_at": T0, "time_estimate": 60, "time_tracked": 30,
                "metadata": {"k": "v"}, "display_number": 1, "task_type_id": i("tt:task"), "work_date": None,
                "start_date": None, "parent_task_id": i(parent) if parent else None, "last_modified_by": U["amy"],
                "recurrence": None, "recurrence_paused": False, "recurring_parent_id": None,
                "recurrence_instance_date": None, "created_via": "web"}
    tasks = [
        task("t:sub", "l:d1-tasks", "Subtask first in list", parent="t:main"),   # child listed before parent
        task("t:main", "l:d1-tasks", "Logo design", "In Progress"),
        task("t:review", "l:d1-briefs", "Brief review", "Client Review", by="ivan"),
        task("t:gen", "l:r1-general", "Kickoff", "Done", by="amy", assignees=("olga", "sam")),
        task("t:video", "l:v1-tasks", "Promo video", assignees=()),
        task("t:deleted-list", "l:d1-deleted", "Should not copy"),
        task("t:beta", "l:r2", "Beta task", by="bob", assignees=("bob", "pat")),
        task("t:pers", "l:pers", "Personal todo", by="tom", assignees=("tom",)),
    ]
    comments = [
        {"id": i("cm1"), "task_id": i("t:main"), "user_id": U["olga"], "content": "Looks good", "created_at": T0,
         "mentions": [U["tom"]]},
        {"id": i("cm2"), "task_id": i("t:main"), "user_id": i("u:deleted-person"), "content": "orphan author",
         "created_at": T0, "mentions": []},
    ]
    attachments = [
        {"id": i("at1"), "task_id": i("t:main"), "object_key": "tasks/x/logo.png",
         "file_url": "https://files.example.org/tasks/x/logo.png", "file_name": "logo.png", "file_size": 1234,
         "mime_type": "image/png", "uploaded_by": U["tom"], "uploaded_at": T0},
    ]

    def chan(key, name, ltype, lid, deleted=None):
        return {"id": i(key), "workspace_id": i("ws"), "name": name, "description": None, "is_private": True,
                "created_by": U["amy"], "created_at": T0, "deleted_at": deleted, "linked_resource_type": ltype,
                "linked_resource_id": lid, "linked_label": None, "linked_subtitle": None, "channel_kind": "standard"}
    channels = [
        chan("ch:d1", "acme-design", "folder", i("f:d1")),
        chan("ch:r1", "acme-general", "folder", i("f:r1")),
        chan("ch:list", "acme-brief-list", "list", i("l:d1-briefs")),
        chan("ch:crm", "deal-acme", "crm_deal", i("deal-1")),
        chan("ch:gone", "gone", "folder", i("f:r1-old")),
    ]

    def msg(key, ch, sender, content, parent=None, file_url=None):
        return {"id": i(key), "channel_id": i(ch), "dm_conversation_id": None, "sender_id": sender,
                "content": content, "type": "file" if file_url else "text", "file_url": file_url,
                "created_at": T0, "updated_at": T0, "is_deleted": False, "mentions": [], "file_name": None,
                "file_size": None, "file_mime": None, "duration_ms": None, "unfurl": None,
                "reply_count": 1 if key == "m1" else 0, "parent_message_id": i(parent) if parent else None,
                "edited_at": None, "metadata": None, "mention_all": False}
    messages = [
        msg("m2", "ch:d1", U["tom"], "reply in thread", parent="m1"),
        msg("m1", "ch:d1", U["olga"], "Hi Tom"),
        msg("m3", "ch:d1", U["amy"], "file", file_url="https://files.example.org/chat/a.pdf"),
        msg("m4", "ch:d1", i("u:deleted-person"), "ghost"),
        msg("m5", "ch:r1", U["ivan"], "internal note"),
        msg("m6", "ch:crm", U["amy"], "crm only — never copied"),
    ]
    threads = [{"parent_message_id": i("m1"), "reply_message_id": i("m2")}]
    reactions = [{"id": i("r1"), "message_id": i("m1"), "user_id": U["tom"], "emoji": "👍"}]

    def rm(rtype, rkey, who, level="member"):
        return {"id": i(f"rm:{rtype}:{rkey}:{who}"), "resource_type": rtype, "resource_id": i(rkey),
                "user_id": U[who], "access_level": level, "invited_by": U["amy"], "created_at": T0}
    memberships = [
        rm("folder", "f:r1", "olga"), rm("folder", "f:d1", "olga"), rm("folder", "f:d1", "tom"),
        rm("channel", "ch:d1", "tom"), rm("channel", "ch:d1", "amy", "manager"), rm("folder", "f:r1", "ivan"),
        rm("folder", "f:r2", "bob"), rm("space", "space:tom-personal", "tom", "manager"),
    ]
    statuses = [{"id": i(f"ss:{n}"), "space_id": hs, "name": n, "color": "#123456", "position": p,
                 "is_default": p == 0, "category": c}
                for p, (n, c) in enumerate([("To Do", "todo"), ("In Progress", "active"), ("Done", "done")])]
    cards = [
        {"id": i("k1"), "state": "assigned", "card_type": "subscription", "service_type": "Designers",
         "brand_name": "Acme", "customer_name": "Olga", "customer_company": "Acme",
         "customer_email": "olga@acme.example.org", "submission_subscription_id": None, "client_id": None,
         "linked_folder_id": i("f:d1"), "selected_recipient_type": "talent", "selected_recipient_id": "sh-t1",
         "selected_talent_user_id": None, "assignee_id": U["amy"], "collaborator_ids": [], "assigned_at": T0,
         "paused_at": None, "cancelled_at": None, "archived_at": None, "deleted_at": None, "card_code": "K1"},
        {"id": i("k0"), "state": "closed", "card_type": "subscription", "service_type": "Editors",
         "brand_name": "Beta", "customer_name": "Bob", "customer_company": "Beta",
         "customer_email": "bob@beta.example.org", "submission_subscription_id": None, "client_id": i("c2"),
         "linked_folder_id": None, "selected_recipient_type": "talent", "selected_recipient_id": "sh-t2",
         "selected_talent_user_id": None, "assignee_id": U["amy"], "collaborator_ids": [], "assigned_at": T0,
         "paused_at": None, "cancelled_at": None, "archived_at": None, "deleted_at": None, "card_code": "K0"},
        {"id": i("k4"), "state": "assigned", "card_type": "subscription", "service_type": "Editors",
         "brand_name": "Delta", "customer_name": None, "customer_company": "Delta",
         "customer_email": "delta@placeholder.crm", "submission_subscription_id": None, "client_id": i("c4"),
         "linked_folder_id": None, "selected_recipient_type": "talent", "selected_recipient_id": "sh-t1",
         "selected_talent_user_id": None, "assignee_id": None, "collaborator_ids": [], "assigned_at": T0,
         "paused_at": None, "cancelled_at": None, "archived_at": None, "deleted_at": None, "card_code": "K4"},
    ]
    terms = [
        {"id": i("term1"), "card_id": i("k1"), "recipient_type": "talent", "recipient_id": "sh-t1",
         "status": "active", "assigned_date": T0, "unassigned_date": None},
        {"id": i("term0"), "card_id": i("k0"), "recipient_type": "talent", "recipient_id": "sh-t2",
         "status": "ended", "assigned_date": T0, "unassigned_date": "2026-09-20T00:00:00+00:00"},
        {"id": i("term4"), "card_id": i("k4"), "recipient_type": "talent", "recipient_id": "sh-t1",
         "status": "active", "assigned_date": T0, "unassigned_date": None},
    ]
    recipients = [
        {"card_id": i("k1"), "external_user_id": "sh-t1", "email": "tom@talent.example.org", "selected_at": T0, "archived_at": None},
        {"card_id": i("k4"), "external_user_id": "sh-t1", "email": "tom@talent.example.org", "selected_at": T0, "archived_at": None},
        {"card_id": i("k0"), "external_user_id": "sh-t2", "email": "tia@talent.example.org", "selected_at": T0, "archived_at": None},
    ]
    return {
        "users": users, "clients": clients, "client_user_access": access, "partner_client_assignments": [],
        "client_submissions": [], "client_submission_subscriptions": [], "client_space_templates": templates,
        "subscription_cards": cards, "subscription_assignment_terms": terms,
        "subscription_card_external_recipients": recipients, "spaces": spaces, "folders": folders,
        "lists": lists, "space_statuses": statuses,
        "task_types": [{"id": i("tt:task"), "key": "task"}, {"id": i("tt:gone"), "key": "no_such_type"}],
        "tasks": tasks, "task_comments": comments, "task_attachments": attachments, "channels": channels,
        "messages": messages, "message_threads": threads, "reactions": reactions,
        "resource_memberships": memberships,
        "dm_participants": [{"conversation_id": i("dm1"), "user_id": U["olga"]},
                            {"conversation_id": i("dm1"), "user_id": U["amy"]}],
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "fixture_hub.json"
    with open(out, "w") as fh:
        json.dump(build(), fh, indent=1, ensure_ascii=False)
    print(out)
