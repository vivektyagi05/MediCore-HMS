# Phase A6.1 — Unified Operations Queue (Hospital Operations Center)

## 1. Audit Report

**Read before writing anything:** `missionControlAdminController.js` (`buildSmartAlerts`),
`platformHealthAdminController.js` (`buildOperationsQueue`, `buildOperationalHealth`,
`buildInfrastructureStatus`), `executiveActionController.js` (`buildActionCenterData`,
`buildExecutiveTimeline`), `widgetsAdminController.js`, `commandCenterController.js`
(`riskLevelFor`, `slotStartMinutes`), every admin controller/route under
`backend/controllers/admin` and `backend/routes/admin`, the models `Doctor`, `RefundRequest`,
`Insurance`, `MedicalReport`, `Payment`, `WebhookEvent`, `CronRunLog`, `Appointment`,
`NotificationDelivery`, `AdminActivityLog`, `Permission`, `User`; the frontend pages
`AdminOperationsCenter.jsx`, `AdminMissionControl.jsx`, `AdminExecutiveActionCenter.jsx`,
`AdminPlatformHealth.jsx`, `src/config/navigation.js`, `adminApi.js`, `RealtimeContext.jsx`.

### What existed (and the real duplicated queue)
- `buildSmartAlerts()` (A5.1) — real, condition-based **aggregate** alerts (counts only, no
  per-item id), consumed by the Executive Dashboard / Mission Control KPI cards.
- `buildOperationsQueue()` (A5.2) — reused `buildSmartAlerts()` and added three more aggregate
  entries (automation failures, delayed appointments, failed payments today). This function
  powered the `/admin/operations-center` page and **was** the duplicated queue this brief asks
  to consolidate: an admin could see "12 delayed appointments" but could not open, claim, assign,
  or resolve any single one of them from that page.
- `buildActionCenterData()` (A5.3) — enriches the same aggregate alerts with
  owner/reason/impact/recommendedAction/deadline for the Executive Action Center page.
- No assignment, claim, escalation, SLA, or per-item workspace existed anywhere in the codebase.
- No cross-module "related operations" linking existed.

### Decision
Rather than adding a fourth aggregate summary, this phase builds the ONE real, per-item,
actionable queue every prior aggregate was standing in for. `buildSmartAlerts` and
`buildActionCenterData` are left completely untouched — they remain the Executive
Dashboard/Action Center's summary widgets, a different surface than the operational work queue
this phase replaces on the Operations Center page (same route, same nav entry, no duplicate
page). Every item in the new queue is a real source document — never a synthesized count — and
every priority/SLA threshold either reuses one already established elsewhere in this codebase
(2-day doctor verification, 7-day refund, 14-day insurance expiry, the Command Center's
risk/delay rules) or is a small, explicitly documented extension of it.

## 2. Business Rules (Priority Engine + SLA Engine)

| Type | Priority rule | SLA target |
|---|---|---|
| doctor_verification | medium; high once pending 2+ days | high: 24h, medium: 3d |
| refund_request | medium; critical once pending 7+ days | critical: 4h, medium: 3d |
| insurance_claim | medium (submitted/in_review); high if expiring within 14 days | high: 24h, medium: 3d |
| critical_report | always critical | 4h |
| payment_failure | medium | 3d |
| webhook_failure | always high | 24h |
| automation_failure | always high | 24h |
| delayed_appointment | medium; high once 1+ full day delayed | 24h / 3d |
| emergency_patient (high-risk today) | always high | 24h |
| unread_executive_alert | always critical | 4h |

SLA state is computed from real `createdAt` + the target above: `overdue` (past deadline),
`at_risk` (within 25% of the deadline), `on_track`, or `completed` (once resolved/cancelled).
Served live via `GET /api/admin/operations/business-rules`.

## 3. Architecture

- **Operation Registry** (`operationsAdminController.js`, `fetchRawOperations`) — one function
  per real source collection, each normalized through `buildOperationItem` into one shared
  `OperationItem` shape (id, type, priority, severity, owner, department, status, createdAt,
  deadline/SLA, businessImpact, patient, doctor, source, reason, recommendedAction,
  resolutionRoute, related operations).
- **Shared Queue** (`buildUnifiedQueue`) — filters (type/priority/status/department/assignedTo/
  search), pinned-first sort, priority sort, counts, department breakdown.
- **Shared Workspace** (`getOperationDetail`) — full item + merged timeline + real
  `AdminActivityLog` entries for the same `resourceId` + related operations for the same
  patient/doctor.
- **OperationAssignment model** (new) — the only new schema this phase introduces: a thin
  overlay for assign/claim/escalate/resolve/cancel/pin lifecycle + timeline, keyed by a stable
  `type:sourceId` operationKey. It never duplicates source data — every field the queue displays
  besides lifecycle state is read live from the real source document.
- **No duplicated logic**: Doctor verification/refund approval/report review still happen on
  their existing pages via their existing endpoints — the workspace's resolution button links
  there rather than re-implementing the action.

## 4. Backend Changes

- New: `backend/models/OperationAssignment.js`
- New: `backend/controllers/admin/operationsAdminController.js`
- New: `backend/routes/admin/operationsAdminRoutes.js`, mounted at `/api/admin/operations` in
  `app.js`
- Extended (additive) `backend/ai/promptLibrary.js`, `backend/ai/providers/templateProvider.js`,
  `backend/ai/generativeAssistant.js` with one new grounded prompt: `operationSummary`

## 5. Frontend Changes

- Rebuilt `src/pages/admin/AdminOperationsCenter.jsx` **in place** (same route
  `/admin/operations-center`, same nav entry "Operations Center") into the Operations Inbox:
  search, priority/type/status filters, group-by (priority/department/status), SLA/priority
  badges, pin indicator, click-to-open workspace.
- New `src/components/admin/OperationsWorkspaceDrawer.jsx` — right-side drawer (never navigates
  away): summary, business impact, recommended action, related operations, AI operation summary,
  quick actions (claim/release/pin/assign/escalate/resolve/cancel), timeline.
- Extended `src/api/adminApi.js` with the new operations endpoints.

## 6. AI Changes

One new capability, `operationSummary`, added through the **existing** pipeline (promptLibrary →
templateProvider → generativeAssistant) — no new AI system, no new provider. Grounded only in
the real operation item fields the controller re-fetches server-side (type, priority, reason,
business impact, SLA state, elapsed time, related-operation count).

## 7. Realtime Changes

None new. The Operations Inbox reuses the existing `dashboardSyncTick` refetch pattern and the
existing 20-second polling interval already used by this page and its siblings — no new socket
event, no new emitter.

## 8. Security

- All new routes require `protect` + `requireAdmin` + `requirePermission("manage_settings")` —
  the exact same permission key already used by the Platform Health Center and Executive Action
  Center. No new roles or permission keys were introduced.
- Assign/escalate targets are validated against `ADMIN_ROLES` server-side (cannot assign to a
  non-admin user).
- Every mutating action writes to the existing `AdminActivityLog` via `writeAdminLog`.

## 9. Performance

- `fetchRawOperations()` issues all 9 source queries via a single `Promise.all` — no serial
  querying, no N+1.
- Assignment overlays are fetched in one bulk `$in` query against the current page's operation
  keys, not per-item.
- Related-operations and grouping are computed in-memory over the already-fetched list — no
  additional queries per item.

## 10. Verification

- `node --check` clean on every backend file (whole `backend/` tree, not just new files).
- All 17 pre-existing backend tests still passing unchanged (`node tests/run-all.mjs`).
- Server boots cleanly (`ECONNREFUSED` only — no live MongoDB in this sandbox, consistent with
  every prior phase).
- `npx eslint .` (root config, covers both `backend/**` and `src/**`): **0 errors, 0 warnings**.
- `npm run build`: clean production build; `AdminOperationsCenter-*.js` chunk confirmed rebuilt
  in `dist/assets` at a larger size than before, confirming the new drawer/filters bundled in.
- Vitest (`api.test.js`) remains unrunnable in this sandbox (`mongodb-memory-server` cannot
  download its MongoDB binary — network-restricted) — unchanged from every prior phase, never
  claimed passing.

## 11. Deferred Items (documented, not fabricated)

- **Bulk selection / bulk actions** on the Operations Inbox (Step 3 of the brief) — the
  single-item workspace and quick actions are built; a multi-select bulk-assign/-resolve bar is
  a real, disclosed gap for a future slice.
- **Saved Views** — no user-preference storage for filter presets exists in this codebase yet;
  the filter bar itself is fully functional, but "save this view" is deferred.
- **AI Risk Summary / Escalation Summary / Resolution Suggestions as four separate AI variants**
  (Step 12 names four distinct outputs) — implemented as one grounded `operationSummary` call
  that returns a summary + risk note + resolution suggestion together, since no distinct trigger
  or data source justifies four separate prompt keys yet (same reasoning documented in
  A5.3's deferred items for `executiveBrief` variants).
- **Full multi-hop cross-module drill-down chains** — the workspace shows related operations and
  links one hop to their existing pages; deeper chained navigation is unchanged from A5.3.
- **webhook_failure / payment_failure "auto-clear on retry"** — these are historical failure
  records with no natural terminal state, so they rely on the manual Resolve/Cancel action
  rather than disappearing automatically; documented here rather than fabricating a reconciliation
  signal that doesn't exist in the data model.

## 12. Implementation Summary

Built the Unified Operations Queue: one real Operation Registry across 10 genuine pending-
workflow types, a documented deterministic Priority Engine and SLA Engine, an assignment/
lifecycle overlay (`OperationAssignment`) reusing the existing Permission/role model, a workspace
drawer that never navigates away, cross-module related-operation linking, one new grounded AI
capability via the existing pipeline, and full reuse of existing realtime/audit/permission
infrastructure. The previous duplicated aggregate queue on this same page has been replaced in
place — nothing was rebuilt from scratch, nothing was duplicated.
