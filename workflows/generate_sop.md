# Workflow: Auto-generate a Systems & Processes (SOP) guide

**Objective:** Produce a *draft* SOP in the Learning module — real app screenshots with auto-placed markings (arrows/boxes/numbered steps/text), an optional GIF of a flow, and plain-language text — for an admin to review and publish.

**Tool:** `tools/generate_sop.mjs` (+ `tools/generate_sop.lib.mjs`). Specs live in `tools/sop_specs/*.json`.

## How it works (the WAT split)

- **You (the agent/author) decide** *what* to teach: which screen, which buttons to mark, what the text says. You encode that in a **spec JSON** (`tools/sop_specs/<slug>.json`).
- **The tool executes deterministically:** it drives the running app with Playwright, screenshots the real screen, reads each target element's live position (`getBoundingClientRect`) and converts it to the annotation **percentage** coordinates the overlay uses (so markings land exactly on the real buttons and scale on mobile), records a GIF from a short click-flow, then creates the SOP as a **draft** via the Supabase service role.

## Prerequisites

1. The **web app + API must be running** and reachable (default `http://localhost:3000`), with **representative data** for the account used — otherwise screens render empty. Start them via the preview/launch configs ("Backend Server", "Web App"); keep `DISABLE_CRONS=true` in `server/.env` for any non-prod instance.
2. `server/.env` provides Supabase + (optionally) R2 credentials.
   - **R2 creds present** → screenshots/GIFs upload to R2 and the block points at the public URL (production behaviour).
   - **R2 creds absent** (typical local dev) → images are inlined as **data URLs** so the draft still renders. Fine for review; re-generate in an environment with R2 before publishing widely (data URLs bloat the row).
3. Playwright Chromium installed: `npx playwright install chromium` (one-time).

## Writing a spec

```jsonc
{
  "title": "How to use Inbox",
  "summary": "Find, read and act on everything shared with you.",
  "category": "Core Apps",
  "nav": [ { "clickText": "Inbox", "wait": 1500 } ],   // steps to reach the screen
  "blocks": [
    { "kind": "text", "heading": "...", "paragraphs": ["...", "..."] },
    { "kind": "shot", "region": "body", "wait": 600, "caption": "...", "alt": "...",
      "markings": [
        { "matchText": "New tasks", "type": "badge", "color": "blue", "label": "1" },
        { "selector": "button[aria-label='Compose']", "type": "arrow", "color": "green" },
        { "matchText": "Overdue", "type": "rect", "color": "red" },
        { "matchText": "Focus list", "type": "text", "color": "ink", "text": "Starred tasks land here" }
      ] },
    { "kind": "gif", "region": "body", "caption": "Opening a message", "maxWidth": 760, "delay": 1100,
      "frames": [ { "wait": 700 }, { "clickText": "Inbox", "wait": 1500 }, { "clickText": "My Home", "wait": 1500 } ] }
  ]
}
```

- **Targeting an element** for a marking: `selector` (CSS) or `matchText` (case-insensitive; picks the smallest visible element containing the text — handy because the UI CSS-uppercases many labels).
- **Marking types:** `rect` (highlight box, auto-padded), `arrow` (points at the element; optional `fromOffset {dx,dy}`), `badge` (numbered circle; auto-numbers if no `label`), `text` (callout chip; optional `wPct` width).
- **Nav / GIF frame steps:** `{ clickText }`, `{ click: <selector> }`, `{ goto: <url> }`, `{ eval: <js> }`, each with optional `{ wait }` ms.

## Run it

```bash
# Validate first — no uploads, no DB writes; prints the assembled blocks:
node tools/generate_sop.mjs --spec tools/sop_specs/how-to-use-inbox.json --dry

# Real run — creates the DRAFT:
node tools/generate_sop.mjs --spec tools/sop_specs/how-to-use-inbox.json
#   --base  http://localhost:3000   (web app URL)
#   --email testlocal@test.com      (account to screenshot as; needs good data)
#   --headed                        (watch the browser)
```

On success it prints the admin review URL: `…/admin/learning/<id>`.

## Review & publish

The SOP is created as a **draft**. In the admin editor: refine the auto-placed markings (drag/recolor/delete), tweak wording, set the **audience** ("Everyone" for general how-tos), then **Publish**. Re-publishing a changed SOP notifies everyone it's shared with (the existing `lms_updated` inbox notification).

## Known limits / gotchas

- **Empty screens:** the account in `--email` needs representative data, or screenshots look bare.
- **Stale markings on UI change:** screenshots/markings are a point-in-time capture — re-run the spec after a UI change rather than hand-editing.
- **`networkidle` won't settle** (the app holds a socket open) — the tool waits on DOM + a fixed hydrate delay instead.
- **GIF size:** keep flows short; the tool warns near the 20 MB image cap and downscales frames (`maxWidth`).
- **Auto-text is a draft:** the explanatory copy comes from the spec (authored from understanding the feature); always give it a human read before publishing.
