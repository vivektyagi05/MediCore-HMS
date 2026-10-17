# CHANGELOG — A6.2.4 — Enterprise Monitoring Platform

## Scope

This phase builds the Enterprise Monitoring Platform on top of the existing
architecture, as instructed:

- Did NOT redesign or rebuild Workflow Engine, Assignment Engine, Automation
  Studio, Workflow Registry, Workflow State Machine, Event Bus, Trigger
  Library, Action Executor, or AI Pipeline. Everything from A6.1 → A6.2.3
  is untouched except one root-cause bug fix (see below) and additive model
  fields.
- Built a real, connected Monitoring Platform layered on real execution data
  that already existed but had no cross-flow observability surface:
  `AutomationRunLog` (Phase A6.2.3), `CronRunLog` (Phase A5.2), and
  `AutomationFlow.stats` (Phase A6.2.3).

The brief this phase was scoped from (12 modules: Monitoring Dashboard,
Execution Explorer, Execution Inspector, Execution Timeline, Retry Center,
Dead Letter Queue, Workflow Health Center, Performance Intelligence, Failure
Intelligence, Dependency Graph, Realtime Monitoring, Monitoring AI) is a much
larger brief than one additive phase can honestly deliver without
fabricating data this codebase doesn't have. Every module below is either
delivered with real backing data, or delivered against a real substitute
concept, or explicitly deferred — see "Deferred / Reframed" at the bottom.
Nothing here invents a metric, a status, or a mechanism that doesn't exist.

## Step 1 — Audit findings

1. **Root-cause bug (pre-existing, not introduced by this phase):**
   `automationFlowExplain` and `automationFlowAdvisor` (Phase A6.2.3) were
   fully wired end-to-end — `promptLibrary.js` entries, `generativeAssistant.js`
   wrapper functions, controller endpoints (`GET /flows/:id/ai-explain`,
   `/ai-advisor`), routes, and frontend calls/UI panels all existed — but
   **no renderer function was ever written for either `promptKey`, and
   neither was registered in `templateProvider.js`'s `RENDERERS` map**.
   Every real call to those two endpoints has always thrown
   `No template renderer registered for promptKey: ...` and returned a 500.
   Fixed by writing both renderers, grounded only in the real flow fields
   already passed as context, and registering them.
2. **No cross-flow execution view existed.** `automationStudioController.
   getFlowRunHistory` / `getFlowInspector` only ever queried one `flowId` at
   a time. `getStudioHome`'s `recentRuns`/`topFlowsByRuns` were a small
   dashboard slice, not a searchable/filterable/paginated explorer. This is
   the real gap Execution Explorer fills.
3. **No global flow/job health ranking existed.** Per-flow `stats` were only
   ever rendered one flow at a time (in the flow inspector). No page ranked
   all flows by success rate/runtime, and `CronRunLog` had no cross-job
   aggregate view at all (Platform Health Center only ever showed per-job
   cards, not a ranked table).
4. **No performance/failure aggregate views existed** — runtime
   distribution, hourly peak, trigger/action distribution, and
   failure-pattern grouping were never computed anywhere.
5. **A real, pre-existing retry/dead-letter concept was found and was the
   honest substitute for the brief's "Retry Center"/"Dead Letter Queue":**
   `Payment.retryCount` / `nextRetryAt` / `failedAt`, written by
   `payments/webhookHandler.js#scheduleFailedPayment` and read by the
   standalone `retryFailedPayments` cron
   (`backend/payments/paymentRetryService.js`). This is a real queue with a
   real exhaustion threshold (`MAX_RETRIES = 3` in `paymentRetryService.js`)
   — nothing about it needed to be invented. **Observed but explicitly not
   fixed** (out of scope for an additive monitoring phase, and touching it
   would violate this phase's own "additive only" rule for an unrelated
   payment engine): `scheduleFailedPayment` only bumps `retryCount`/
   `nextRetryAt` — it never actually re-attempts the gateway call, and
   `Payment.lockedAt` is defined on the schema but never set or read
   anywhere. This is a real gap in the pre-existing retry mechanism,
   documented here for a future phase, not fabricated or silently fixed.
6. **AutomationFlow runs have no retry, queue, pause, or cancel concept.**
   `actionExecutor.js` executes a flow's actions synchronously and
   sequentially, one shot, no re-attempt logic anywhere. The brief's
   generic "Retrying"/"Dead Letter"/"Paused"/"Cancelled" execution statuses
   for a flow run are not real states this codebase has — see "Deferred /
   Reframed" below for how this was honestly resolved instead of faked.
7. **Flow actions have no branching/parallel structure.** `AutomationFlow.
   actions` is a flat, ordered array; `actionExecutor.js` runs them one at a
   time. The brief's "Execution Graph" is therefore honestly a sequential
   timeline, not a branching DAG.
8. **Flows have no inter-flow dependency edges.** The brief's "Dependency
   Graph" (cycle detection, impact analysis across flows) has no real graph
   to analyze — flows only share a `triggerType`, they never reference each
   other. Reframed as a real "Trigger Fan-out" view instead.

## Backend (additive only)

- `backend/monitoring/monitoringAggregates.js` — new module, pure
  builder functions only (no req/res), each doing its own real DB read:
  `buildLiveCounters`, `buildExecutionKPIs`, `buildPaymentRetryQueue`,
  `buildFlowHealthRanking`, `buildCronHealthRanking`,
  `buildPerformanceIntelligence`, `buildFailureIntelligence`,
  `buildDependencyFanout`, plus two pure/unit-tested helpers `percentile`
  and `buildTimelineFromRun`.
- `backend/controllers/admin/monitoringController.js` +
  `backend/routes/admin/monitoringRoutes.js`, mounted at
  `/api/admin/monitoring` in `app.js`. Reuses the existing
  `requireAdmin` / `requirePermission("manage_settings")` gate — **no new
  roles or permissions**, same discipline as every prior
  Operations/Workflow/Assignment/Automation-Studio phase.
- `backend/ai/promptLibrary.js` / `generativeAssistant.js` /
  `providers/templateProvider.js` — 5 new grounded AI capabilities
  (`executionExplain`, `failureExplain`, `performanceAdvisor`,
  `workflowHealthAdvisor`, `retryAdvisor`), each fed only real,
  server-refetched data by `monitoringController.js`. Plus the
  `automationFlowExplain`/`automationFlowAdvisor` renderer fix (see Audit
  Finding 1).
- `backend/models/Payment.js` — additive fields `retryResolvedAt` /
  `retryResolvedBy`, letting an admin mark one exhausted-retry payment
  reviewed from the Retry Queue without inventing a fake "replay" action
  this codebase has no real gateway-retry path to back.
- `backend/models/AutomationRunLog.js` / `CronRunLog.js` — one additive
  index each (`{status, createdAt/startedAt}`) for the new cross-flow/
  cross-job queries; nothing else changed.

### New endpoints (all under `/api/admin/monitoring`, `manage_settings`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/overview` | Monitoring Dashboard KPIs |
| GET | `/overview/ai-summary` | AI Health Summary (workflowHealthAdvisor) |
| GET | `/executions` | Execution Explorer (search/filter/paginate flow or cron runs) |
| GET | `/executions/:id` | Execution Inspector detail + derived timeline |
| GET | `/executions/:id/ai-explain` | AI Execution Explain |
| GET | `/flow-health` | Flow Health Center ranking |
| GET | `/cron-health` | Cron Health ranking |
| GET | `/performance` | Performance Intelligence |
| GET | `/performance/ai-advisor` | AI Performance Advisor |
| GET | `/failures` | Failure Intelligence |
| GET | `/failures/ai-explain` | AI Failure Explain |
| GET | `/dependency-fanout` | Trigger fan-out view |
| GET | `/retry-queue` | Real Payment retry-window + dead-letter split |
| GET | `/retry-queue/ai-advisor` | AI Retry Advisor |
| POST | `/retry-queue/:paymentId/resolve` | Mark a dead-letter payment reviewed (audited) |

## Frontend

- `src/api/monitoringApi.js` — new API client, same per-feature-file
  convention as `automationStudioApi.js`.
- `src/components/admin/MonitoringExecutionDrawer.jsx` — Execution
  Inspector, right-side drawer (same pattern as
  `OperationsWorkspaceDrawer.jsx`), shows real timeline + AI explain.
- `src/pages/admin/AdminMonitoringPlatform.jsx` — one connected hub page at
  `/admin/monitoring` with 7 internal tabs (Dashboard, Execution Explorer,
  Flow & Cron Health, Performance, Failure Intelligence, Payment Retry
  Queue, Dependency Fan-out) — "everything connected, not separate pages"
  per the brief, same choice `AdminAutomationStudio.jsx` made. Reuses
  `dashboardSyncTick` from `RealtimeContext` for realtime refresh — **no new
  sockets**. Reuses `MiniBarChart` from `FinanceCharts.jsx` — no new chart
  library added.
- Nav entry added to `src/config/navigation.js` ("Monitoring Platform").
  Route added to `AppRoutes.jsx`. Cross-links added from
  `AdminAutomationStudio.jsx` header and `AdminDashboard.jsx` Quick Actions.

## Security

- Every route reuses `protect` + `requireAdmin` +
  `requirePermission("manage_settings")` — identical to every other
  Operations/Workflow/Assignment/Automation-Studio surface. No new roles.
- The one write action (`resolveDeadLetterPayment`) is audited via
  `writeAdminLog` with `severity: "warning"`, same as every other
  admin resolve action in this codebase.

## Performance

- All aggregates use MongoDB aggregation pipelines (`$group`, `$facet`-style
  parallel `Promise.all`) instead of loading full collections into memory.
- Execution Explorer is paginated (`page`/`limit`, capped at 100) with
  `.lean()` reads and the two new indexes above.
- No new duplicated queries — flow/cron health reuses `AutomationFlow.stats`
  and `CronRunLog` directly rather than recomputing anything
  `automationStudioController.js` or `platformHealthAdminController.js`
  already compute for their own pages.

## Deferred / Reframed (documented, not fabricated)

- **Retry Center / Dead Letter Queue** → reframed as the real **Payment
  Retry Queue** (`Payment.retryCount`/`nextRetryAt`, `MAX_RETRIES=3`). A
  generic AutomationFlow-run retry/dead-letter concept is NOT built — flow
  runs are synchronous and one-shot with no queue, retry, pause, or cancel
  semantic anywhere in `actionExecutor.js`/`automationEventBus.js`.
- **Replay** (brief's Dead Letter Queue action) — not built. This codebase
  has no real gateway-retry call to replay; `scheduleFailedPayment` only
  ever bumps metadata (see Audit Finding 5). Faking a "replay" button would
  be inventing behavior. The real available action — mark reviewed — is
  what's built.
- **Execution Graph** → delivered as a sequential **Execution Timeline**,
  not a branching DAG. This codebase's actions run strictly in order; there
  is no branching/parallel-action concept to visualize as a graph.
- **Dependency Graph / Cycle Detection / Impact Analysis** → delivered as a
  **Trigger Fan-out** view (which published flows subscribe to which real
  trigger). Flows have no dependency edges on each other, so there is no
  real cycle to detect or impact chain to analyze.
- **Live/Waiting/Retrying/Dead Letter/Paused/Cancelled as generic
  execution-level KPI statuses** — not built as flow-run statuses (no real
  data backs them at that granularity). The Monitoring Dashboard's live
  counters use this codebase's real run statuses (success/failed/skipped)
  plus a real in-flight cron count.
- **Command Palette integration** — no command palette exists anywhere in
  this codebase (confirmed again this phase); deferred, same as A6.2.3's
  own deferral note.
- **Keyboard shortcuts** — deferred; no existing pattern to extend.
- **True list virtualization** — deferred in favor of server-side
  pagination (25/page, cap 100), which is sufficient at this codebase's
  real data volumes and avoids adding a virtualization library.
- **AI Root Cause (Dead Letter Queue)** — folded into the existing
  `retryAdvisor` capability (aggregate-level) rather than a sixth
  near-duplicate prompt, same "don't fragment into near-duplicates"
  discipline as A6.2.3's `automationFlowAdvisor`.
- **Fixing `scheduleFailedPayment`'s missing real gateway retry / unused
  `lockedAt` field** (Audit Finding 5) — explicitly deferred to a future
  phase scoped to the payment retry engine itself. Fixing it here would be
  scope creep beyond an additive monitoring layer and would touch a system
  this phase was told to only observe, not rebuild.
