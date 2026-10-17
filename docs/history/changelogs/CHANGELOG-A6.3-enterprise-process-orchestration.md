# Phase A6.3.1 + A6.3.2 — Enterprise Process Registry & Orchestration Core + Cross-System Integration Hub

## Audit findings (before any code was written)

Read in full: workflowRegistry.js, workflowEngine.js, workflowStateMachine.js,
workflowEvents.js, policies.js (A6.2.1); assignmentEngine.js and the rest of
`workflow/assignment/` (A6.2.2); triggerRegistry.js, automationEventBus.js,
actionExecutor.js, conditionEvaluator.js (A6.2.3); monitoringAggregates.js
and monitoringController.js (A6.2.4); the full `workflow/intelligence/`
module (A6.2.5); operationsAdminController.js (A6.1); the AI pipeline
(promptLibrary.js / generativeAssistant.js / templateProvider.js /
textGenerationProvider.js); every admin controller/route under
`controllers/admin/` and `routes/admin/`; the shared realtime layer
(notificationEmitter.js, roomManager.js); and the frontend routing/nav
pattern (AppRoutes.jsx, AdminDashboard.jsx quick actions, AdminWorkflowEngine.jsx/
AdminMonitoringPlatform.jsx/AdminWorkflowIntelligence.jsx as the closest
precedent for "one connected hub page with internal tabs").

Key finding: **there was no existing "Process Registry" or "Integration Hub"
concept anywhere in this codebase**, but almost everything the mission brief
asks for already exists in pieces:
- The 10 real Operation Registry types (workflowRegistry.js) are already a
  process catalog for the lifecycle-shaped workflows.
- The 14 real automation triggers (triggerRegistry.js) already describe
  "trigger sources/events" for a subset of processes.
- A6.2.4's `buildDependencyFanout` already computes trigger → flow fan-out.
- Every "integration" the brief describes (Patient → Appointment → Doctor →
  … → Admin) is really just the `dependencies` a process already has on
  another module, expressed informally in comments across many files but
  never centralized.

So this phase's job was **consolidation and generation**, not invention: one
new Process Registry that is the superset of everything above (reusing the
10 workflow types live, never copying them), plus read-only
orchestration/graph/integration layers that are pure derivations over that
registry and the real signals every prior phase already computes.

## What was built

### Part 1 — Enterprise Process Registry (`backend/process/processRegistry.js`)
- Re-exports the 10 existing Operation Registry types verbatim via
  `listWorkflowDefinitions()` (never copy-pasted — a change to
  workflowRegistry.js flows through automatically).
- Adds 8 new real process entries with a verified `realImplementationMapping`
  for each: Patient Registration, Appointment Journey, Prescription
  Lifecycle, AI Draft Approval, Automation Flow, Workflow Assignment,
  Payment Retry, Notification Delivery, Analytics Generation, Monitoring
  Execution, Workflow Intelligence.
- Adds one documented **composite** entry, `admin_approval` — the brief lists
  "Admin Approval" as its own process, but there is no independent engine
  for it; it is a named grouping over doctor_verification/refund_request/
  insurance_claim's real approval actions. It has no entry points and the
  Orchestration Engine explicitly refuses to plan it (see Deferred).
- `parentProcesses`/`childProcesses` are *computed*, not hand-maintained
  twice, from each entry's own `dependencies` array — the same drift risk
  A6.2.2's audit found with duplicated eligibility checks, avoided here by
  construction.
- `backend/process/processHealth.js` computes a REAL health score per
  process — reusing A6.1's live unified queue (for the 10 workflow types),
  A6.2.4's flow/cron health ranking, and Payment.retryCount (for
  payment_retry). Every other process honestly reports "no dedicated live
  signal — defaulting to baseline 100" rather than a fabricated number.

### Part 2 — Process Orchestration Engine (`backend/process/orchestrationEngine.js`)
- **Never executes anything.** Contains zero writes and zero calls into
  workflowEngine/automationEventBus/assignmentEngine. It only reads the
  registry, the real state machine (workflowStateMachine.js), the real
  policy engine (policies.js), and A6.2.4's dependency fan-out to produce a
  read-only coordination *plan*: prerequisites, execution mode (sequential
  vs parallel-prerequisites, inferred from real dependency structure —
  never guessed), approval gates, timeout policy (the real SLA_TARGET_MS
  table), and rollback/retry flags carried from the registry.
- `listOrchestrationRules()` documents "who calls whom" for every process by
  walking real dependency edges — text an admin (or the AI advisor) can
  read, not a new capability.

### Part 3 — Cross-System Integration Hub (`backend/process/integrationHub.js`)
- **NO STATIC JSON.** Every integration edge is discovered by walking
  `PROCESS_DEFINITIONS.dependencies` at request time
  (`discoverIntegrationEdges()`). Change a dependency in the registry and
  the graph changes with it — nothing to keep in sync by hand.
- Health per edge reuses `processHealth.js` for both endpoints (never a
  second computation) and reports the weaker side.
- Connected/disconnected modules reuse A6.2.4's real trigger fan-out
  (`buildDependencyFanout`) — no second notion of connectivity invented.

### Part 4 — Event Orchestration (`backend/process/eventOrchestration.js`)
- **NO SECOND EVENT BUS.** Reads the one shared `workflowEventBus`
  (workflow/workflowEvents.js, confirmed reused as-is by
  assignmentEvents.js) plus the automation trigger catalog to build an
  Event Registry.
- "Correlation ID" is honestly reframed: this codebase has no normalized
  cross-model correlation field, so `getEventTrace(sourceId)` reuses the
  EXACT sourceId-derivation convention `automationEventBus.js` already
  applies to its own trigger payloads, matched against
  AutomationRunLog/NotificationDelivery/OperationAssignment/AIDraft.
- Dead/Failed/Replay/Retry queues reuse AutomationRunLog, CronRunLog,
  WebhookEvent, and A6.2.4's Payment retry queue — every item points back to
  the one real place it can already be actioned (Automation Studio rerun,
  Monitoring's resolveDeadLetterPayment) rather than a new generic replay
  executor.

### Part 5 — Process Graph (`backend/process/processGraph.js`)
Dependency / Execution / Approval / Automation / Integration / Failure /
Impact graphs — every one a pure derivation over the registry + the real
orchestration/integration/health modules above. Nothing hand-authored.

### Part 6 — Process Explorer UI (`AdminProcessOrchestrator.jsx`, `/admin/process-orchestrator`)
Registry search/filter + detail panel, Dependency Graph (dependency-free SVG,
same posture as FinanceCharts.jsx — no graph library in package.json),
Orchestration rules + per-process plan + AI advisor, Impact Analysis +
cross-system Trace. Realtime via the existing `dashboardSyncTick` — no new
sockets.

### Part 7 — Integration Hub UI (`AdminIntegrationHub.jsx`, `/admin/integration-hub`)
Integration Health list + AI explain, auto-discovered Integration Graph,
Connected/Disconnected modules, Dead & Failed Events (last 7 days).

### Part 8 — AI
The brief lists 8 capabilities (processExplain, integrationExplain,
dependencyExplain, processAdvisor, integrationAdvisor, orchestrationAdvisor,
impactAnalysis, workflowTrace). Following this project's own established
convention (A6.2.3 collapsed 6 asks into 2 prompts; A6.2.5 explicitly
declined 3 near-duplicate prompts), these are covered by **4** real, grounded
prompts wired through the existing pipeline (promptLibrary.js →
generativeAssistant.js → templateProvider.js), never a second AI system:
- `processExplain` — folds in `dependencyExplain` (a process's own registry
  entry already contains its dependencies — no separate data source).
- `integrationExplain`
- `orchestrationAdvisor` — folds in `processAdvisor` + `integrationAdvisor`
  (both ask for admin-level recommendations over data this phase's engines
  already produce).
- `impactAnalysis` — folds in `workflowTrace` (a trace over the dependency
  graph IS impact analysis).

### Parts 9–11 — Backend / Frontend / Security
Additive-only backend (`backend/process/*.js`, one thin controller + one
route file per UI page, mounted at `/api/admin/process` and
`/api/admin/integrations`). Frontend follows the "one connected hub with
internal tabs" pattern (AdminMonitoringPlatform.jsx/
AdminWorkflowIntelligence.jsx precedent), reusing `Card`/`Button`/`Loader`/
`EmptyState` and a new shared `DependencyGraphSvg` component (dependency-free
SVG, following FinanceCharts.jsx's own established "no charting library"
convention). Security reuses the existing `protect`/`requireAdmin`/
`requirePermission("manage_settings")` middleware — no new roles or
permissions were introduced.

## Real bugs / gaps found during the audit (documented, not silently fixed
where out of scope)
- No pre-existing bug was found in the reused modules this phase touched
  (processHealth.js, orchestrationEngine.js, integrationHub.js, and
  eventOrchestration.js are all net-new files with no prior behavior to
  regress).
- One genuine fragility was found and fixed **within this phase's own new
  code only**: a latent circular-import risk between
  `operationsAdminController.js` and `workflow/assignment/assignmentEngine.js`
  (through `generativeAssistant.js` → `patientWorkflowController.js` →
  `automationEventBus.js` → `actionExecutor.js` → `assignmentEngine.js` →
  back to `operationsAdminController.js` for its `_internal` export). The
  running app never hits this because `app.js` always loads
  `operationsAdminRoutes.js` before `assignmentAdminRoutes.js`, but a new
  module reaching `operationsAdminController.js` first (as
  `processHealth.js` does) can trigger it. Fixed by making
  `processHealth.js`'s import of `_internal` dynamic (`await
  import(...)` inside the function that needs it) — a change confined to
  this phase's own new file, not to any pre-existing controller.

## Explicitly deferred (documented, not fabricated)
- **Webhook replay**: no webhook-replay endpoint exists anywhere in this
  codebase. `listDeadAndFailedEvents()` reports failed webhooks honestly
  with `replayVia: "No webhook-replay endpoint exists ... (documented gap)"`
  rather than inventing one.
- **Cron rerun**: no manual cron-rerun endpoint exists; failed cron jobs are
  reported with a note that they wait for their next scheduled run.
- **`admin_approval` as an executable process**: intentionally has no entry
  points and no orchestration plan of its own — building one would
  duplicate doctor_verification/refund_request/insurance_claim's real
  resolve actions, which the mission's own stop conditions forbid.
- **True live network "latency" per integration**: this codebase has no
  request-timing instrumentation between internal modules (everything is
  in-process function calls, not network hops), so "latency" is reported as
  the real health/status signal instead of a fabricated millisecond figure.
- **A second, generic cross-model correlation ID column**: not added to any
  model. The trace reuses the existing informal sourceId convention instead
  of introducing a schema migration across many models for this phase.

## Verification

- `node --check` clean on every backend file in the repo (not just new/
  edited files).
- Full server boot clean: `ECONNREFUSED` only (no live MongoDB in this
  sandbox — same as every prior phase).
- Backend tests: **22/22 passing** (21 pre-existing + 1 new
  `tests/processRegistry.test.mjs` covering registry integrity — no
  duplicate ids, no dangling dependency edges, the 10 workflow types present
  verbatim, composite entries never executable, integration-edge count
  matches the dependency graph 1:1, real impact-graph traversal, and the
  sourceId-derivation convention).
- `npx eslint .` (whole repo, root config): **0 errors, 0 warnings**.
- `npm run build` (frontend): clean, with `AdminProcessOrchestrator` and
  `AdminIntegrationHub` chunks confirmed in `dist/assets`.
- Routes mounted: `/api/admin/process/*`, `/api/admin/integrations/*` in
  `app.js`; frontend routes `/admin/process-orchestrator` and
  `/admin/integration-hub` in `AppRoutes.jsx`; nav entries added to
  `AdminDashboard.jsx` Quick Actions; cross-link added from
  `AdminWorkflowEngine.jsx` ("Open Process Orchestrator →").
- No duplicate controllers/APIs/EventEmitter/AI pipeline/Workflow Engine —
  confirmed by the audit above and by `tests/processRegistry.test.mjs`'s own
  assertion that the 10 workflow types are adapted from `workflowRegistry.js`
  (`_fromWorkflowRegistry: true`), not re-authored.

## Deliverable
`MediCore-HMS-enterprise-process-orchestration.zip` +
`CHANGELOG-A6.3-enterprise-process-orchestration.md` (this file).
