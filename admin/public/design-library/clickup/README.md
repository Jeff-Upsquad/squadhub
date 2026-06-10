# ClickUp Design System — Extracted Reference

A reverse-engineered design system for **clickup.com**, built by crawling the live site
(2026-06-11) and extracting tokens from production CSS — nothing eyeballed.

## Files

| File | Purpose |
|---|---|
| `index.html` | Browsable style guide — colors, gradients, typography, 289 icons, buttons, forms, badges, cards, components, dark mode, elevation, spacing, motion. Click any swatch/token/icon to copy. |
| `tokens.css` | All tokens as CSS custom properties (names mirror ClickUp's own `--Core-*` / `--color-v3-*` properties). |
| `tokens.json` | Same tokens in W3C design-token format (Style Dictionary–compatible). |
| `assets/icons.svg` + `assets/cuicons-v3.svg` | ClickUp's two production icon sprites (283 + 287 symbols; 289 unique). |
| `assets/clickup-logo-text.png` | Official full lockup. |

## Run it

```bash
cd clickup-design-system && python3 -m http.server 3001
# open http://localhost:3001
```

(HTTP is required for the icon-grid `fetch()`; opening `index.html` via `file://` shows
everything except the live icon library.)

## Coverage

- 15 pages crawled across every archetype: home, /brand, /brand/logo, /pricing, /ai,
  /enterprise, /about, /features/*, /teams/*, /templates, /integrations, /compare/*,
  /careers, /blog
- 29 CSS bundle URLs → 19 unique bundles (1.67 MB) analyzed
- 804 custom properties, 265 unique hex values, 26 @font-face rules, breakpoint census

## Key findings

- **Typefaces (all variable, self-hosted):** Plus Jakarta Sans 200–800 (headlines, incl.
  weight 650), Inter 100–900 (body/UI), Sometype Mono 400–700 (uppercase eyebrows/captions),
  Shantell Sans (handwritten accents).
- **2026 "Core" layer:** monochrome canvas (#202020 on #FFF, #F8F9FA boxes, #E8E8E8 borders)
  with four neon accents — pink #FF02F0, purple #6647F0, blue #0091FF, orange #FC6D2D — each
  paired with a pastel badge tint.
- **Buttons (CuButtonV5):** flat #202020 primary, 32px tall, radius 8, Inter 600 14px with
  ligatures off; tri-color gradient CTA (`263deg #FA12E3 → #7612FA → #12D0FA`) survives from V4
  on AI/pricing pages.
- **Headlines** use gradient text fills (`98deg #202020 → #8F8F8F` + `background-clip:text`)
  and tight tracking (−0.035em).
- **Shadows are navy** (rgb 16,30,54 @ 6–10%), never black. Radius scale 4→60px; buttons 8,
  cards 12–16, media 14, pills 999.
- **Layout:** 1160px container (nav 1120, Brain 1080), 10px spacing scale to 150,
  breakpoints 600/900/1200/1400, nav 76px.
- **Dark "Brain" theme:** #000/#0A0A0A surfaces, #2A2A2A borders, #EEE/#B4B4B4 text,
  lavender #B38CFF accents.

> Independent reference for study. ClickUp, the ClickUp logo, and all linked assets are
> trademarks of Mango Technologies, Inc. Not affiliated.
