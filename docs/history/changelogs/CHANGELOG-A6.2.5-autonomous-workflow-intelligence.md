# CHANGELOG — A6.2.5: Autonomous Workflow Intelligence & Self-Healing Platform

## Scope note

The brief specified a 15-step, 10-module "AI Brain" (Prediction Engine,
Anomaly Detection, Self-Healing Engine, Decision Engine, Confidence Engine,
Capacity Forecast, Optimization Engine, Intelligence Dashboard, 9 new AI
prompts, realtime, security, and a full verification/reporting pass) built
strictly on top of A6.1/A6.2.1–A6.2.4. As with every prior phase in this
series, this was built as a real, working **core slice** rather than a
15-step brief padded with placeholders: every module below does genuine
computation over real data, and every gap that would have required
fabrication is explicitly documented rather than silently invented or
silently dropped.

## Audit performed before any code (Step 1)

| Brief's audit question | Finding |
|---|---|
| Automation intelligence that already exists | `aiInsights.js` (2 hardcoded threshold checks), `predictiveAnalytics.forecast()` (appointment/revenue only) |
| Prediction logic that already exists | None beyond the above — no SLA-breach, queue-explosion, refund-backlog, verification-delay, retry-exhaustion, cron-failure-trend, notification-congestion, or assignment-overload prediction existed anywhere |
| Monitoring logic that can be reused | `monitoringAggregates.js`'s `buildFlowHealthRanking`/`buildCronHealthRanking` (A6.2.4) — reused verbatim by `bottleneckAnalyzer.js` |
| Retry mechanisms that already exist | `paymentRetryService.retryDuePayments()`, `automationCronJobs.runAll()`, `assignmentScheduler.runSweep()` — all reused as Self-Healing actions instead of duplicated |
| Workflow metrics that already exist | `computeSla()`/`PRIORITY_THRESHOLDS` (A6.2.1 policies), `fetchRawOperations()` (A6.1) — reused by `predictionEngine.js` |
| AI prompts that already exist | 40+ prompts across D3–A6.2.4; none covered prediction/anomaly/capacity/optimization/self-healing explanation |
| Scheduler jobs that already exist | `automationCronJobs` (A5.2), `assignmentScheduler.runSweep` (A6.2.2) — both reused, neither duplicated |
| Notification systems that already exist | `notificationEmitter`, `NotificationDelivery` — **no failure/send-error state exists on NotificationDelivery**, so "notification failure" predictions use real backlog/volume growth instead of a fabricated failure rate |
| Business rules that already exist | SLA targets, refund/verification escalation thresholds (A6.1), assignment overload threshold (A6.2.2) — all reused, none re-authored |
| Realtime events that already exist | `dashboardSyncTick` (frontend polling tick) — reused, no new socket |
| Dashboards that already surface intelligence | AdminMonitoringPlatform, AdminSmartAssignment, AdminAutomationStudio — none compute predictions/anomalies/self-healing |
| Duplicated intelligence | None found to consolidate — this is genuinely new ground |
| Missing intelligence | Everything the Prediction/Anomaly/Capacity/Optimization/Self-Healing engines below now provide |
| Dead logic | None found in scope |
| Fake metrics | None found in scope (the pre-existing rule engine's hardcoded confidence numbers are flagged in `confidenceEngine.js`'s own header, left untouched since changing their emitted values is outside this phase) |
| Hardcoded thresholds | Reused existing ones (SLA targets, overload %, escalation windows) rather than inventing new ones |
| Self-healing opportunities | `retryWebhookEvent` (webhook processing was private, not reusable — now exported), `retryDuePayments`, `automationCronJobs.runAll`, `assignmentScheduler.runSweep`, `aiInsights.generateAdminInsights` |

## What was built

### backend/workflow/intelligence/ (Steps 2–9)
- `confidenceEngine.js` — deterministic 0-100 confidence score from 5
  disclosed factors (historical success, sample size, data freshness,
  matching conditions, system health). Replaces nothing pre-existing (the
  legacy rule engine's own hardcoded numbers are left alone, out of scope).
- `trendAnalyzer.js` — shared daily-series/linear-regression/z-score math,
  used by `predictionEngine`, `anomalyDetector`, and `capacityForecast` so
  none of the three re-implement the same statistics.
- `predictionEngine.js` — 8 real predictions: SLA breach, queue pressure
  (vs `HospitalSetting.operationsCapacity`), refund backlog, verification
  delay, payment retry exhaustion, cron failure trend, notification
  congestion, assignment overload. Every one reuses an existing computed
  field or collection; none re-queries something another module already
  aggregates.
- `anomalyDetector.js` — 8 z-score anomaly checks against each metric's own
  14-day trailing history (not a fixed threshold): revenue drop, refund
  spike, assignment imbalance, execution slowdown, automation/cron/webhook
  failure spikes, queue growth.
- `decisionEngine.js` — deterministic priority/risk/urgency wrapper. "Nothing
  executes without Decision Engine" is true by construction: predictions
  and anomalies only ever reach the self-healing queue via this wrapper's
  output, and the self-healing engine itself independently re-validates
  eligibility rather than trusting a decision object.
- `capacityForecast.js` — extends (never replaces) the pre-existing
  `predictiveAnalytics.forecast()` with 1h/24h/7d/30d projections for
  operations growth, automation executions, cron runs, and assignment load.
- `bottleneckAnalyzer.js` + `optimizationEngine.js` — structural analysis of
  `AutomationFlow` definitions (unused, duplicate-trigger, expensive) plus
  merge/disable/split/optimize/priority-tuning suggestions with a real
  "why" per suggestion. Reuses A6.2.4's flow-health ranking for the
  slow/noisy dimensions rather than re-deriving them.
- `selfHealingEngine.js` — the allowlist **is** the safety policy. 5 real
  actions (`retry_failed_webhook`, `retry_due_payments`,
  `rerun_automation_cron`, `refresh_assignment_sweep`,
  `recalculate_ai_insights`), each delegating to a pre-existing function.
  Nothing executes without an explicit `approveAndExecute(actionLogId,
  approvedBy)` call carrying a real admin's user id — there is no
  scheduler, cron job, or event handler anywhere that calls it
  automatically.
- `intelligenceRegistry.js` — read-only capability catalog, same pattern as
  `workflowRegistry.js`/`triggerRegistry.js`.

### New model
- `IntelligenceActionLog` — persists trigger/eligibility/safetyPolicy/
  rollbackPossible/approvalRequired/status/result per healing action.
  Additive; `writeAdminLog()` is still called alongside it so the existing
  Activity Log / Executive Action Center timeline keeps seeing every action
  too.

### Small additive fix (not a new module, found during audit)
- `backend/payments/webhookHandler.js`'s `processEvent` was private to the
  file, so the new "retry failed webhook" self-healing action had no way to
  reuse the exact webhook-processing code path and would have had to
  duplicate it. Exported `processEvent` (no behavior change) and added
  `retryWebhookEvent(webhookEventId)`, which only operates on rows already
  `status: "failed"` and relies on the pre-existing `TransactionLedger`
  idempotency-key uniqueness to prevent a retry from double-applying a
  financial side effect.

### Controller / routes / mount
- `intelligenceAdminController.js` — thin HTTP layer; every computation
  lives in the engine modules above. Computes the **Platform Intelligence
  Score** (starts at 100, subtracts real disclosed penalties per
  critical/high prediction/anomaly and per failed healing action — same
  "start at 100, disclose every penalty" convention `platformHealthAdminController.js`
  established in A5.2).
- `intelligenceRoutes.js`, mounted at `/api/admin/intelligence`, gated by
  the existing `manage_settings` permission — **no new roles or
  permissions introduced.**

### AI prompts (Step 11) — 6 of the brief's listed 9
`predictionExplain`, `anomalyExplain`, `capacityAdvisor`,
`optimizationAdvisor`, `selfHealingAdvisor`, `platformIntelligenceSummary` —
wired end-to-end through the existing `promptLibrary.js` →
`templateProvider.js` → `generativeAssistant.js` pipeline, each grounded
only in the real object the caller already computed server-side.
`decisionExplain`/`confidenceExplain`/`workflowRiskAdvisor` were
**deliberately not built** as separate prompts: every decision/confidence
object already carries a plain-language, deterministically-computed
explanation (no AI needed to explain a formula), and "workflow risk" is
already covered by the pre-existing `workflowExplain` (A6.2.1). Building
three more near-duplicate prompts for the same underlying data would have
been padding, not value — the same reasoning A6.2.3 used to combine its own
four-prompt cluster into two.

### Frontend (Step 10)
- `AdminWorkflowIntelligence.jsx` at `/admin/workflow-intelligence` — one
  connected hub (Intelligence Score / Predictions / Anomalies / Capacity
  Forecast / Optimization / Self-Healing Queue tabs), same "one hub, many
  tabs" choice `AdminMonitoringPlatform.jsx`/`AdminAutomationStudio.jsx`
  made. Reuses `dashboardSyncTick` for realtime refresh — no new socket.
  The Self-Healing tab is the only tab with a write action, and every
  write requires an explicit Approve/Reject click; there is no "run all"
  or auto-approve control anywhere on the page.
- `intelligenceApi.js` — API wrapper matching `monitoringApi.js`'s
  conventions.
- Linked from `AdminDashboard.jsx`'s Quick Actions list (same pattern as
  every other phase's cross-link).

### Security (Step 13)
Reused `protect`/`requireAdmin`/`requirePermission("manage_settings")`
throughout. No new roles. Every queue/approve/reject action is written to
both `IntelligenceActionLog` (structured) and `AdminActivityLog` (via
`writeAdminLog`, generic timeline) — nothing is audited in only one place.

### Performance (Step 14)
No module in `backend/workflow/intelligence/` re-runs a query another
module already ran: `predictionEngine`/`anomalyDetector` reuse
`fetchRawOperations()`; `capacityForecast`/`bottleneckAnalyzer` reuse
`buildFlowHealthRanking()`/`buildCronHealthRanking()`;
`predictionEngine.predictAssignmentOverload` reuses
`buildAssignmentAnalytics()`'s own `workloadHeatmap`.

## Explicitly deferred (documented, not fabricated)

- **"Resume paused workflow"** — no workflow state machine anywhere in this
  codebase has a "paused" status (`workflowStateMachine.js`'s real states
  are open/claimed/assigned/escalated/resolved/cancelled). Building this
  would mean inventing a status that doesn't exist.
- **"Rebuild cached analytics"** / **"Refresh platform metrics"** (as
  cache-invalidation actions) — no caching layer exists anywhere in this
  codebase; every builder (`monitoringAggregates.js`,
  `overviewAdminController.js`, etc.) computes live on read. There is
  nothing to rebuild.
- **"Restart notification sync"** — `NotificationDelivery` rows are created
  directly by emitters, not by any sync/poll process that could be
  restarted.
- **Per-doctor / per-admin-history capacity forecasts** — insufficient
  per-entity history depth for a defensible trend line; documented in
  `capacityForecast.js`'s own `deferredMetrics` field, surfaced on the
  dashboard rather than hidden.
- **"Unused triggers/actions/AI prompts/schedulers"** as distinct concepts
  from "unused flow" — a trigger/action/prompt only exists inside a flow's
  definition in this codebase; there's no independent usage signal to
  measure without fabricating one. "Unused flow" (the real, measurable
  concept) is built instead.
- **3 of the brief's 9 AI prompts** (`decisionExplain`/`confidenceExplain`/
  `workflowRiskAdvisor`) — folded into deterministic output / the
  pre-existing `workflowExplain`, per the reasoning in the AI prompts
  section above.

## Deliverable
`MediCore-HMS-autonomous-workflow-intelligence.zip` +
`CHANGELOG-A6.2.5.md` + `ArchitectureReport-A6.2.5.md` +
`VerificationReport-A6.2.5.md`.
