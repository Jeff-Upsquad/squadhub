"""Hub -> SaaS migration tooling (see workflows/migrate_from_hub.md).

Run every step as a module from the repo root, e.g.
    python3 -m tools.migrate_from_hub.plan
never as `python3 tools/migrate_from_hub/copy.py` (a file named copy.py on
sys.path[0] would shadow the standard library's `copy` module).
"""
