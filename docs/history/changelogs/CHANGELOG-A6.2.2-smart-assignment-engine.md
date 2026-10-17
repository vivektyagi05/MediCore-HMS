# Phase A6.2.2 — Smart Assignment Engine (Enterprise AI Workload Intelligence)

Scoped core slice of a much larger 18-step brief, following the same
discipline as every prior phase in this project: audit first, extend the
existing Workflow Engine (A6.2.1) and Unified Operations Queue (A6.1)
rather than duplicating them, ground every number in real data, and
document every gap honestly instead of inventing around it.

## 1. Audit findings (fixed, root cause documented)

1. **Historical analytics were structurally impossible.** `OperationAssignment`
   never persisted the source operation's own `createdAt`/`priority`. Once a
   source record (Doctor, RefundRequest, etc.) left its pending/open state,
   it disappeared from `fetchRawOperations()`'s query filters — so Average
   Resolution Time, SLA Success %, and every other resolved-item metric this
   phase needed had no data to compute from. **Fixed**: both fields are now
   captured once, at first-touch time, via `$setOnInsert` in
   `workflowEngine.executeWorkflowTransition()`.

2. **The existing "Resolved" queue filter was dead code.** Root cause: the
   same `fetchRawOperations()` behavior above meant `status=resolved` /
   `status=all` on `GET /admin/operations/queue` could never return a
   resolved item, no matter what — the frontend's status dropdown has
   offered "Resolved" since Phase A6.1 and it was always empty. **Fixed**:
   `buildUnifiedQueue()` now hydrates resolved/cancelled items directly from
   the `OperationAssignment` overlay (using the newly-persisted
   `sourceCreatedAt`/`sourcePriority`) instead of re-querying a source
   collection that no longer matches.

3. **Timeline entries never recorded WHO an assign/escalate action
   targeted** — only a human-readable note ("Assigned to Priya"), no
   queryable target id. This blocked programmatic acceptance-time and
   received-escalation calculations. **Fixed**: `timeline.targetUserId`
   added to the `OperationAssignment` schema, populated on assign/escalate.

4. **No per-admin or platform capacity concept existed anywhere** — the
   brief's own "Capacity"/"Utilization %"/"never assign past 100%" rules had
   nothing to compute against. **Fixed**: one admin-editable
   `HospitalSetting.operationsCapacity` block (`maxOpenItemsPerAdmin`,
   `overloadThresholdPct`), exposed through the existing settings get/update
   endpoints — not a hardcoded number baked into the scoring engine.

## 2. Smart Assignment Engine (`backend/workflow/assignment/`)

New, additive module — nothing in `backend/workflow/policies.js`,
`workflowRegistry.js`, `workflowStateMachine.js`, `workflowEvents.js`, or
`workflowEngine.js` was rewritten; all are imported and extended.

- **`assignmentPolicy.js`** — re-exports the existing eligibility
  `AssignmentPolicy`/`EscalationPolicy` unchanged, adds the Workload
  Balancer's capacity/overload rules (reads `HospitalSetting`).
- **`assignmentRegistry.js`** — candidate pool (every active admin/
  super_admin — no per-admin department/shift/expertise fields exist in
  this codebase, so none were invented) + real-time presence
  (`OnlineSession`) + per-admin Workload Intelligence snapshots, computed
  by filtering the SAME unified queue item list the caller already fetched
  (never a second, duplicate query).
- **`assignmentHistory.js`** — real per-admin resolution counts by type,
  average resolution time, SLA success rate, recent escalations
  made/received, average acceptance time, claims count — every figure from
  an `OperationAssignment` query, batched across all candidates at once.
- **`assignmentScoring.js`** — pure, unit-tested scoring math. Documented
  weights: workload 25%, experience 20%, priority 15%, availability 15%,
  SLA history 15%, escalation 10% (sums to 100%; permission is a gate, not
  a weight). A brand-new admin with no resolved history gets a neutral SLA
  score (60), never a fabricated high or low value.
- **`assignmentEngine.js`** — orchestrates recommendations
  (`getRecommendations`), reassignment suggestions (`getReassignmentRecommendation`
  — recommendation only, admin approves via the existing assign endpoint),
  and Conflict Detection (`detectConflicts`: circular assignment, multiple
  critical items on one admin, operation starvation, blocked workflow, dead
  queue, permission mismatch — all computed from real data).
- **`assignmentAnalytics.js`** — platform-wide Assignment Analytics: avg
  assignment/acceptance/resolution time, reassignment rate, assignment
  success rate, top performers, workload heatmap, department load
  (reused from the existing queue builder), operation/SLA distribution,
  and a 14-day queue trend — honestly labeled as a proxy (new
  `OperationAssignment` rows per day) since no daily queue-size snapshot
  exists anywhere in this codebase.
- **`assignmentEvents.js`** — adds event names/listeners onto the SAME
  `workflowEventBus` instance from `workflowEvents.js` (no second
  EventEmitter, no new socket). "Reassign" and "Workload/SLA Changed"
  intentionally have no distinct event — a reassignment is just an ASSIGN
  action (already covered), and every realtime dashboard already refetches
  on the existing generic `dashboard:sync` ping rather than reading a diff.
- **`assignmentScheduler.js`** — the sweep: auto-assigns unassigned items
  only when the top scoring candidate is under capacity AND scores ≥55/100
  (otherwise left for a human to pick from the same recommendation list);
  auto-escalates items whose real SLA state is `overdue` and not already
  escalated. Registered as one more job in the existing
  `backend/automation/cronJobs.js` list (no new scheduling mechanism — see
  that job's own audit note on why this is the honest equivalent of "on
  arrival" in a codebase with no operation-created event hook). Every
  action goes through the exact same `executeWorkflowTransition()` a human
  admin's click uses.

## 3. New endpoints (`/api/admin/assignment`, `manage_settings` — no new roles)

`GET /workload`, `GET /conflicts`, `GET /analytics`, `GET /business-rules`,
`POST /sweep`, `GET /ai/workload-advisor`, `GET /ai/sla-advisor`,
`GET /ai/explain`, `GET /:operationKey/recommendations`,
`GET /:operationKey/reassignment`, `GET /:operationKey/ai-recommendation`,
`GET /:operationKey/ai-reassignment`.

`operationsAdminController.assignOperation` now accepts an optional `note`
(the engine's transparent reason, when the call came from a recommendation
card rather than a manual pick) — same endpoint, same contract, nothing
duplicated.

## 4. AI Assignment Advisor (Step 12)

5 new capabilities via the existing `promptLibrary.js` /
`templateProvider.js` / `generativeAssistant.js` pipeline — no new AI
system: `assignmentRecommendation`, `workloadAdvisor`, `reassignmentAdvisor`,
`slaAdvisor`, `assignmentExplain`. Each is handed only the same real
score/workload data the corresponding page/card already displays, so the
narrative can never diverge from the numbers on screen.

## 5. Frontend

- `OperationsWorkspaceDrawer.jsx` extended in place (not duplicated): Smart
  Recommendations panel (scored candidates, one-click Assign), Reassignment
  Suggestion card, AI Explain button.
- New `AdminSmartAssignment.jsx` page at `/admin/smart-assignment` ("Smart
  Assignment" nav entry): Workload Intelligence cards, Conflict Detection
  list, Assignment Analytics (heatmap/distribution/SLA/trend charts reusing
  the existing dependency-free `FinanceCharts.jsx` SVG primitives — no new
  charting library added), Business Rules/scoring-formula viewer, AI
  Assignment Advisor panels, and a manual "Run Sweep Now" trigger.
- `adminApi.js` extended with all new endpoints.

## 6. Explicitly deferred (documented, not fabricated)

- Per-admin **department/shift/expertise fields** — genuinely do not exist
  anywhere in this codebase (Permission is role-wide, User has no
  admin-specific profile fields). "Experience"/"expertise" is derived from
  real resolution history instead; shift-aware availability is not
  supported.
- **True historical queue-size time series** — no daily snapshot job exists;
  Queue Trend is an honestly-labeled proxy (see above), not a fabricated
  historical series.
- **Fully automatic reassignment** — the brief itself specifies
  recommendation-only ("Not automatic. Recommendation first. Admin
  approves."), implemented exactly that way.
- A separate standalone **Conflict Resolution workflow/UI actions** beyond
  surfacing conflicts (the brief's Step 9 only asks to "surface in UI").
- **Saved Views / bulk actions** on the Assignment Queue groupings — same
  gap already documented as deferred in Phase A6.1, unchanged here.
- A dedicated **Assignment Inspector Drawer** separate from the existing
  Operations Workspace Drawer — the brief's Step 13 describes the same
  fields the existing drawer already shows (Timeline/Owner/History/
  Transfer/Escalate/Resolve/Related Operations) plus recommendations, so it
  was extended in place rather than building a second, near-duplicate
  drawer.

## 7. Verification

- `node --check` clean across every new/modified backend file.
- Full server boot: clean (ECONNREFUSED-only — no live MongoDB in this
  sandbox, consistent with every prior phase).
- All 17 pre-existing backend tests still passing, plus 1 new
  dependency-free test file (`assignmentScoring.test.mjs`, 6 assertions
  covering the scoring/capacity math) — **18 passed, 0 failed**.
- `npx eslint backend/ src/` — **0 errors, 0 warnings**.
- `npm run build` — clean, with the new `AdminSmartAssignment` chunk
  confirmed in `dist/assets`.
