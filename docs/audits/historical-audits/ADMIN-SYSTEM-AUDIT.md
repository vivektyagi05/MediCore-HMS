> **Historical audit.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# MediCore HMS — Admin System Audit

- **Baseline audited:** `MediCore-HMS-PHASE-03-COMPLETION-FRONTEND-HARDENED-2026-10-17.zip` (extracted copy, no git history)
- **Date:** 2026-10-22
- **Code changes made:** none (this file is the only artifact added)
- **Audit status: PARTIAL.** All 32 mounted Admin route files and all 38 Admin pages are *accounted for* in the coverage tracker (section 1), but only part of them were read to query level. This report must not be read as "Admin side fully audited". Remaining modules are listed in section 1.4.

Evidence tags used throughout:

- **[C]** confirmed by reading the current source (file/function/line given)
- **[L]** confirmed by a local command I actually ran (section 6)
- **[H]** hypothesis, needs runtime verification (section 5). Nothing tagged [H] is claimed as a finding.

Priority meaning: **P0** exploitable security/data-loss/money bug · **P1** user-facing scalability or correctness problem on a hot path · **P2** real defect or privacy/robustness gap with bounded blast radius · **P3** latent, cosmetic, or low-impact.

---

## 1. Coverage tracker

Depth legend: **A** = controller/service queries read, findings reported · **B** = route + gate read, queries spot-checked or grep-scanned · **C** = route + gate read only.

### 1.1 Mounted Admin route files (31 in `routes/admin/` + `routes/adminReviewRoutes.js`; all mounted in `app.js` lines 313-346; none unmounted)

274 route declarations counted by grep across these files (82 are POST/PUT/PATCH/DELETE).

| Route file → mount | Gate | Depth |
|---|---|---|
| activity → `/api/admin/activity` | admin only | A |
| adminReview → `/api/admin/reviews` | admin only (incl. DELETE) | A |
| appointment → `/appointments` | admin only (cancel has no permission key) | B |
| assignment → `/assignment` | manage_settings | B |
| automationStudio → `/automation-studio` | manage_settings | B |
| cms → `/cms` | admin; manage_cms on writes | B |
| commandCenter → `/command-center` | admin; section checks inside controller | B |
| doctor → `/doctors` | admin; `/:id/earnings` manage_payments; document download ungated | A (list/stats/eligible only) |
| executiveAction → `/executive-actions` | manage_settings | B |
| export → `/exports` | export_data | A |
| feature → `/features` | admin; PUT manage_settings | C |
| finance → `/finance` | manage_payments | C |
| integrationHub → `/integrations` | manage_settings | C |
| intelligence → `/intelligence` | manage_settings | C |
| missionControl → `/mission-control` | admin only | A (partial) |
| monitoring → `/monitoring` | manage_settings | B |
| operations → `/operations` | manage_settings | A (partial: queue build, single-item lookup) |
| overview → `/overview` | admin only | C |
| patient → `/patients` | admin only | A (partial: list, stats, downloads) |
| payment → `/payments` | manage_payments | C |
| permission → `/permissions` | manage_admins | C |
| platformHealth → `/platform-health` | manage_settings except `/operations-queue` | C |
| processAdmin → `/process` | manage_settings | C |
| processAnalytics → `/process-analytics` | manage_settings | B |
| processDesigner → `/process-designer` | manage_settings | C |
| processGovernance → `/process-governance` | manage_settings | C |
| refund → `/refunds` | manage_payments | C |
| service → `/services` | admin; writes manage_services | B |
| settings → `/settings` | admin; PUT manage_settings | C |
| user → `/users` | `authorizeRoles(SUPER_ADMIN)` | B |
| widgets → `/widgets` | admin; per-widget permission inside controller | A (partial) |
| withdrawal → `/withdrawals` | manage_payments | C |

Totals: A = 8, B = 10, C = 14.

**Route-order check (item 1 of the brief), [C]:** every router was read. In each, fixed sub-paths (`/summary`, `/stats`, `/eligible-users`, `/capture-cases`, `/wallet-reservations`, `/reconcile/:doctorId`, `/registry`, `/queue`, `/attention-queue`) are declared before the matching `/:id` or `/:key` route. No ordering defect found. Every router applies `protect` plus `requireAdmin` (or `authorizeRoles(SUPER_ADMIN)`) at router level.

### 1.2 Admin-gated routes outside `/api/admin` (gates read only, depth C)

`financeRoutes` (coupons, subscriptions cancel, reconciliation, payouts, `payments/retry-due`), `refundRoutes` (approve/reject/retry/reconcile/initiate), `paymentRoutes` (`/summary`), `appointmentRoutes` (`/admin/operations`, no-show, resolve), `aiRoutes` and `aiAssistRoutes` (`/admin/*` endpoints), `leadRoutes` (admin limiter), `doctorRoutes` and `doctor/workflowRoutes` (admin approve/reject paths), `invoiceRoutes`, `walletRoutes`. Not audited beyond the gate lines.

### 1.3 Frontend

38 Admin pages in `src/pages/admin/` (plus a test file).

- **Read:** `AdminMissionControl`, `AdminExecutiveActionCenter`, `AdminOperationsCenter`, `AdminDoctors` (load logic), `AdminPatients` (fetch trigger only), `AdminSmartWidgets` with `WidgetGrid`/`WidgetShell`, `AdminExportCenter` (request params only), `RealtimeContext` (sync tick).
- **Grep-scanned:** `setInterval`/`refetchInterval` across `pages/admin`, `components/admin` (if present) and `hooks`. Only three pages poll: MissionControl (15 s), ExecutiveActionCenter (20 s), OperationsCenter (20 s).
- **Not covered:** the other ~30 pages' request patterns and rendering weight; the "heavy frontend components" check (item 4 of the brief) was **not performed**; `AdminDashboard`, `AdminFinanceDashboard`, `FinanceOperations`, `AdminAIInsights` are routed under `/admin` but live outside `src/pages/admin/` and were not located or read.

### 1.4 Remaining modules (needed before this audit can be called complete)

- **M-B:** finance, payments, refunds, withdrawals, capture cases, wallet reservations, plus the section 1.2 financial routes. Highest invariant risk (payment/refund/wallet/ledger).
- **M-C:** process*, automation studio, monitoring, intelligence, workflow engines, integration hub.
- **M-D:** users, permissions, settings, features, CMS (upload path), services, remaining doctor/patient detail and download handlers.
- **M-E:** remaining frontend pages, `adminApi` call sites, the four pages outside `pages/admin`.
- **M-F:** realtime emitter fan-out, cron/background jobs, retention.

---

## 2. Map of audited Admin slices (page → endpoint → controller → data)

| Page | Endpoints | Controller / builder | Collections / queries |
|---|---|---|---|
| Mission Control (poll 15 s) | `GET mission-control/live`, `/alerts`, `platform-health/infrastructure` | `buildMissionControlData` (counts only), `buildSmartAlerts`, platformHealth | OnlineSession, Appointment, Payment, RefundRequest, AIDraft, NotificationDelivery counts; Doctor/RefundRequest/Insurance/MedicalReport `find()` in alerts |
| Smart Widgets | `GET widgets/registry`, `GET widgets/:key` × 14 | `widgetsAdminController` REGISTRY loaders | `buildPlatformOverviewData`, `buildExecutiveDashboardData`, `buildMissionControlData`, `buildSmartAlerts` |
| Executive Action Center (poll 20 s) | `action-center`, `decisions`, `recommendations`, `timeline` | `buildActionCenterData`, `getDecisionCards`, `buildExecutiveRecommendations`, `buildExecutiveTimeline` | overview + executive dashboard builders, unbounded Appointment find with populate, 9 bounded timeline finds |
| Operations Center (poll 20 s) | `operations/queue`, `sla-overview`, `workflow-registry`, `permissions/hierarchy/admins` | `fetchRawOperations` → `attachAssignments` → `paginateQueueItems` | Doctor, RefundRequest, Insurance, MedicalReport, Payment, WebhookEvent, CronRunLog, Appointment, NotificationDelivery, OperationAssignment |
| Operations actions (claim/assign/resolve/…) | `operations/:operationKey/*` (10 handlers) | `findOperationItem` | same full queue build per action |
| Patients | `patients`, `patients/stats`, `patients/:id`, downloads | `patientAdminController` + `buildPatientAggregates` | User + Appointment, Prescription, MedicalReport, Payment, Insurance, FamilyMember; `.distinct("userId")` prefilters |
| Doctors (limit 100) | `doctors`, `doctors/stats`, `doctors/eligible-users` | `listDoctorsAdmin` (aggregate) | Doctor ⟕ users ⟕ appointments |
| Reviews | `reviews`, `/summary`, `/attention-queue`, `/:id`, DELETE | `adminReviewController` | Review (+ populate), doctor rating recalculation |
| Audit | `activity` | `listActivityLogs` | AdminActivityLog (text index, skip/limit, count) |
| Export Center | `exports?resource&format` | `exportData` | 4 datasets, ceiling 5000 rows |
| Command Center | `command-center` | `commandCenterAggregates.buildReputationSnapshot` and other sections | Review (all, populated) |
| Smart Assignment | `assignment/analytics` | `buildAssignmentAnalytics` | OperationAssignment (all) |

---

## 3. Cross-cutting facts established

1. **Single admin tier.** `ADMIN_ROLES = [super_admin]` (`constants/roles.js`). `userHasPermission` returns `true` for `super_admin` before reading the `Permission` collection (`middleware/adminMiddleware.js`). So every `requirePermission(...)` gate is a no-op today and the Permission matrix has no runtime effect. See A-13.
2. **Query-string operator injection is not possible. [L]** Express is 5.2.1 and `app.js` sets no `query parser`. I probed it locally: `?gender[$ne]=x` yields no `gender` value (key stays literal `gender[$ne]`). The sanitizer in `app.js` covers `req.body` and `req.params` only, but that is not a hole under Express 5 defaults.
3. **Repeated query keys become arrays. [L]** `?category=a&category=b` gives `["a","b"]`. Several admin handlers assume strings (A-14).
4. **No server-side caching or in-flight de-duplication** in any admin builder. A grep for cache/ttl in `controllers/admin` and `services/commandCenter` matched only unrelated comments. **[C]**
5. **No `AbortController` or request-sequencing anywhere in `src/api`.** **[C]**
6. **Realtime:** `dashboard:sync` is debounced 300 ms per client (`RealtimeContext.jsx` ~line 124), but 23 admin pages and every `WidgetShell` re-fetch on each tick. **[C]**
7. **No retention/TTL** on AdminActivityLog, OperationAssignment, AutomationRunLog, CronRunLog, NotificationDelivery, WebhookEvent (no `expireAfterSeconds` in those models). Whether that is intentional is an open question (section 8).

---

## 4. Findings

### P0

None confirmed in the audited scope. I found no auth bypass, injection or money-moving defect in the modules marked A/B. P0 cannot be ruled out for modules marked C (especially M-B).

### P1

#### A-01 — Unified Operations Queue reads every open source in full, and every operation action rebuilds the whole queue **[C]**
- **Where:** `controllers/admin/operationsAdminController.js` — `fetchRawOperations()` (line 117; the nine-query `Promise.all` at ~136-167), `attachAssignments()` (401), `getOperationsQueueUnified` (570), `findOperationItem()` (589). Pagination in `services/operationsQueuePagination.js` (`paginateQueueItems`).
- **Evidence:** nine `find()` calls with no `.limit()`: pending Doctors, pending RefundRequests, open Insurance claims, critical unreviewed MedicalReports, failed Payments (7 d), failed WebhookEvents (7 d), failed CronRunLogs (7 d), `Appointment.find({ date: { $gte: today-3d } })` (no upper bound, so all future appointments) with `populate("patientId")`, and unread critical NotificationDelivery. Items are built, filtered and sorted in memory, then `paginateQueueItems` slices an array. `findOperationItem` re-runs the full build and is called from 10 handlers (lines 608, 657, 663, 674, 687, 700, 712, 719, 730, 810). The Operations Center page triggers the list every 20 s per open tab (`AdminOperationsCenter.jsx` ~191), on every filter/page change and on every sync tick.
- **Impact:** DB and CPU cost grows with open work and future bookings, not with page size. The UI looks fast because the payload is paginated. Single-operation actions cost as much as the whole queue.
- **Root cause:** pagination was added at the response layer only (its own header says so); the build was never made incremental.
- **Fix (staged):** (1) resolve a single operation by parsing its key and querying only its source (needs a read of the key format first); (2) `countDocuments` for the `counts`/`byDepartment` stats; (3) per-source `.limit` plus `select`, with a visible "truncated" flag; (4) later, DB-side pagination. Preserve the queue item shape, priorities and SLA rules.
- **Regression test:** pure test with stubbed models asserting `findOperationItem` touches only the matching source; a count-equality test between old and new stats on a fixed fixture.

#### A-02 — Dashboard request fan-out with duplicate heavy computation and no guard **[C]**
- **Where:** `components/widgets/WidgetShell.jsx` (load effect on `[load, dashboardSyncTick]`), `controllers/admin/widgetsAdminController.js` (direct `buildPlatformOverviewData()` calls at lines 41, 54, 67, 81, 117; via `buildExecutiveDashboardData()` at 83, 153, 209; `buildMissionControlData()` at 222), `controllers/admin/executiveActionController.js` (lines 130, 245, 306, 308, 494), `pages/admin/AdminExecutiveActionCenter.jsx` (poll 20 s), `pages/admin/AdminMissionControl.jsx` (poll 15 s).
- **Evidence:** the widgets page mounts up to 14 `WidgetShell`s; each fetches `GET widgets/:key` independently on mount and again on every sync tick. Seven of the 14 loaders run the platform-overview builder (directly at lines 41, 54, 67, 81, 117, or via `buildExecutiveDashboardData` at 153 and 209); the loader at lines 81/83 runs it twice because `buildExecutiveDashboardData` calls it internally (`missionControlAdminController.js:152`). The mission-control loader (222) is count-based and cheap. Per 20 s cycle the Executive Action Center fires four requests that together run `buildSmartAlerts` twice (130, 308) and `buildExecutiveDashboardData` twice (245, 306), each re-running the overview. Mission Control's `setInterval(loadAll, 15000)` has no in-flight guard and does not pause when the tab is hidden.
- **Impact:** load scales with open admin tabs × realtime events × widgets. Slow responses overlap and pile up.
- **Root cause:** each endpoint recomputes shared builders (the code comments describe "reuse" as reusing the function, not its result); there is no memoization layer.
- **Fix:** (1) client: a shared polling hook with an in-flight guard, hidden-tab pause and latest-request-wins; (2) server: short-TTL in-process memoization with in-flight coalescing for `buildPlatformOverviewData`, `buildExecutiveDashboardData`, `buildSmartAlerts` (TTL of a few seconds; single replica assumed, see open questions); (3) optional batched widgets endpoint. Business metrics unchanged.
- **Regression test:** counting-stub test that N concurrent calls to a memoized builder hit the DB once and that results are identical to the unmemoized output; hook test for no overlapping requests.

#### A-03 — Unbounded full-collection reads feeding aggregates **[C]**
- **A-03a Reviews:** `getReviewSummaryAdmin` (`adminReviewController.js:138`) loads every non-deleted review; `buildReputationSnapshot` (`services/commandCenter/commandCenterAggregates.js:127-128`, called from the command-center section at 191) loads every non-deleted review **with a two-level populate** (doctor → user) just to compute a summary and a top-10.
- **A-03b Assignments:** `buildAssignmentAnalytics` (`workflow/assignment/assignmentAnalytics.js:26`, find at 38) runs `OperationAssignment.find({})` and pulls each overlay's embedded `timeline`. Callers: `assignmentAdminController.js:69, 136` and `workflow/intelligence/predictionEngine.js:235`.
- **A-03c Smart alerts:** `buildSmartAlerts` (`missionControlAdminController.js:341-350`) uses `find()` for Doctor, RefundRequest, Insurance and MedicalReport, but only `.length` of the results is used (lines 356-404). It is polled by Mission Control every 15 s and has six other call sites (widgets loader line 198, `executiveActionController.js` 130 and 308, `platformHealthAdminController.js` 277 and 305, `commandCenterAggregates.js` 73).
- **A-03d Silent truncation:** `getReviewAttentionQueueAdmin` (`adminReviewController.js:151-169`) considers only the newest 500 reviews, then slices to 25. A negative unreplied review outside the newest 500 never appears, while the summary KPI counts it.
- **Impact:** memory and DB cost grow with total history; A-03d is a correctness gap (queue disagrees with summary).
- **Fix:** `$group`/`countDocuments` for summaries and alert counts (output-identical); for assignments, aggregate or project without `timeline`; for the attention queue, filter the severe conditions in the query (`rating <= 2` or no reply) with a sort and limit.
- **Regression test:** equivalence tests between `buildReviewSummary(reviews)` and the aggregate result on a fixture; alert-count equivalence with stubbed models; a fixture with 501+ reviews where the oldest is critical.

### P2

#### A-04 — `listDoctorsAdmin` does per-doctor joins before sort/skip/limit **[C]**
- **Where:** `controllers/admin/doctorAdminController.js` `listDoctorsAdmin` (~line 40-215), UI request `AdminDoctors.jsx:104` with `limit: 100`.
- **Evidence:** pipeline order is `$match` → `$lookup users` → `$unwind` → (search `$match` on `user.name/email`, regex, cannot use an index) → `$lookup appointments` (correlated `$count` per doctor) → `$addFields` → `$project` → `$sort` → `$skip` → `$limit`. The appointment count runs for every matching doctor even when the sort is not `activity`. The count pipeline repeats lookup and unwind when searching. After every approve/reject the page re-fetches the full list and stats.
- **Impact:** cost is O(matching doctors) per request regardless of page size. Magnitude depends on doctor count [H].
- **Fix:** resolve search to user ids first (same pattern as `adminReviewController.resolveSearchFilter`); sort/skip/limit before lookups unless sorting by name or activity; count appointments for the page's doctor ids with one `$group`.
- **Regression test:** pipeline-builder test asserting `$limit` precedes the appointments `$lookup`; response-shape test (`appointmentCount`, `pendingDocumentsCount`, `user` fields unchanged).

#### A-05 — Doctor list returns hashed verification-token fields to the browser **[C]**
- **Where:** `doctorAdminController.js:151` (`$project: { appointmentStats: 0, "user.password": 0 }`); `models/User.js` lines 65-83.
- **Evidence:** `User` marks `emailVerificationTokenHash`, `emailVerificationExpiresAt`, `emailVerificationSentAt`, `emailVerificationLastUsedHash` as `select: false`, but aggregation `$lookup` bypasses Mongoose `select`. Only `user.password` is removed, so the rest of the joined user (including those fields and `securityVersion`) is returned in `data.doctors[].user`.
- **Impact:** hashes of one-time tokens and internal fields reach the client. Low exploitability (hash only, super-admin only) but violates data minimization and the schema's intent.
- **Fix:** replace the exclusion with an allowlist (`user.name`, `user.email`, `user.isActive`, `user.createdAt` and whatever the UI actually reads).
- **Regression test:** assert no `emailVerification*` or `password` key in the serialized row. Also check the other `$lookup from "users"` sites (`overviewAdminController.js:211`, `paymentController.js:1326`, `services/finance/financeAggregates.js:255`) — not read, **[H]**.

#### A-06 — Patient filters/stats materialize id sets with `.distinct` and ship large `$in` lists; list loads full history **[C]**
- **Where:** `patientAdminController.js` `resolveAdvancedIdFilters` (55-109), `getPatientStatsAdmin` (236-295), `listPatientsAdmin` line 169; `services/patientAdminAggregationService.js` `buildPatientAggregates` (57-).
- **Evidence:** `.distinct("userId"/"patientId")` over Payment, Appointment, MedicalReport, Insurance, FamilyMember on each stats call and each advanced-filter request; results are intersected in JS and fed back as `_id: { $in: [...] }`. `buildPatientAggregates` loads **all** appointments (with doctor→user populate), prescriptions, reports, payments, insurance and family rows for the page's patients to produce a few counts and dates.
- **Impact:** memory grows with the number of patients having each condition (a distinct result is also capped by the 16 MB BSON limit) and with per-patient history depth. Scale thresholds [H].
- **Fix:** `$group`-count for stats; express advanced filters as aggregation with `$lookup`/`$match` or bounded chunks; aggregate per-patient counts/last/next in the database.
- **Regression test:** equivalence of stats on a fixture; list response shape unchanged.

#### A-07 — `emergencyToday` counts all future appointments **[C], intent needs product confirmation**
- **Where:** `missionControlAdminController.js:168` and 181-183; same pattern in `executiveActionController.js:149`.
- **Evidence:** the query is `Appointment.find({ date: { $gte: today } })` with no upper bound, assigned to `todaysAppointmentsForEmergencyScan`, then filtered by an emergency regex and reported as `emergencyToday`. The read is also unbounded.
- **Impact:** the metric likely overcounts (all future emergency-pattern appointments, not today's) and the read grows with future bookings. This is an existing business metric, so I am not recommending a change until the owner confirms the intended definition.
- **Fix (after confirmation):** add `$lt: tomorrow` if "today" is intended and count with a bounded projection.
- **Regression test:** fixture with emergency appointments today and next week.

#### A-08 — Unstable sort keys with skip pagination **[C]**
- **Where:** patients `sortMap` (`patientAdminController.js:172-177`, `name` / `createdAt`); doctors `sortMap` and `$sort` (`doctorAdminController.js:99-105`: `rating`, `experience`, `appointmentCount`, `user.name`); reviews (`adminReviewController.js:116`, `createdAt`); activity log (`activityAdminController.js:28`, `createdAt`).
- **Evidence:** every sort is single-key with no `_id` tiebreaker. Ties are routine for `rating`, `experience`, `name` and for rows written in the same millisecond. Payments/refunds `sortDir` handlers were not read.
- **Impact:** rows can repeat or disappear between pages; an admin reviewing doctors or patients can miss a record.
- **Fix:** append `_id` in the same direction to every sort.
- **Regression test:** insert tied rows and assert pages 1..n return each id exactly once (Mongo test) or assert the sort object contains `_id` (pure test).

#### A-09 — Stale, duplicate and overlapping admin requests **[C]**
- **A-09a:** `AdminOperationsCenter.jsx` — one effect loads on `[dashboardSyncTick, priority, type, status, debouncedSearch, page]` and another resets `page` to 1 on filter change. When `page != 1`, a filter change fires `load(oldPage, newFilter)` and then `load(1, newFilter)`. `load` has no sequence guard, so whichever response resolves last wins, not the latest request.
- **A-09b:** `AdminMissionControl.jsx` 15 s interval and `AdminExecutiveActionCenter.jsx` 20 s interval have no in-flight guard and no hidden-tab pause; they also refetch on every sync tick.
- **A-09c:** `AdminDoctors.jsx` `loadDoctors` has no stale-response guard (the master-data effects in the same file do use an `active` flag).
- **Impact:** wrong data briefly or permanently shown after fast filter changes; wasted load.
- **Fix:** shared hook (latest-request-wins via sequence id or `AbortController` passed through `src/api/axios.js`), fix the page-reset ordering, visibility pause.
- **Regression test:** jsdom/vitest test with delayed mock responses asserting the last request wins and that a filter change on page 3 issues one request.
- **Note:** `AdminPatients` triggers fetches from an explicit Apply action (URL params), so it does not have a per-keystroke storm.

#### A-11 — No audit trail for admin access to patient medical data **[C]**
- **Where:** `patientAdminController.js` `getPatientWorkspaceAdmin`, `downloadPatientReportAdmin` (437), `downloadPatientPrescriptionAdmin` (443).
- **Evidence:** zero `writeAdminLog` calls in the controller; `utils/fileDownload.js` and `services/pdfDocumentStore.js` also have no logging. Other admin mutations and exports do log.
- **Impact:** no record of which admin viewed or downloaded which patient's reports/prescriptions.
- **Fix:** `writeAdminLog` with action `patient.phi_view`/`patient.report_download`, resource id only (no PHI in metadata), never blocking the response on log failure (same pattern as `deleteReview`).
- **Regression test:** stub `writeAdminLog`, assert it is called with the resource id and no clinical content.

#### A-12 — Thin automated coverage of Admin endpoints **[C], indicative**
- 206 backend tests pass [L], but they are mostly pure-function or stubbed tests. A name-based grep for controller/route references found none for adminReview, export, activity, missionControl, widgets, executiveAction, platformHealth, permission, settings, feature, assignment, commandCenter, overview, withdrawal admin; DB-backed tests exist under `tests/mongo/` but need a reachable MongoDB and were not run. The grep is crude: a test can cover a controller's pure helper without importing its name.
- **Fix:** add the regression tests named in A-01..A-11 as part of each slice; add one HTTP-level permission test per router once the permission model is decided (A-13).

### P3

#### A-13 — Permission layer is inert today and inconsistently applied (latent) **[C]**
- With one admin role (section 3.1) every `requirePermission` passes. If a second admin tier is ever reintroduced, these have no key and would become real gaps: `DELETE reviews/:id`, `PATCH appointments/:id/cancel`, doctor document download, all patient routes and downloads, activity log read, `GET settings`/`features`, mission-control and overview, and `platform-health/operations-queue` (its siblings require `manage_settings`). `permissionAdminRoutes` still exposes a role-permission editor over a model whose enum has no admin tier. `requirePermission` also does a `Permission.findOne` per call on the non-super-admin path (dead today).
- **Fix:** decision first (reintroduce tiers vs. remove/disable the matrix); then align gates. No code change recommended before that decision.

#### A-14 — Array-valued query params cause 500s **[L for array parsing; C for the throw sites]**
- `listServices` (`serviceAdminController.js:76-77`): `req.query.search.trim()` and `req.query.category.trim()` throw `TypeError` when the key is repeated. `activityAdminController.js:10` passes `req.query.search` straight into `$text.$search`.
- **Fix:** a small `asString(query.x)` helper used by list handlers. **Test:** repeated-key request returns 400 (or uses the first value), not 500.

#### A-15 — Review list drops an explicit rating when `sentiment` is also set **[L]**
- `adminReviewController.js:77-80`: `{ ...(filter.rating || {}), $gte: 4 }` spreads a Number (`{...5}` is `{}`), so `rating=5&sentiment=positive` becomes `{ $gte: 4 }` and returns 4★ rows. Verified locally.
- **Fix:** combine with `$and` or intersect bounds. **Test:** `rating=5&sentiment=positive` returns only 5★.

#### A-16 — `deleteReview` is check-then-save and non-atomic **[C]**
- `adminReviewController.js:222-258`: read, check `adminDeleted`, `save()`, then recalculate the doctor rating, then audit log. Two concurrent deletes can both pass the check (duplicate audit entries; the notification is de-duplicated by `eventKey`). If `recalculateAndPersistDoctorRating` throws after the save, the review is hidden, the rating is stale, no audit entry is written and the client gets a 500.
- **Fix:** `findOneAndUpdate({ _id, adminDeleted: { $ne: true } })`, then recalculate in a retry-safe step. **Test:** concurrent double-delete yields one audit entry; recalculation failure still logs.

#### A-17 — Percentile/average math loads every duration row **[C]**
- `process-analytics/processAnalyticsAggregates.js:95` and `monitoring/monitoringAggregates.js:270` fetch `durationMs` for every run in the window and compute in memory. Windows bound the set, not its size. **Fix:** `$group`/`$percentile`-style aggregation or bounded sampling. Low priority until run volume is known [H].

#### A-18 — Activity log scalability and search scope **[C]**
- `activityAdminController.js`: `$text` search covers only `action` and `resourceType` (the text index); skip-based paging plus `countDocuments` on every request; no retention policy. Fine at current scale [H]; revisit with A-08.

#### A-10 — Export dataset quirks **[C]**
- `exportAdminController.js`: the `doctors` and `patients` datasets ignore the `from/to/status` filter object entirely; `minRevenue/maxRevenue` apply `totalAmount` to the appointments dataset; datasets fetch whole documents (up to 5001 rows) and then flatten to six columns. The Export Center UI currently sends only `resource` and `format` (`AdminExportCenter.jsx:71`), so the filter issue is API-only today. CSV formula-injection protection and the 5000-row ceiling with a truncation header are present and correct. **Fix:** add `.select()` projections; reject unsupported filters with 400 or implement them. **Test:** dataset/filter matrix.

---

## 5. Needs runtime verification (nothing here is claimed as fact)

1. `explain("executionStats")` for: Review list sorted by `createdAt` with `adminDeleted: { $ne: true }` (schema shows only `{doctorId, createdAt}` and `{userId, appointmentId}`); User patient list sorted by `name`/`createdAt` with `role: "patient"` (schema shows `{role, isActive}` only); Insurance by `validTill`/`claimStatus`; MedicalReport by `{severity, reviewedAt}`; `OperationAssignment` by `status`/`createdAt`; the doctor aggregation with and without search; `AdminActivityLog` `$text` plus sort.
2. Actual indexes present in the deployed database versus the schema (the repo has migrations; compare, do not assume).
3. Browser network timings: widgets page (count of requests per sync tick), Operations Center with a filter change on page 3 (A-09a), Mission Control with a slow API (overlap), hidden-tab behavior.
4. Load test of `GET operations/queue`, `GET command-center`, `GET widgets/:key` with realistic collection sizes and several concurrent admin tabs.
5. Collection sizes and growth rates for reviews, operation assignments, run logs, notifications (decides how urgent A-03/A-06/A-17/A-18 are).
6. Whether `utils/fileDownload.js` is safe against path traversal for stored `filePath` values (not read).
7. Whether the other `$lookup from "users"` sites project fields (A-05).

---

## 6. Checks actually run

| # | Command (in the extracted repo) | Result |
|---|---|---|
| 1 | `unzip` of the uploaded archive | extracted, no git directory |
| 2 | `cd backend && npm ci --no-audit --no-fund --loglevel=error` | `added 374 packages in 14s`, exit 0 |
| 3 | `cd backend && npm test` (`node tests/run-all.mjs`) | **206 passed, 0 failed (206 total)** (I viewed the last 40 lines; the summary line is authoritative) |
| 4 | Local Express 5.2.1 probe (`/tmp/qp.mjs`) | `?gender[$ne]=x` → no `gender` value; `?category=a&category=b` → array |
| 5 | `node -e` spread check | `{...5, $gte:4}` → `{"$gte":4}` |
| 6 | Source reading and grep scans | as cited per finding |

**Not run / blockers:** frontend `npm ci`, lint, build and vitest; `backend/tests/mongo/*` (`npm run test:mongo`) because it needs a reachable MongoDB and I did not provision or attempt one; `node --check`; any `explain`, load or browser measurement; no production connection of any kind. Large controller files were read by line range, not end to end; findings cite only what was actually displayed.

---

## 7. Prioritized implementation plan (small, independent slices)

Each slice keeps API response shapes, permissions, privacy and payment/refund/wallet/ledger/clinical invariants unchanged and ships its own test. One slice per focused prompt, after review.

| Slice | Scope | Findings | Files (approx.) | Risk |
|---|---|---|---|---|
| S1 | Frontend request hygiene: shared polling/latest-request hook, in-flight guard, hidden-tab pause, fix Operations Center double fetch, apply to the three polled pages, `WidgetShell`, `AdminDoctors` | A-02 (client), A-09 | 1 new hook + 6 pages | Low |
| S2 | `buildSmartAlerts`: `find()` → `countDocuments` (4 sites); output-identical | A-03c | 1 file + test | Low |
| S3 | Reviews: summary and command-center snapshot via aggregation; attention queue filtered in the query; fix rating+sentiment filter | A-03a, A-03d, A-15 | 3 files + tests | Low-Med |
| S4 | Doctor list: allowlist `user` projection (A-05), `_id` tiebreaker, then pipeline reorder (A-04) as a second commit | A-04, A-05, A-08 | 1 file + tests | Med |
| S5 | `_id` tiebreakers on patients, reviews, activity (and payments/refunds after reading them) | A-08 | 3-5 files | Low |
| S6 | PHI access audit logging | A-11 | 1 file + test | Low |
| S7 | Short-TTL memoization with in-flight coalescing for overview, executive dashboard and smart-alerts builders | A-02 (server) | 1 new util + 3 builders | Med (needs replica answer) |
| S8 | Patient stats/filters via aggregation instead of `.distinct` | A-06 | 2 files + tests | Med |
| S9 | Operations queue: single-item lookup, then counts, then per-source limits | A-01 | 1-2 files + tests | Med-High |
| S10 | Assignment analytics aggregation | A-03b | 1 file | Med (confirm all-time vs windowed intent) |
| S11 | Input robustness: `asString` helper, `deleteReview` atomic update, export `.select()` and filter validation | A-14, A-16, A-10 | 4 files | Low |
| S12 | Index proposals from the explain plans (migration with duplicate detection, following the existing migration lifecycle) | section 5 | migration + test | Med |
| S13 | Decision, then code: permission model (A-13) and `emergencyToday` definition (A-07) | A-13, A-07 | design first | — |

Then audit modules M-B through M-F (section 1.4), then Patient and Doctor sides separately as requested.

---

## 8. Close-out

### Top 10 verified findings (priority order)

1. **A-01** Operations queue: nine unbounded reads rebuilt on every poll and on every operation action (P1)
2. **A-02** Dashboard fan-out: 14 independent widget requests per tick, duplicated overview/alert computation, overlapping polls (P1)
3. **A-03** Unbounded reads feeding aggregates (reviews ×2, `OperationAssignment.find({})`, alert counts via `find().length`) and a 500-review truncation of the attention queue (P1)
4. **A-05** Doctor list leaks `emailVerification*` hash fields through `$lookup` (P2)
5. **A-04** Doctor list joins and counts per doctor before paging (P2)
6. **A-06** Patient stats/filters materialize `.distinct` id sets; list loads full history (P2)
7. **A-08** Single-key sorts with skip pagination can repeat or drop rows (P2)
8. **A-09** Stale/duplicate/overlapping frontend requests, including a double fetch on filter change (P2)
9. **A-11** No audit log for admin access to patient reports and prescriptions (P2)
10. **A-07** `emergencyToday` counts all future appointments (P2, intent to confirm)

### Unresolved questions

1. Is `emergencyToday` meant to be today only? (A-07; also `startOfToday()` uses server-local midnight.)
2. Expected volumes: doctors, patients, reviews, operation assignments, run logs.
3. Retention policy for audit, assignment, run-log and notification collections.
4. Is a second admin tier planned? (decides A-13: keep or remove the permission matrix)
5. Single backend replica or several? (decides whether in-process memoization in S7 is acceptable)
6. Where do `AdminDashboard`, `AdminFinanceDashboard`, `FinanceOperations`, `AdminAIInsights` live, and do they poll?
7. Is `fileDownload` safe for stored paths? (not read)
8. What operation-key format does `findOperationItem` receive? (needed for S9 step 1)

### Recommended first implementation slice

**S1 — frontend request hygiene.** It changes no API contract, business metric, permission or financial behavior, it fixes a confirmed wrong-data race (A-09a) and cuts duplicate load (A-02 client side), and it is testable without a database. **S2** is the safest backend follow-up (output-identical refactor).

*Stop here for review. No implementation has been started.*
