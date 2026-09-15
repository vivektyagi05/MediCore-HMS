# CHANGELOG — A6.3.4 Process Analytics & Optimization Intelligence

## 1. What was audited

- `backend/models/ProcessDefinition.js` and `AutomationRunLog.js` (A6.3.3) — confirmed every Process Designer graph run (simulator dry-run AND live event-triggered) already persists to `AutomationRunLog` with `sourceKind:"process_definition"`, `processKey`, `processVersion`, `status`, `durationMs`, `startedAt`, `nodeTrace` (per-node PASS/SKIPPED/BLOCKED/WARNING/FAIL/UNSUPPORTED), `stepResults`, and `dryRun`. This is the only real execution data source used anywhere in this phase.
- `backend/process-designer/graphWalker.js`, `processExecutionBridge.js`, `impactAnalysis.js`, `nodeRegistry.js`, `graphValidator.js`, `riskEngine.js` — confirmed the Simulation Engine and real execution both funnel through one function (`walkProcessGraph`), and reused it directly for the new "Optimization Simulation" endpoint rather than building a second engine.
- `backend/monitoring/monitoringAggregates.js` (A6.2.4) — reused `percentile()` directly (not re-implemented). Confirmed its aggregates are scoped to `AutomationFlow`/`CronRunLog`/`Payment`, never `ProcessDefinition` — no overlap, no duplicate metric path.
- `backend/process/processHealth.js` (A6.3.1) — confirmed this is a *registry-level* health score for the 18 static `processRegistry.js` entries (Operation types, automation_flow, monitoring_execution, payment_retry), computed from entirely different inputs than a Designer `ProcessDefinition`. No collision; A6.3.4's health score is a distinct, additive concept for Designer processes specifically.
- `backend/ai/promptLibrary.js`, `providers/templateProvider.js`, `generativeAssistant.js` — confirmed the existing swappable-provider AI pipeline and reused it for all 4 new capabilities; no new chatbot, no new provider.
- `backend/controllers/admin/processDesignerController.js` / `routes/admin/processDesignerRoutes.js` — confirmed the exact fork-on-edit draft-creation shape (`ProcessDefinition.create({..., status:"draft", parentVersion})`) used when editing a published/active version, and reused that identical shape for "Generate Proposed Version" rather than inventing a second mutation path.
- Admin permission middleware, `writeAdminLog`, `AppError`/`asyncHandler` conventions, `app.js` route mounting, `AdminDashboard.jsx` Quick Actions, `FinanceCharts.jsx` (dependency-free SVG charts), `SettingsTabs.jsx` — all reused as-is.
- Confirmed no per-process SLA target exists anywhere in this codebase (only the fixed Operation Registry `SLA_TARGET_MS`, unrelated to a process-graph run's own duration) — see Section 5 below for the resulting additive field.

## 2. What was implemented

**Backend — Analytics Data Foundation** (`backend/process-analytics/processAnalyticsAggregates.js`) — the single source of truth every other builder, controller, and AI prompt consumes:
- Process Performance Intelligence (executions, success/failure/blocked rate, avg/median/P90/P95 duration, fastest/slowest, executions-per-day, daily series, version distribution)
- SLA Intelligence (compliance rate, breach count, breach trend) — reports "No SLA configured" honestly when unset
- Process Health Score — deterministic, transparent, 4-factor weighted score (success 40 / SLA 20 / duration-trend 20 / failure-stability 20), never AI-generated, with disclosed positive/negative factors
- Bottleneck Intelligence — per-node execution/failure/skip counts, avg/P95 duration, confidence tiers, minimum-sample-size gate
- Failure Intelligence — deterministic message categorization (timeout/authorization/not_found/validation/connectivity/other), by-trigger breakdown, failure trend, raw message preserved
- Version Intelligence + Version Comparison — per-version metrics, structural node diff, "insufficient data" honesty for under-sampled versions
- Trend Intelligence — 24h/7d/30d/90d bucketed time series
- Cross-Process Intelligence — Volume × Reliability × Speed × SLA matrix, top-volume/top-failing/slowest rankings
- Executive Overview — platform-wide KPIs

**Backend — Optimization Engine** (`backend/process-analytics/processOptimizationEngine.js` + new `ProcessOptimizationRecommendation` model):
- 6 deterministic rule types: `slow_node`, `failing_node`, `high_skip_node`, `sla_breach`, `version_regression`, `process_degradation` — every one evidence-phrased (no fabricated percentage-improvement claims), with dedup against already-open recommendations
- Real lifecycle: `detected → reviewed → simulation_ready → approved/rejected → implemented`, matching the brief's Section 19 states exactly, backed by a real persisted model (no fake transitions)
- "Generate Proposed Version" reuses the *exact* Process Designer fork-on-edit shape — creates an ordinary `draft` version, never mutates the live active version
- "Simulate Proposal" reuses the *exact* existing `walkProcessGraph`/Simulation Engine — Current vs Proposed, clearly labelled a structural + dry-run simulation (never a predictive estimate)
- "Mark Implemented" requires the proposed draft to have already gone through real Process Designer publish+activate — this phase never publishes or activates anything itself

**Backend — additive field**: `ProcessDefinition.slaTargetMs` (optional, admin-set, default `null`) — the smallest justified additive field per the brief's own Section 6/9, since no per-process SLA target existed anywhere.

**Backend — AI** (existing pipeline, 4 new capabilities): `processAnalyticsExplain`, `processBottleneckExplain`, `processOptimizationAdvisor`, `processVersionComparisonExplain` — every prompt explicitly separates FACT from RECOMMENDATION and is grounded only in server-computed context re-fetched by the controller (never client-supplied numbers).

**Backend — API**: new `processAnalyticsController.js` / `processAnalyticsRoutes.js` at `/api/admin/process-analytics`, gated by the existing `manage_settings` permission — no new roles.

**Frontend**: one connected hub `AdminProcessAnalytics.jsx` at `/admin/process-analytics` (Executive Overview / Process Detail [Performance, Bottlenecks, Failures, SLA, Versions, AI Explain] / Optimization Center tabs) — reuses `FinanceCharts.jsx` SVG primitives (no new chart library), `SettingsTabs`, `Card`/`Button`/`Badge`/`EmptyState`/`Loader`. Cross-linked from `AdminProcessDesigner.jsx` header and `AdminDashboard.jsx` Quick Actions.

## 3. What existing architecture was reused

Process Designer's `ProcessDefinition`/`AutomationRunLog`/`graphWalker`/`graphValidator` (execution + simulation), the existing AI provider pipeline, `manage_settings` permission, `writeAdminLog`, `AppError`/`asyncHandler`, `FinanceCharts.jsx`, `SettingsTabs`, and `monitoringAggregates.percentile()`. No duplicate engines, APIs, event buses, monitoring systems, or AI pipelines were introduced.

## 4. What real data powers each major feature

Every metric on every page is computed live from `AutomationRunLog` rows with `sourceKind:"process_definition"` (excluding `dryRun:true` simulator runs from "real production performance" figures, which are shown separately in Process Designer's own run history) and from `ProcessDefinition` version/status/SLA metadata. Nothing is fabricated; unavailable data is always labelled ("No historical data", "Insufficient execution history", "No SLA configured") rather than shown as `0`.

## 5. What was newly persisted

- `ProcessDefinition.slaTargetMs` (additive field)
- `ProcessOptimizationRecommendation` (new model — recommendation lifecycle only; never stores computed metrics itself, always recomputes live)

## 6. Doctor/Patient/Admin workflow integration

This phase is Admin-only by nature (an operational intelligence layer over Process Designer, itself Admin-only) — no Doctor or Patient-facing workflow exists for process analytics, so none was built or faked.

## 7. Tests passed

- `node --check` clean on every backend `.js` file in the repo
- 25/25 backend tests passing (24 pre-existing + 1 new `processAnalyticsEngine.test.mjs`, covering duration stats, failure categorization, node diffing, health-score grading thresholds, optimization severity thresholds, and dedup-key stability — all dependency-free, no live DB needed)
- Server boots cleanly (ECONNREFUSED-only — no live MongoDB in this sandbox)
- `npx eslint .` (whole repo) — 0 errors, 0 warnings
- `npm run build` — clean, with the new `AdminProcessAnalytics` chunk confirmed in `dist/assets`
- Confirmed exactly one route registration each for `/api/admin/process-analytics` (backend) and `/admin/process-analytics` (frontend), and no existing endpoint was altered

## 8. What could not be live-verified

MongoDB aggregation pipelines in `processAnalyticsAggregates.js`/`processOptimizationEngine.js` (the actual DB reads/writes) could not be exercised against live data — this sandbox has no MongoDB server, same limitation every prior phase has already documented. They were verified by code review, `node --check`, and the dependency-free unit tests on their pure helper functions (duration stats, categorization, diffing, grading, severity, dedup keys). The one pre-existing Vitest suite (`api.test.js`) remains unrunnable in this sandbox (`mongodb-memory-server` cannot download its binary, network-restricted) — unchanged from every prior phase's finding, not newly broken by this phase.

## 9. What is genuinely deferred

- **Predictive replay / true forecasting** — Section 14 explicitly requires distinguishing structural simulation from historical replay from predictive estimate. Only structural + dry-run simulation is real here (reusing the existing engine); no predictive model was built, since none of this codebase's existing AI capabilities do time-series forecasting for process outcomes.
- **Operational cost in the Cross-Process Matrix** — no per-process cost tracking exists anywhere in this codebase; the Volume × Reliability × Speed × SLA matrix omits a cost dimension rather than fabricating one, per Section 11's own instruction.
- **Retry/self-healing counts for process-graph runs** — `walkProcessGraph.js` has no retry/recovery concept (same finding A6.2.4 already made for `AutomationFlow` runs); reported honestly as "not applicable" rather than showing `0`.
- **Assignment/notification/integration-specific bottleneck sub-rules** (Section 12's longer example list) — folded into the generic `failing_node`/`slow_node`/`high_skip_node` rules, since those node types already surface through the same real `nodeTrace` data; a separate rule per node *type* would duplicate the same evidence path without adding a genuinely different signal.
- **A dedicated "most improved processes" ranking** in Cross-Process Intelligence — the version-regression detector already surfaces improving/regressing version pairs per process; a separate platform-wide "most improved" leaderboard was scoped down to avoid a second, overlapping trend computation for the same underlying signal.
- **Real-time/automatic recurring detection** — this codebase has no background job scheduler anywhere (same finding every prior phase already made); detection runs on-demand from the Optimization Center, not on a cron.
