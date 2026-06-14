#!/usr/bin/env python3
"""
Migrate the admin panel's hardcoded neutral color classes to the semantic
theme tokens defined in admin/src/styles/globals.css, so the whole admin app
responds to light/dark mode.

This is a deterministic, prefix-aware find/replace:
  - The SAME hex can map to DIFFERENT tokens depending on the utility prefix
    (e.g. text-[#0F172B] -> text-foreground, but bg-[#0F172B] -> bg-ink).
  - Tailwind variant prefixes (hover:, focus:, group-hover:, md:, …) and
    opacity modifiers (/80) are preserved because we only match the color atom.
  - Semantic accent/status colors (red/green/amber/violet, etc.) are left alone;
    only the neutral shell + the royal-blue accent are migrated.

Usage:
  python3 tools/apply_admin_dark_mode.py --dry-run    # report only
  python3 tools/apply_admin_dark_mode.py              # apply in place
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter

SRC_ROOT = os.path.join(os.path.dirname(__file__), "..", "admin", "src")

# ── Hex buckets ──────────────────────────────────────────────────────────────
# Each bucket lists the hexes it contains and the token to use per property.
# Properties not listed for a bucket are left untouched (e.g. light near-white
# hexes used as *text* are kept literal so they stay light on dark fills).
PROP_ALL = ["bg", "text", "border", "ring", "divide", "outline",
            "placeholder", "fill", "stroke", "from", "to", "via",
            "decoration", "caret", "ring-offset"]

BUCKETS = [
    # primary text / near-black solid fills
    {
        "hexes": ["0F172B", "0A0A0A", "222222", "222"],
        "props": {
            "text": "foreground", "fill": "foreground", "stroke": "foreground",
            "decoration": "foreground", "caret": "foreground",
            "placeholder": "foreground",
            "bg": "ink", "border": "ink", "ring": "ink",
            "from": "ink", "to": "ink", "via": "ink",
        },
    },
    # gray-800 / dark hover fills
    {
        "hexes": ["1D293D", "1E293B", "3A3A3A"],
        "props": {
            "text": "foreground", "fill": "foreground", "stroke": "foreground",
            "bg": "ink-hover", "border": "ink-hover", "ring": "ink-hover",
            "from": "ink-hover", "to": "ink-hover", "via": "ink-hover",
        },
    },
    # muted text (slate 500/600)
    {
        "hexes": ["62748E", "64748B", "475569", "5C5C5C", "7A7568", "9C9486", "45556C"],
        "props": {
            "text": "foreground-muted", "fill": "foreground-muted",
            "stroke": "foreground-muted", "placeholder": "foreground-muted",
            "decoration": "foreground-muted",
            "bg": "foreground-muted",
            "border": "divider-strong", "ring": "divider-strong",
        },
    },
    # dim text / placeholders (slate 400)
    {
        "hexes": ["90A1B9", "94A3B8", "999999", "A3A3A3", "737373"],
        "props": {
            "text": "foreground-dim", "fill": "foreground-dim",
            "stroke": "foreground-dim", "placeholder": "foreground-dim",
            "bg": "well",
            "border": "divider-strong", "ring": "divider-strong",
        },
    },
    # default hairline divider / light border (slate 200)
    {
        "hexes": ["E2E8F0"],
        "props": {
            "border": "divider", "ring": "divider", "divide": "divider",
            "outline": "divider", "from": "divider", "to": "divider", "via": "divider",
            "bg": "well",
            "text": "foreground-dim",
        },
    },
    # stronger divider / input border (slate 300)
    {
        "hexes": ["CAD5E2", "CBD5E1"],
        "props": {
            "border": "divider-strong", "ring": "divider-strong",
            "divide": "divider-strong", "outline": "divider-strong",
            "bg": "well",
            "text": "foreground-dim",
        },
    },
    # subtle raised surface / hover (slate 50)  — text left literal (near-white)
    {
        "hexes": ["F8FAFC", "FAFBFC"],
        "props": {
            "bg": "surface-alt", "border": "divider", "ring": "divider",
        },
    },
    # canvas (slate 100) — text left literal
    {
        "hexes": ["F1F5F9"],
        "props": {
            "bg": "canvas", "border": "divider", "ring": "divider",
        },
    },
    # warm border used by neo-brutalist module
    {
        "hexes": ["E8E5DD", "E8E5DE"],
        "props": {"border": "sh-warm-border", "bg": "sh-warm-border"},
    },
    # royal-blue accent
    {
        "hexes": ["2962FF"],
        "props": {p: "accent" for p in PROP_ALL},
    },
    # accent hover / pressed variants
    {
        "hexes": ["1E50D8", "1E4BD8", "1E4FCC", "1447E6", "1D4ED8", "1E40AF", "1E4FD8"],
        "props": {p: "accent-strong" for p in PROP_ALL},
    },
]

# ── Named Tailwind palette neutrals ──────────────────────────────────────────
# (token, [class -> replacement]) — bounded so bg-gray-50 never eats bg-gray-500.
NAMED = {
    "bg-white": "bg-surface",
    "bg-gray-50": "bg-surface-alt",
    "bg-gray-100": "bg-canvas",
    "bg-gray-200": "bg-well",
    "bg-slate-50": "bg-surface-alt",
    "bg-slate-100": "bg-canvas",
    "bg-slate-200": "bg-well",
    "text-gray-900": "text-foreground",
    "text-gray-800": "text-foreground",
    "text-gray-700": "text-foreground-muted",
    "text-gray-600": "text-foreground-muted",
    "text-gray-500": "text-foreground-muted",
    "text-gray-400": "text-foreground-dim",
    "text-slate-900": "text-foreground",
    "text-slate-800": "text-foreground",
    "text-slate-700": "text-foreground-muted",
    "text-slate-600": "text-foreground-muted",
    "text-slate-500": "text-foreground-muted",
    "text-slate-400": "text-foreground-dim",
    "border-gray-100": "border-divider",
    "border-gray-200": "border-divider",
    "border-gray-300": "border-divider-strong",
    "border-slate-100": "border-divider",
    "border-slate-200": "border-divider",
    "border-slate-300": "border-divider-strong",
    "divide-gray-200": "divide-divider",
    "divide-slate-200": "divide-divider",
}
# text-white / bg-black are intentionally NOT migrated (stay literal).


def build_hex_rules() -> list[tuple[re.Pattern, str]]:
    rules: list[tuple[re.Pattern, str]] = []
    for bucket in BUCKETS:
        for hexv in bucket["hexes"]:
            for prop, token in bucket["props"].items():
                # left: not preceded by word char or dash (allows `:`, space, quote)
                # right: the literal closing bracket; opacity /xx is left intact
                pat = re.compile(rf"(?<![\w-]){re.escape(prop)}-\[#{hexv}\]",
                                 re.IGNORECASE)
                rules.append((pat, f"{prop}-{token}"))
    return rules


def build_named_rules() -> list[tuple[re.Pattern, str]]:
    rules = []
    for cls, repl in NAMED.items():
        pat = re.compile(rf"(?<![\w-]){re.escape(cls)}(?![\w-])")
        rules.append((pat, repl))
    return rules


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    hex_rules = build_hex_rules()
    named_rules = build_named_rules()

    files = []
    for dirpath, _dirs, names in os.walk(SRC_ROOT):
        for n in names:
            if n.endswith(".tsx"):
                files.append(os.path.join(dirpath, n))
    files.sort()

    total_repl = Counter()
    changed_files = 0
    grand_total = 0

    for path in files:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        orig = text
        for pat, repl in hex_rules + named_rules:
            text, n = pat.subn(repl, text)
            if n:
                total_repl[repl] += n
                grand_total += n
        if text != orig:
            changed_files += 1
            if not args.dry_run:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(text)

    rel = os.path.relpath(SRC_ROOT)
    mode = "DRY-RUN" if args.dry_run else "APPLIED"
    print(f"[{mode}] {grand_total} replacements across {changed_files} files in {rel}")
    print("Top replacements:")
    for repl, n in total_repl.most_common(30):
        print(f"  {n:5d}  -> {repl}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
