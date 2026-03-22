# Sidebar Redesign + Geist Font Switch

## Context
The user wants two changes: (1) switch fonts from Plus Jakarta Sans/Inter/Sometype Mono to Vercel's **Geist** and **Geist Mono** font family, and (2) redesign the left sidebar to match a ClickUp-style layout where Home becomes a hub (Inbox, New Tasks, Assigned Comments, Favorites) and Chat/Spaces become their own top-level sections.

---

## Part 1: Switch to Geist Font Family

Replace all three fonts with Vercel's Geist system. Since all 34+ component files use CSS custom properties (`--font-display`, `--font-body`, `--font-mono`), only 6 files need updating — everything cascades automatically.

### Files to update:

| File | Change |
|---|---|
| `web/index.html` | Replace Google Fonts `<link>` with Geist + Geist Mono; update inline font-family in loading placeholder |
| `web/src/styles/globals.css` | `--font-display: 'Geist'`, `--font-body: 'Geist'`, `--font-mono: 'Geist Mono'`; body font-family |
| `web/src/main.tsx` | Update hardcoded font-family strings in ErrorBoundary |
| `admin/index.html` | Replace Google Fonts `<link>` with Geist + Geist Mono |
| `admin/src/styles/globals.css` | Same CSS variable + body rule changes as web |
| `admin/src/main.tsx` | Update hardcoded font-family strings in ErrorBoundary |

**Google Fonts link:**
```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" rel="stylesheet" />
```

**CSS variables:**
```css
--font-display: 'Geist', sans-serif;
--font-body: 'Geist', system-ui, -apple-system, sans-serif;
--font-mono: 'Geist Mono', monospace;
```

---

## Part 2: Sidebar Redesign

### Current → New Icon Bar Sections

| Current (5) | New (8) | Content |
|---|---|---|
| Home (with Chat/Tasks tabs) | **Home** | Hub: Inbox, New Tasks, Assigned Comments, Favorites |
| — | **Spaces** | SpaceTree (PM module) |
| — | **Chat** | ChannelSidebar (messaging) |
| Calendar | **Planner** | Coming soon |
| Apps | **AI** | Coming soon |
| Teams | **Teams** | Coming soon |
| Docs | **Docs** | Coming soon |
| — | **Dashboard** | Coming soon |

### Key structural changes:
- **Split Chat & Tasks** out of Home into their own sections (Chat, Spaces)
- **Remove ModuleSwitcher** (Chat/Tasks tabs) — no longer needed
- **New HomeSidebar** component with navigation items + favorites
- **Favorites system** — backend (DB + API) + frontend (hooks + UI)

---

### Step 1: Backend — Favorites System

#### 1a. DB migration (run in Supabase SQL editor)
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

#### 1b. Add shared types — `shared/src/index.ts`
```typescript
export type FavoriteItemType = 'channel' | 'list' | 'folder' | 'space';
export interface Favorite {
  id: string;
  user_id: string;
  workspace_id: string;
  item_type: FavoriteItemType;
  item_id: string;
  created_at: string;
  item_name?: string;
}
```

#### 1c. Create API routes — NEW `server/src/routes/favorites.ts`
- `GET /favorites?workspace_id=xxx` — list user's favorites with item names
- `POST /favorites` — add favorite (workspace_id, item_type, item_id)
- `DELETE /favorites/:id` — remove favorite
- Uses same pattern as `server/src/routes/pm/spaces.ts` (Router + zod + supabaseAdmin + requireAuth)

#### 1d. Register routes — `server/src/index.ts`
- Add `import favoritesRoutes from './routes/favorites';`
- Add `app.use('/favorites', favoritesRoutes);`

#### 1e. Add Vite proxy — `web/vite.config.ts`
- Add `'/favorites': 'http://localhost:4000'` to proxy config

---

### Step 2: Frontend — HomeSidebar + Favorites Hooks

#### 2a. Create favorites hooks — NEW `web/src/hooks/useFavorites.ts`
- `useFavorites(workspaceId)` — React Query to fetch favorites
- `useAddFavorite(workspaceId)` — mutation to add
- `useRemoveFavorite(workspaceId)` — mutation to remove

#### 2b. Create HomeSidebar — NEW `web/src/pages/app/HomeSidebar.tsx`
Layout:
- Header: "Home" with "+" button
- Nav items: Inbox (icon), New Tasks (icon), Assigned Comments (icon) — placeholder links for now
- Divider
- Favorites section: header label + list of favorited items with type-based icons

---

### Step 3: Rewrite MainLayout.tsx

**`web/src/layouts/MainLayout.tsx`** — the central change:

1. **Update ActiveSection type** (define locally, no longer from ModuleSwitcher):
   ```typescript
   type ActiveSection = 'home' | 'spaces' | 'chat' | 'planner' | 'ai' | 'teams' | 'docs' | 'dashboard';
   ```

2. **Replace SECTIONS array** — 8 sections with appropriate icons

3. **Remove** `homeTab` state and `ModuleSwitcher` import

4. **Add** `HomeSidebar` import

5. **Sidebar panel logic**:
   - `home` → `<HomeSidebar />`
   - `chat` → `<ChannelSidebar />`
   - `spaces` → `<SpaceTree />`
   - Others → "Coming soon" placeholder

6. **Content area logic**:
   - `chat` → Channel header + ChatPanel
   - `spaces` → ListPage
   - `home` → Home hub placeholder
   - Others → Coming soon

### Step 4: Delete ModuleSwitcher

**`web/src/components/ModuleSwitcher.tsx`** — delete (only imported by MainLayout, which no longer uses it)

---

## Files Summary (13 files)

| # | File | Action |
|---|---|---|
| 1 | `web/index.html` | Edit — Geist font link |
| 2 | `web/src/styles/globals.css` | Edit — font variables |
| 3 | `web/src/main.tsx` | Edit — ErrorBoundary fonts |
| 4 | `admin/index.html` | Edit — Geist font link |
| 5 | `admin/src/styles/globals.css` | Edit — font variables |
| 6 | `admin/src/main.tsx` | Edit — ErrorBoundary fonts |
| 7 | `shared/src/index.ts` | Edit — add Favorite type |
| 8 | `server/src/routes/favorites.ts` | **Create** — CRUD API |
| 9 | `server/src/index.ts` | Edit — register routes |
| 10 | `web/vite.config.ts` | Edit — add proxy |
| 11 | `web/src/hooks/useFavorites.ts` | **Create** — React Query hooks |
| 12 | `web/src/pages/app/HomeSidebar.tsx` | **Create** — sidebar component |
| 13 | `web/src/layouts/MainLayout.tsx` | **Rewrite** — new section routing |
| 14 | `web/src/components/ModuleSwitcher.tsx` | **Delete** |

---

## Verification
1. `npm run build` passes for web, admin, server, shared
2. All pages render correctly with Geist font
3. Left icon bar shows 8 sections: Home, Spaces, Chat, Planner, AI, Teams, Docs, Dashboard
4. Clicking "Home" shows HomeSidebar (Inbox, New Tasks, Assigned Comments, Favorites)
5. Clicking "Chat" shows ChannelSidebar + ChatPanel
6. Clicking "Spaces" shows SpaceTree + ListPage
7. Favorites CRUD works (add/remove via API, list renders in HomeSidebar)
8. DB migration applied: `favorites` table exists with proper constraints
