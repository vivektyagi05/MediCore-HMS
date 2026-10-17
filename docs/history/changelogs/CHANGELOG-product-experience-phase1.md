# MediCore HMS — Product Experience Phase 1

Scope note up front: the mission brief asks for a full enterprise-grade
redesign across 12 areas (design system, global nav, workflow polish,
reusability, performance, accessibility, micro-interactions, realtime,
mobile, security, verification) spanning all 57 pages. That is genuinely
several weeks of work for a real team, not something that can be honestly
completed — end to end, verified — in a single pass. This phase does a real
audit of the whole app, fixes the concrete issues the audit actually found,
and ships the first layer of the shared design system. The rest is
scoped out below as a roadmap rather than claimed as done.

## Step 1 — Audit findings (what's actually there)

The app is more consistent than the mission brief assumes. Specifically
already solid, verified by grep + reading the code, not assumed:
- A shared `Toast` system (`ToastContext`) is used consistently across 47
  files — no duplicate notification patterns.
- A shared `EmptyState` component already exists and is used in 26 files.
- A shared `Skeleton` component already exists (`src/components/shared/Skeleton.jsx`).
- `Button`, `Card`, `Input`, `Modal`, `Loader` primitives exist and are used
  across 43-45 files each.
- The doctor consultation-mode badge system (`MODE_CLS`/`MODE_STYLES` in
  `DoctorDiscoveryUI.jsx`) is already a single exported source of truth,
  reused correctly in `DoctorProfile.jsx` — left untouched.

Real inconsistencies found and fixed in this phase:
- **Status pill drift**: `DoctorEarnings.jsx` and `AdminRefunds.jsx` each
  hardcoded their own status-color map, and the shade weights had drifted
  (`*-100/*-700` vs `*-100/*-800`) so the same semantic status rendered
  differently on different pages.
- **Dead search input**: the top navbar's search field
  (`src/components/layout/Navbar.jsx`) was a plain `<input type="search">`
  with no `onChange`, no results, and no keyboard handling — a real dead
  control, not a design nit.
- **Navigation duplication risk**: the role-based nav catalog only existed
  inside `Sidebar.jsx`; building a second nav-aware feature (command
  palette) would have meant a second copy that could drift.

## Step 2 — Design system (shipped this phase)

- New `src/components/ui/Badge.jsx`: a single tone-based pill component
  (`neutral / info / success / warning / danger / violet / teal / sky`).
  Replaces the two duplicated status-color maps above; `DoctorEarnings.jsx`
  and `AdminRefunds.jsx` now both render status through it.

## Step 3 — Global navigation (shipped this phase, partial)

- New `src/config/navigation.js`: the role-filtered nav catalog extracted
  out of `Sidebar.jsx` into one shared module (with the original i18n
  crash-bugfix note preserved as a comment for context).
- New `src/components/layout/CommandPalette.jsx`: a real Ctrl/Cmd+K command
  palette — role-filtered search over every page in the nav catalog, arrow
  key + Enter navigation, Escape to close, and a "Recent" section backed by
  localStorage.
- Navbar's search field now actually opens the palette (click, or the
  global Ctrl/Cmd+K shortcut) instead of being inert.
- New `src/components/layout/Breadcrumbs.jsx`: derives a breadcrumb trail
  from the current route, using the same nav catalog for real page labels
  and humanizing dynamic id segments. Rendered above every dashboard page
  via `DashboardLayout.jsx`.

Deferred from Step 3 (not built this phase): "Pinned pages" / "Favorites"
(would need a new backend preference field — no such model exists),
cross-page "recently viewed" beyond doctors (already exists) and pages
(now added), quick-action shortcuts beyond navigation (e.g. "create
invoice" from anywhere) — would need per-role action definitions that
don't exist yet, left for a follow-up rather than invented.

## Steps 4-12 — deferred to a follow-up phase

Workflow-click-reduction audit, full component/hook dedup pass beyond the
badge fix, performance work (bundle splitting — the build already warns
about one >500kB chunk), a real WCAG pass, micro-interaction/animation
audit, Socket.IO realtime UX review, mobile/touch pass, and an RBAC/
permissions security audit are all real, separate efforts. None of them
were touched this phase and nothing here should be read as claiming they
were.

## Verification performed

- `npm run build` — clean.
- `npx eslint .` — zero new errors; the one pre-existing `no-unused-vars`
  in `templateProvider.js` (from an earlier phase, unrelated) is still
  there, confirmed untouched.
- Backend: `node --check server.js`, and a full boot with dummy
  `MONGO_URI`/`JWT_SECRET` — reaches `ECONNREFUSED` to MongoDB only (no
  live DB in this sandbox), no earlier startup errors.
- All 18 pre-existing backend test files run directly with `node` (plain
  assert scripts, not Vitest) — all 18 passed.

## Files touched

- `src/config/navigation.js` (new)
- `src/components/ui/Badge.jsx` (new)
- `src/components/layout/CommandPalette.jsx` (new)
- `src/components/layout/Breadcrumbs.jsx` (new)
- `src/components/layout/Sidebar.jsx` (nav array extracted to config)
- `src/components/layout/Navbar.jsx` (search wired to palette)
- `src/layout/DashboardLayout.jsx` (palette + breadcrumbs mounted)
- `src/pages/doctor/DoctorEarnings.jsx` (status map -> Badge)
- `src/pages/admin/AdminRefunds.jsx` (status map -> Badge)

No models, controllers, or routes were touched this phase — this was a
frontend-only pass.
