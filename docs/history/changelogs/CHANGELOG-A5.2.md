# CHANGELOG — Phase A5.2: Platform Health Center + Smart Widgets Platform

Builds directly on Phase A5.1 (Executive Dashboard + Mission Control). No
controller, API, component, or business rule from A5.1 was redesigned,
renamed, or duplicated — every new surface below reuses A5.1's existing
builders (`buildPlatformOverviewData`, `buildExecutiveDashboardData`,
`buildMissionControlData`, `buildSmartAlerts`) as its data source.

---

## 1. Audit Report

Read and cross-referenced: Mission Control / Executive Dashboard, the
Overview controller, Analytics, Realtime/Socket layer, `NotificationEmitter`,
Cron jobs, AI automation, Payments/Refunds/Insurance, Doctors/Patients/
Appointments, Sidebar/Navigation, the Permission system, Admin/Health APIs,
`OnlineSession`, `WebhookEvent`, `ReminderLog`, `AIDraft`, storage config,
email service, and every existing admin frontend page.

### Real problems found (and fixed)

1. **No scheduler/automation monitoring existed anywhere.** The 4
   standalone cron scripts (`reconciliationCron`, `expirePaymentWindows`,
   `subscriptionRenewals`, `retryFailedPayments`) and the on-demand AI
   automation runner (`automation/cronJobs.js`) only wrote to console via
   `logger` — nothing was persisted or queryable. There is also no
   in-process job scheduler in this codebase at all (no node-cron/Agenda/
   Bull); jobs are triggered externally (OS crontab / container
   scheduler) or on-demand via the admin API. **Fix:** new `CronRunLog`
   model + `utils/cronRunTracker.js`, wired into all 4 cron scripts and
   every automation sub-job. Real last-run/status/duration is now
   queryable everywhere the Platform Health Center needs it.

2. **A real bug**: `automation/cronJobs.js#runAll()` used `Promise.all`
   across its 7 sub-jobs. `Promise.all` rejects as soon as one promise
   rejects, so a single failing job would make the entire
   `POST /api/ai/automation/run` request return a 500 with **no record of
   which job failed** or whether the others succeeded. **Fix:** each job
   now runs independently with its own try/catch; one failing job no
   longer masks the others, and every job's outcome (success or failure)
   is persisted via the same `CronRunLog`/`trackRun` mechanism.

3. **No webhook processing visibility.** `WebhookEvent` already recorded
   `received`/`processed`/`failed`/`duplicate` status per event but no
   endpoint ever surfaced aggregate health from it. **Fix:** added to
   Infrastructure Status (received/processed/failed counts, last 24h).

4. **No storage health check.** Nothing verified the invoice storage
   directory (`env.invoiceStorageDir`) was writable or reported disk
   usage. **Fix:** real `fs.access`/`fs.statfs` check against the exact
   directory `invoiceService` already writes to.

5. **No AI provider health signal.** The swappable
   `textGenerationProvider.js` had no way to report which provider is
   active or whether it resolves. **Fix:** added `getAIProviderStatus()`
   to the existing provider-resolution module — reuses the exact same
   `resolveProvider()` every real generation call already goes through.

6. **No widget architecture, no reusable widget components, no
   drill-down, no personalization.** Confirmed: only 3 generic admin
   components existed (`AdminModal`, `AdminTable`, `FilterBar`), no widget
   abstraction anywhere. **Fix:** see Smart Widget Architecture below.

### Real gaps found and honestly documented as NOT fabricated

- **"Pending Reviews"** (from the original brief) has no backing data —
  `models/Review.js` has no moderation/approval workflow; reviews publish
  immediately. Intentionally **omitted** rather than invented.
- **"AI Failures"** as a distinct monitored metric has no real signal —
  AI generation in this codebase is synchronous/deterministic
  (`templateProvider.js`); a failure surfaces as an immediate HTTP error
  and is never persisted. Reported instead: **AI draft discard rate**, a
  genuinely different, honestly-labeled metric (discarded vs. total
  `AIDraft` documents).
- **"Late arrivals" distinct from "delayed"** — no check-in timestamp
  exists in the `Appointment` model. "Delayed appointments" is reported
  as appointments whose scheduled date has passed with no terminal
  status — a real, honest proxy, not a fabricated concept.
- **RBAC roles** (Finance/Support/Operations from the brief) still don't
  exist in this codebase (real roles: `super_admin`/`admin`/`doctor`/
  `receptionist`/`patient`, unchanged since A5.1). Widget/section
  visibility reuses the **existing** `PERMISSION_KEYS`
  (`manage_payments`, `manage_doctors`, `manage_settings`) via a newly
  extracted `userHasPermission()` helper — no new roles invented.
- **No SMS provider** is integrated anywhere (unchanged from A5.1,
  reported honestly in Infrastructure Status).
- **No in-process job queue** exists (unchanged from A5.1) — the
  Scheduler section of Infrastructure Status states this model
  explicitly instead of fabricating worker/queue metrics.

---

## 2. Architecture Decisions

- **Zero duplicate controllers/APIs.** `platformHealthAdminController.js`
  and `widgetsAdminController.js` both import and reuse
  `buildPlatformOverviewData`, `buildPlatformAnalyticsData`,
  `buildExecutiveDashboardData`, `buildMissionControlData`, and
  `buildSmartAlerts` from the existing A5.1 modules rather than
  re-deriving any aggregate.
- **`overviewAdminController.js`** was refactored (not redesigned) to
  extract `buildPlatformAnalyticsData(days)` out of the existing
  `getPlatformAnalytics` handler — same queries, same behaviour, now
  reusable by the Revenue/Appointments/Doctors/Patients widgets with a
  real date-range parameter.
- **`middleware/adminMiddleware.js`** was refactored to extract
  `userHasPermission(user, key)` out of `requirePermission`'s inline
  logic, so the Smart Widgets registry can check permissions as a plain
  boolean (needed per-widget, not per-route) without duplicating the
  Map-lookup logic.
- **One generic widget dispatcher**, not 14 bespoke endpoints: a single
  `WIDGET_REGISTRY` array declares each widget's title, category,
  permission key, and capability flags (date range / drill-down /
  export); `getWidgetData(key)` dispatches into a `load()` function that
  always calls an existing builder.
- **One generic frontend widget shell** (`WidgetShell.jsx`), not 14
  bespoke components: expand/collapse, refresh, loading/skeleton/error/
  empty states, the date-range control, CSV export, and realtime
  re-fetch on `dashboardSyncTick` are implemented exactly once. Each
  widget only supplies its own `renderBody`/`renderDrillDown` (in
  `widgetRegistry.jsx`).

---

## 3. Platform Health Rules

**Overall Health Score** (0–100, floored at 0, every deduction explained
inline in the API response and rendered in the UI):

- Starts at 100
- `-10` database not in a healthy connected state
- `-8` realtime (socket) layer not healthy
- `-8` invoice storage directory not writable
- `-5` per failed cron/automation job, capped at `-20`
- `-1` point per 1% webhook failure rate over the last 24h
- `-1` point per unresolved critical alert (reuses `buildSmartAlerts`
  directly), capped at `-25`

Status bands: `healthy` ≥ 80, `warning` ≥ 60, `degraded` ≥ 40, `critical`
< 40.

**Infrastructure Status** — database, realtime/socket, API (reporting
from the live process), scheduler (per-job real last-run/status from
`CronRunLog`), email (SMTP configured check, reused from A5.1), SMS
(honestly "not integrated"), storage (real filesystem check), webhook
(real `WebhookEvent` aggregate), payment provider (Razorpay keys
configured check), AI provider (real resolution check).

**Operational Health** — failed payments today, refund delays (>7 days
pending, same threshold A5.1 already established), insurance issues
(expiring within 14 days with an open claim), critical reports pending,
delayed appointments (real proxy, defined above), automation/cron
failures (from `CronRunLog`), AI activity today, AI draft discard rate.

---

## 4. Smart Widget Architecture

14 widgets, one registry, one dispatcher, one frontend shell:

`revenue · appointments · doctors · patients · insurance · refunds ·
notifications · ai · automation · platformHealth · systemStatus ·
criticalAlerts · emergency · liveSessions`

Every widget supports (via the shared shell, not per-widget code):
expand/collapse, manual refresh, realtime refresh on `dashboardSyncTick`,
loading skeleton, error state, empty state, permission-gated visibility
(hidden entirely if the admin's role lacks the required permission),
and — where the registry marks it — date range, drill-down modal, and
CSV export.

**Personalization**: an admin's widget selection and add/remove choices
persist in `localStorage` per-admin (`hms_widget_layout_<userId>`). No
new backend was needed for this — it is genuinely client-side
preference, not data. A saved layout is always re-filtered against the
admin's *current* permissions on load, so a later permission change
never leaks a widget back in.

---

## 5. Business Rules

Documented inline in code and in the UI itself:

- The Overall Health Score breakdown is returned by the API and
  rendered as plain-English bullet points — never just a number.
- Every widget's `load()` function is a one-line reuse of an existing
  builder — see `widgetsAdminController.js` for the full mapping.
- "Pending Reviews" and "AI Failures" are documented gaps, not
  fabricated metrics (see Audit Report §1).

---

## 6. Performance Notes

- All new endpoints use `Promise.all` internally (no serial awaits) —
  `buildPlatformHealthCenter` fires infra/operational/alerts queries
  concurrently.
- No N+1 queries introduced: widget `load()` functions call at most 2–3
  existing builders per widget, each already batched internally.
- Widgets are lazy — `WidgetGrid` only renders (and therefore only
  fetches) the widgets currently in the admin's visible layout.
- `getLatestRunPerJob()` uses a single aggregation pipeline (`$group` +
  `$first` after `$sort`) rather than N queries for N job names.

---

## 7. Security Notes

- No new roles were invented. Widget/section visibility is gated by the
  **existing** `PERMISSION_KEYS` (`manage_payments`, `manage_doctors`,
  `manage_settings`) via the newly extracted `userHasPermission()`
  helper, reused by both the classic Express middleware
  (`requirePermission`) and the new per-widget check.
- `super_admin` continues to bypass all permission checks, unchanged
  from the existing model.
- The Smart Widgets registry endpoint (`GET /api/admin/widgets/registry`)
  never returns a widget's internal `load` function or permission
  internals — only `{ key, title, category, capability flags, allowed }`.

---

## 8. Verification Report

| Check | Result |
|---|---|
| `node --check` on every new/edited backend file | ✅ Passed |
| Backend boot (`node server.js`) | ✅ Boots cleanly — ECONNREFUSED only (no live MongoDB in this sandbox, same as every prior phase) |
| All 17 pre-existing backend tests (`node tests/run-all.mjs`) | ✅ 17 passed, 0 failed, unchanged |
| `npx eslint backend/ src/` | ✅ 0 errors |
| `npm run build` (frontend production build) | ✅ Builds cleanly |
| Vitest suite (`api.test.js`) | ⚠️ Still not runnable in this sandbox — `mongodb-memory-server` cannot download its MongoDB binary (network-restricted). Same pre-existing limitation flagged in every prior phase; never claimed passing. |

---

## 9. Files changed/added

**Backend (new)**
- `backend/models/CronRunLog.js`
- `backend/utils/cronRunTracker.js`
- `backend/controllers/admin/platformHealthAdminController.js`
- `backend/controllers/admin/widgetsAdminController.js`
- `backend/routes/admin/platformHealthAdminRoutes.js`
- `backend/routes/admin/widgetsAdminRoutes.js`

**Backend (edited, additive only)**
- `backend/cron/reconciliationCron.js` — wired into `trackRun`
- `backend/cron/expirePaymentWindows.js` — wired into `trackRun`
- `backend/cron/subscriptionRenewals.js` — wired into `trackRun`
- `backend/cron/retryFailedPayments.js` — wired into `trackRun`
- `backend/automation/cronJobs.js` — rewritten to isolate per-job
  failures (real bugfix) and persist run history
- `backend/ai/providers/textGenerationProvider.js` — added
  `getAIProviderStatus()`
- `backend/controllers/admin/overviewAdminController.js` — extracted
  `buildPlatformAnalyticsData()` (same behaviour, now reusable)
- `backend/middleware/adminMiddleware.js` — extracted
  `userHasPermission()` (same behaviour, now reusable)
- `backend/app.js` — mounted the 2 new routers

**Frontend (new)**
- `src/components/widgets/WidgetShell.jsx`
- `src/components/widgets/widgetRegistry.jsx`
- `src/components/widgets/WidgetGrid.jsx`
- `src/pages/admin/AdminPlatformHealth.jsx`
- `src/pages/admin/AdminOperationsCenter.jsx`
- `src/pages/admin/AdminSmartWidgets.jsx`

**Frontend (edited, additive only)**
- `src/api/adminApi.js` — added Platform Health + Widgets API methods
- `src/pages/admin/AdminMissionControl.jsx` — added a new "Storage,
  Webhooks & Scheduler" card using the new infra endpoint (Step 6 — Live
  Platform Status — extended in place rather than building a duplicate
  page)
- `src/routes/AppRoutes.jsx` — 3 new routes
- `src/config/navigation.js` — 3 new nav entries (Sidebar and the
  command palette both read from this shared config, so both update
  automatically)

---

## Deferred / out of scope for this phase (documented, not silently dropped)

- Drag-and-drop widget reordering (current personalization is
  add/remove + backend-determined default order; a full DnD library
  was judged out of scope for this pass).
- A dedicated review-moderation queue (would require a genuine product
  decision — adding an approval workflow to `Review` — out of scope for
  a monitoring phase).
- SMS provider integration (no provider chosen/configured anywhere in
  this codebase; reported honestly, not built).
