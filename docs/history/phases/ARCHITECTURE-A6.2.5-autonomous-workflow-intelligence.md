# ARCHITECTURE REPORT — A6.2.5: Autonomous Workflow Intelligence & Self-Healing Platform

## Module map

```
backend/workflow/intelligence/
  confidenceEngine.js     — pure function. 0-100 score, no DB access.
  trendAnalyzer.js        — pure function. Daily series / linear trend / z-score. No DB access.
  predictionEngine.js     — reads Operation Registry, Payment, CronRunLog,
                             NotificationDelivery, HospitalSetting, Smart
                             Assignment analytics. Writes nothing.
  anomalyDetector.js       — reads Payment, AutomationRunLog, CronRunLog,
                             WebhookEvent, OperationAssignment, Operation
                             Registry. Writes nothing.
  decisionEngine.js        — pure function over prediction/anomaly objects.
  capacityForecast.js      — reads AutomationRunLog, CronRunLog,
                             OperationAssignment, Operation Registry; calls
                             the pre-existing predictiveAnalytics.forecast().
  bottleneckAnalyzer.js    — reads AutomationFlow; calls the pre-existing
                             monitoringAggregates.buildFlowHealthRanking().
  optimizationEngine.js    — calls bottleneckAnalyzer only. No DB access of
                             its own.
  selfHealingEngine.js     — the only module with WRITE access. Writes
                             IntelligenceActionLog only. Delegates actual
                             execution to 5 pre-existing functions
                             (webhookHandler.retryWebhookEvent,
                             paymentRetryService.retryDuePayments,
                             automationCronJobs.runAll,
                             assignmentScheduler.runSweep,
                             aiInsights.generateAdminInsights).
  intelligenceRegistry.js  — pure catalog. Reads selfHealingEngine's
                             ALLOWED_ACTIONS for display only.

backend/controllers/admin/intelligenceAdminController.js
  — thin HTTP layer. Computes the Platform Intelligence Score (pure
    function over the engines' own output) and dispatches to
    generativeAssistant for the 6 AI endpoints.

backend/routes/admin/intelligenceRoutes.js
  — mounted at /api/admin/intelligence in app.js. Gated by the existing
    requirePermission("manage_settings").

backend/models/IntelligenceActionLog.js
  — the only new persistent write surface introduced by this phase.

src/pages/admin/AdminWorkflowIntelligence.jsx
  — one connected hub, 6 internal tabs, reuses dashboardSyncTick.
src/api/intelligenceApi.js
  — thin fetch wrapper, no logic.
```

## Data flow

```
Real collections (Payment, CronRunLog, AutomationRunLog, WebhookEvent,
OperationAssignment, NotificationDelivery, HospitalSetting)
        │
        ▼
Operation Registry (fetchRawOperations, A6.1)  ──┐
Assignment Analytics (buildAssignmentAnalytics)  ├──► predictionEngine.js ──► [prediction objects]
Policy Engine (computeSla, PRIORITY_THRESHOLDS)  ┘                              │
                                                                                  ▼
Real collections (same set)  ──► trendAnalyzer.js ──► anomalyDetector.js ──► [anomaly objects]
                                                                                  │
                       predictions + anomalies ──────────────────────────────────┤
                                                                                  ▼
                                                                     decisionEngine.js
                                                                     (priority/risk/urgency)
                                                                                  │
                                                                                  ▼
                                              intelligenceAdminController.js (HTTP layer)
                                                                                  │
                                                     ┌────────────────────────────┼───────────────────────────┐
                                                     ▼                            ▼                           ▼
                                     AdminWorkflowIntelligence.jsx    generativeAssistant.* (6 AI prompts)   IntelligenceActionLog
                                     (renders, never re-derives)      (grounded only in the object passed)   (self-healing audit trail)
```

## Why each piece lives where it does

- **confidenceEngine.js / trendAnalyzer.js are pure, DB-free modules.**
  Every other intelligence module imports these rather than computing its
  own statistics — this is the literal enforcement of the brief's "no
  duplicated calculations" rule, not just a stated intention.

- **selfHealingEngine.js is the ONLY module with write access** in the
  entire `backend/workflow/intelligence/` tree. `predictionEngine.js`,
  `anomalyDetector.js`, `capacityForecast.js`, `bottleneckAnalyzer.js`,
  `optimizationEngine.js`, and `decisionEngine.js` are all read-only —
  there is no code path in any of them that calls `.save()`, `.create()`,
  or `.updateOne()` on anything. This means a bug in a prediction/anomaly
  calculation can produce a wrong NUMBER on a dashboard; it structurally
  cannot cause an unintended write, because the write surface is isolated
  to one file with its own independent eligibility re-check.

- **The allowlist (`ALLOWED_ACTIONS`) is the safety policy, not a
  convention layered on top of one.** `queueAction()` and
  `approveAndExecute()` both call `isActionAllowed()` before doing
  anything; an action key that isn't a property of `ALLOWED_ACTIONS`
  cannot reach `.run()` under any code path, including a malformed or
  malicious request body — `postQueueHealingAction` in the controller
  rejects unknown keys with a 400 before ever calling `queueAction`, and
  `queueAction`/`approveAndExecute` reject them again independently. This
  is why the brief's reject list (refund money, approve doctor, delete
  records, etc.) required no explicit "reject" code at all — those actions
  simply have no entry in the allowlist, so there is no function pointer
  to invoke for them.

- **Two-step approval is structural, not a UI convention.**
  `queueAction()` can only ever create a row with `status:
  "pending_approval"`. The ONLY function that transitions a row to
  `"executed"` is `approveAndExecute()`, which requires a real
  `approvedBy` user id and independently re-validates
  `isActionAllowed(log.actionKey)` (in case the allowlist changed between
  queue-time and approve-time). No cron job, event listener, or trigger
  anywhere in this phase calls `approveAndExecute()` — the only caller is
  `postApproveHealingAction` in the controller, which requires
  `req.user._id` from an authenticated, `requirePermission("manage_settings")`-gated
  request.

- **capacityForecast.js extends, not replaces,
  `predictiveAnalytics.forecast()`.** The legacy function's output is
  passed through under the `appointmentsAndRevenue` key, verbatim, in the
  same response object as the 4 new metrics — there was no reason to touch
  a function that already works and that other code
  (`aiController`) already depends on.

- **bottleneckAnalyzer.js calls `buildFlowHealthRanking()` rather than
  querying `AutomationRunLog` itself for slow/noisy flows** — that
  aggregation already exists and is already correct (A6.2.4); this module
  adds only the structural checks (unused/duplicate/expensive) that
  operate on `AutomationFlow`'s definition fields, which
  `buildFlowHealthRanking()` never reads.

## New collections and why

- **`IntelligenceActionLog`** — the only new collection. Necessary because
  the brief's Step 5 requires structured `trigger`/`eligibility`/
  `safetyPolicy`/`rollbackPossible`/`approvalRequired` fields per healing
  action, which would have had to live inside `AdminActivityLog`'s loose
  `metadata` blob otherwise, losing queryability (e.g. "show me all
  pending_approval rows" becomes a metadata scan instead of an indexed
  `status` query).

## Nothing else changed

No existing model gained new required fields. No existing route's request/
response contract changed. `webhookHandler.js`'s only change is exporting
a previously-private function and adding one new exported function
(`retryWebhookEvent`) — `razorpayWebhookHandler`'s own behavior is
byte-for-byte unchanged.
