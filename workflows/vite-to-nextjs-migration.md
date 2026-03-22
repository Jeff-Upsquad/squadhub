# Vite + React Router → Next.js Migration

## Objective
Migrate SquadHub's web and admin apps from **Vite + React Router** to **Next.js App Router** with file-based routing.

## Architecture Changes

### Current Setup
```
web/src/
├── pages/ (React components, NOT Next pages yet)
├── components/
├── hooks/
├── services/
├── stores/
└── App.tsx (React Router wrapper)
```

### Post-Migration Setup
```
web/app/
├── layout.tsx (Root layout)
├── page.tsx (home page)
├── (auth)/
│   ├── login/page.tsx
│   └── signup/page.tsx
├── app/
│   ├── layout.tsx (App layout)
│   ├── page.tsx (dashboard/home)
│   └── [routes...]/page.tsx
├── admin/
│   ├── page.tsx
│   └── [routes...]/page.tsx
└── api/ (Backend routes, if needed)
```

## Key Changes

| Aspect | Vite + React Router | Next.js |
|--------|-------------------|---------|
| **Routing** | React Router (explicit) | File-based (implicit) |
| **Server** | Dev: Vite, Prod: Static | Dev: Next unified, Prod: Node server |
| **Config** | vite.config.ts | next.config.ts |
| **Build** | `vite build` | `next build` |
| **CSS** | Tailwind via Vite | Tailwind built-in support |
| **API Proxy** | vite.config proxy | API routes + fetch in Server Components |

## Migration Plan: 4 Phases

### Phase 1: Setup Next.js Project Structure (2-3 hours)

**Steps:**
1. **Backup current code** — Save web/ and admin/ directories
2. **Create web/app/ directory** — New Next.js structure
3. **Move layouts** — Convert MainLayout → app/layout.tsx
4. **Create page structure** — Map old routes to Next pages
5. **Update imports** — Remove React Router, use Next navigation

**Checklist:**
- [ ] web/package.json: Update deps (remove vite, react-router; add next)
- [ ] web/app/layout.tsx: Root layout with metadata, globals.css
- [ ] web/app/page.tsx: Home page
- [ ] web/app/(auth)/login/page.tsx: Login page
- [ ] web/app/(auth)/signup/page.tsx: Signup page
- [ ] web/app/app/page.tsx: Dashboard (wrapped in AppLayout)
- [ ] web/next.config.ts: Create config
- [ ] Remove web/vite.config.ts

### Phase 2: Migrate Admin App (Similar changes, parallel)

**Same as Phase 1 but for admin/**
- [ ] admin/package.json
- [ ] admin/app/layout.tsx
- [ ] admin/app/page.tsx
- [ ] admin/app/admin/*/page.tsx (all admin routes)
- [ ] admin/next.config.ts

### Phase 3: Update Services & API Calls (1-2 hours)

**Current:** services/api.ts proxies to `http://localhost:4000`

**Next.js:** 
- Keep services/api.ts (it queries backend)
- Update proxy config in next.config.ts (for dev)
- Backend routes unchanged

**Changes:**
- [ ] Update vite proxy → next.config.ts redirects
- [ ] Ensure CORS headers work (backend already set up)
- [ ] Test API calls from pages

### Phase 4: Build, Test, Deploy (1-2 hours)

**Local testing:**
```bash
npm run dev  # Next dev server
npm run build  # Check for errors
npm run start  # Production mode
```

**Docker updates:**
```dockerfile
# Replace vite build with next build
RUN npm run build -w shared && npm run build -w web
```

**Deployment:**
- [ ] Update Dockerfiles (web, admin)
- [ ] Test locally with docker compose
- [ ] Deploy to VPS
- [ ] Verify both apps work

---

## Route Mapping Example

### Web App
```
Old (React Router)          →  New (Next.js File-based)
/                           →  app/page.tsx
/login                      →  app/(auth)/login/page.tsx
/signup                     →  app/(auth)/signup/page.tsx
/app                        →  app/app/page.tsx
/app/spaces/:spaceId        →  app/app/spaces/[spaceId]/page.tsx
/app/chat/:channelId        →  app/app/chat/[channelId]/page.tsx
```

### Admin App
```
Old (React Router)          →  New (Next.js File-based)
/                           →  app/page.tsx
/login                      →  app/(auth)/login/page.tsx
/admin                      →  app/admin/page.tsx
/admin/users                →  app/admin/users/page.tsx
/admin/roles                →  app/admin/roles/page.tsx
/admin/approvals            →  app/admin/approvals/page.tsx
```

---

## Estimated Timeline

- **Phase 1**: 2-3 hours (web app setup)
- **Phase 2**: 1-2 hours (admin app, similar pattern)
- **Phase 3**: 1-2 hours (APIs, testing)
- **Phase 4**: 1-2 hours (Docker, deployment)

**Total: 5-9 hours** of focused work

---

## Key Considerations

### What Changes
- ✅ Routing (file-based vs explicit)
- ✅ Config files (next.config.ts vs vite.config.ts)
- ✅ Build/dev commands
- ✅ Server mode (Node-based, not static)

### What Stays the Same
- ✅ React components (90% compatible)
- ✅ Tailwind CSS (works great with Next)
- ✅ API calls to backend (no changes)
- ✅ Stores (Zustand, React Query)
- ✅ Business logic

### Potential Issues

| Issue | Solution |
|-------|----------|
| React Router imports fail | Remove all react-router-dom imports, use Next.js Link/useRouter |
| Pages don't render | Check file-based routing structure matches files in app/ |
| API calls fail | Verify next.config.ts proxy config, check CORS |
| Styles break | Ensure tailwind.config.ts and globals.css are in place |
| AuthStore not available | Wrap pages in Client Components (use 'use client') |

---

## Rollback Plan

If migration hits a blocker:
1. Backups exist in `git` (before changes)
2. Can revert to Vite: `git revert [commits]`
3. Keep both running in parallel during transition if needed

---

## Testing Checklist (Before Deploying)

- [ ] `npm run dev` starts without errors
- [ ] Home page loads
- [ ] Login/signup pages work
- [ ] Can authenticate and stay logged in
- [ ] API calls to backend succeed
- [ ] Chat/messaging works
- [ ] Admin dashboard loads all pages
- [ ] No console errors
- [ ] Tailwind styles apply correctly
- [ ] Mobile responsive still works

---

## Commands to Execute (In Order)

Once approved, these are high-level commands:

```bash
# Phase 1 & 2: Set up Next.js structure
npm remove vite @vitejs/plugin-react react-router-dom
npm install next

# Update package.json scripts
"dev": "next dev"
"build": "next build"
"start": "next start"

# Phase 3: Test APIs
npm run dev  # Visit localhost:3000

# Phase 4: Docker & deployment
docker compose up --build -d
```

---

## Questions Before Starting

1. **Do you want me to execute this now?** (1-2 hours of active work)
2. **Any pages/routes that should stay as-is during migration?**
3. **Should we test on a branch first or directly on main?**
4. **Any third-party integrations I should be aware of?**
