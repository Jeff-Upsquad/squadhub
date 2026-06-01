# Sidebar Redesign + Geist Font Switch

## Context
The user wants two changes: (1) switch fonts from Plus Jakarta Sans/Inter/Sometype Mono to Vercel's **Geist** and **Geist Mono** font family, and (2) redesign the left sidebar to match a ClickUp-style layout where Home becomes a hub (Inbox, New Tasks, Assigned Comments, Favorites) and Chat/Spaces become their own top-level sections.

> **Last updated: 2026-06-01** — Plan audited against actual codebase state.

---

## ✅ Part 1: Switch to Geist Font Family

Replace all three fonts with Vercel's Geist system. Since all 34+ component files use CSS custom properties (`--font-display`, `--font-body`, `--font-mono`), only 6 files need updating — everything cascades automatically.

### Files to update:

| File | Change | Status |
|------|--------|--------|
| `web/index.html` | Replace Google Fonts `<link>` with Geist + Geist Mono; update inline font-family in loading placeholder | ❌ **Not done** — Still has Google Sans Flex + Geist Mono. Missing Geist display font. |
| `web/src/styles/globals.css` | `--font-display: 'Geist'`, `--font-body: 'Geist'`, `--font-mono: 'Geist Mono'`; body font-family | ❌ **Not done** — Still uses Inter/JetBrains Mono. |
| `web/src/main.tsx` | Update hardcoded font-family strings in ErrorBoundary | ⛔ **N/A** — File doesn't exist. This is now a Next.js app (`src/app/layout.tsx`). No ErrorBoundary found. |
| `admin/index.html` | Replace Google Fonts `<link>` with Geist + Geist Mono | ❌ **Not done** — Still has Google Sans Flex + Geist Mono. Missing Geist display font. |
| `admin/src/styles/globals.css` | Same CSS variable + body rule changes as web | ❌ **Not done** — `--font-display` and `--font-body` are Google Sans Flex. Only `--font-mono` is Geist Mono. |
| `admin/src/main.tsx` | Update hardcoded font-family strings in ErrorBoundary | ⛔ **N/A** — File doesn't exist. Also a Next.js app (`admin/src/app/layout.tsx` uses next/font/google imports). |

### Corrected approach for Next.js:
- **Web**: Use `next/font/google` in `web/src/app/layout.tsx` (already imports Inter) — replace with Geist and Geist Mono
- **Admin**: Same pattern in `admin/src/app/layout.tsx`
- **CSS variables**: Update both `web/src/styles/globals.css` and `admin/src/styles/globals.css`

---

## ✅ Part 2: Sidebar Redesign

### Current → New Icon Bar Sections

| Current (5) | New (8) | Content | Status |
|---|---|---|---|
| Home (with Chat/Tasks tabs) | **Home** | Hub: Inbox, New Tasks, Assigned Comments, Favorites | ❌ **Not done** — MainLayout doesn't use 8-section system |
| — | **Spaces** | SpaceTree (PM module) | ❌ Not wired to a dedicated rail button |
| — | **Chat** | ChannelSidebar (messaging) | ❌ Not wired to a dedicated rail button |
| Calendar | **Planner** | Coming soon | ❌ Not done |
| Apps | **AI** | Coming soon | ❌ Not done |
| Teams | **Teams** | Coming soon | ❌ Not done |
| Docs | **Docs** | Coming soon | ❌ Not done |
| — | **Dashboard** | Coming soon | ❌ Not done |

### Key structural changes:
- [ ] **Split Chat & Tasks** out of Home into their own sections (Chat, Spaces)
- [x] **Remove ModuleSwitcher** (Chat/Tasks tabs) — no longer needed
- [x] **New HomeSidebar** component with navigation items + favorites
- [x] **Favorites system** — backend (DB + API) + frontend (hooks + UI)

---

### ✅ Step 1: Backend — Favorites System (COMPLETED)

#### ✅ 1a. DB migration (run in Supabase SQL editor)
```sql
CREATE TABLE favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('channel','list','folder','space')),
  item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_type, item_id)
);
CREATE INDEX idx_favorites_user_workspace ON favorites(user_id, workspace_id);
```

#### ✅ 1b. Add shared types — `shared/src/index.ts`
- `FavoriteItemType` and `Favorite` interface exist (line ~582). Extra field `space_id?: string | null` beyond original spec.

#### ✅ 1c. Create API routes — `server/src/routes/favorites.ts`
- GET, POST, DELETE all implemented. Uses `requireAuth` + `supabaseAdmin` pattern.

#### ✅ 1d. Register routes — `server/src/index.ts`
- Line 28: import; Line 135: `app.use('/favorites', ...)`

#### ✅ 1e. Add proxy
- **Vite proxy**: `web/vite.config.ts` is a legacy stub (Next.js now). **Next.js rewrite in `next.config.mjs`** line 24 handles it correctly.

---

### ✅ Step 2: Frontend — HomeSidebar + Favorites Hooks (COMPLETED)

#### ✅ 2a. Create favorites hooks — `web/src/hooks/useFavorites.ts`
- `useFavorites(workspaceId)`, `useAddFavorite(workspaceId)`, `useRemoveFavorite(workspaceId)` — all implemented.

#### ✅ 2b. Create HomeSidebar — `web/src/views/app/HomeSidebar.tsx`
- **Actual path**: `web/src/views/app/HomeSidebar.tsx` (not `pages/app/` as originally planned)
- 901 lines. Has Inbox, Day Planner, My Tasks, Mentions, Favorites, Channels, Spaces, Clients, DMs sections.

---

### ❌ Step 3: Rewrite MainLayout.tsx (INCOMPLETE)

**`web/src/layouts/MainLayout.tsx`** — NOT updated to the 8-section system:
- `ActiveSection` type is: `'home' | 'cal' | 'docs' | 'teams' | 'apps' | 'clients' | 'learning' | 'more'`
- Sidebar panel **always renders `<HomeSidebar>`** regardless of section (only suppressed for `learning`)
- Content area does not switch between ChatPanel/SpaceTree per section
- No dedicated Chat/Space rail buttons

### Step 4: Delete ModuleSwitcher (COMPLETED)
- `web/src/components/ModuleSwitcher.tsx` deleted. No imports remain in MainLayout.

---

## Files Summary — Actual Status (14 items)

| # | File | Action | Status |
|---|---|---|---|
| 1 | `web/index.html` | Edit — Geist font link | ❌ Not done |
| 2 | `web/src/styles/globals.css` | Edit — font variables | ❌ Not done |
| 3 | `web/src/app/layout.tsx` | Edit — Geist via next/font/google (replaces main.tsx) | ❌ Not done |
| 4 | `admin/index.html` | Edit — Geist font link | ❌ Not done |
| 5 | `admin/src/styles/globals.css` | Edit — font variables | ❌ Not done |
| 6 | `admin/src/app/layout.tsx` | Edit — Geist via next/font/google (replaces main.tsx) | ❌ Not done |
| 7 | `shared/src/index.ts` | Edit — add Favorite type | ✅ Done |
| 8 | `server/src/routes/favorites.ts` | **Create** — CRUD API | ✅ Done |
| 9 | `server/src/index.ts` | Edit — register routes | ✅ Done |
| 10 | `next.config.mjs` | Edit — add proxy (replaces vite.config.ts) | ✅ Done |
| 11 | `web/src/hooks/useFavorites.ts` | **Create** — React Query hooks | ✅ Done |
| 12 | `web/src/views/app/HomeSidebar.tsx` | **Create** — sidebar component | ✅ Done |
| 13 | `web/src/layouts/MainLayout.tsx` | **Rewrite** — new section routing | ❌ Not done |
| 14 | `web/src/components/ModuleSwitcher.tsx` | **Delete** | ✅ Done |

**Total: 7 done, 6 not done, 1 N/A → 7 of 12 applicable**

---

## Remaining Work

### High Priority
1. **Geist font** — 6 files across web + admin
2. **MainLayout refactor** — switch to 8-section routing with dedicated sidebar panels per section

### Verification (update after completing)
1. `npm run build` passes for web, admin, server, shared
2. All pages render correctly with Geist font
3. Left icon bar shows 8 sections: Home, Spaces, Chat, Planner, AI, Teams, Docs, Dashboard
4. Clicking "Home" shows HomeSidebar (Inbox, New Tasks, Assigned Comments, Favorites)
5. Clicking "Chat" shows ChannelSidebar + ChatPanel
6. Clicking "Spaces" shows SpaceTree + ListPage
7. Favorites CRUD works (add/remove via API, list renders in HomeSidebar)
8. DB migration applied: `favorites` table exists with proper constraints
