# Design Library

A personal archive of design systems captured from sites worth learning from.
Each source gets extracted from production CSS into tokens + a browsable guide,
registered in `sources.json`, and rendered on the hub page.

## Run

```bash
cd ~/squadhub/design-library && python3 -m http.server 3001
# hub:    http://localhost:3001
# source: http://localhost:3001/<id>/   (e.g. /clickup/)
```

Or via Claude Code preview: launch config `design-library` (port 3001).

## Structure

```
design-library/
├── index.html        # hub — renders sources.json (filter web/mobile, search)
├── sources.json      # registry: one entry per captured source
├── clickup/          # source 01 — captured 2026-06-11
│   ├── index.html    #   full style guide (colors, type, icons, buttons, components…)
│   ├── tokens.css    #   tokens as CSS custom properties
│   ├── tokens.json   #   tokens in W3C design-token format
│   └── assets/       #   logos, icon sprites
└── <next-source>/    # same shape, forever
```

## Conventions for every source

| File | Required | Purpose |
|---|---|---|
| `<id>/index.html` | yes | Self-contained browsable guide (relative paths only) |
| `<id>/tokens.json` | yes | Machine-readable tokens — what Claude reads when implementing |
| `<id>/tokens.css` | yes | Same tokens as CSS custom properties |
| `<id>/assets/` | as needed | Logos, icon sprites, reference screenshots |
| entry in `sources.json` | yes | id, name, url, platform (`web`/`mobile`/both), captured date, colors (5–6 for the palette strip), fonts, stats, tags |

Mobile sources follow the same shape — tag `"platform": ["mobile"]`; tokens may
come from app-store pages, marketing sites, or screenshots, and guides should
show components at mobile widths.

## Workflows (things to tell Claude)

1. **Capture** — `Add https://example.com to the design library`
   → crawls the site, extracts tokens/typography/icons/components from real CSS,
   builds the guide folder, registers it in `sources.json`.
   Add hints when useful: "focus on the dashboard screenshots", "it's a mobile app".

2. **Browse** — `Open the design library`
   → starts the server (port 3001) and hands you the link.

3. **Implement** — `Implement clickup's pricing cards in <project>`
   → Claude reads `<id>/tokens.json` + the guide markup and ports the design into
   the target codebase, adapted to its stack (Tailwind / CSS vars / React Native
   styles for the mobile apps), in a worktree branch as usual.

## Sources

| # | Source | Platform | Captured | Highlights |
|---|---|---|---|---|
| 01 | [ClickUp](clickup/) | web | 2026-06-11 | 2026 AI rebrand · 804 tokens · 289-icon sprite · gradient CTAs · dark "Brain" theme |

> All captures are independent references reverse-engineered from publicly served
> CSS, for personal study. Trademarks belong to their owners.
