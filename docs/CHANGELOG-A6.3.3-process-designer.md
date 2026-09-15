# Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine

## What was audited first

Read and cross-referenced before writing any code: workflowRegistry.js /
workflowStateMachine.js / workflowEngine.js / workflowEvents.js (A6.2.1),
assignmentEngine (A6.2.2), automation-studio's triggerRegistry.js /
conditionEvaluator.js / actionExecutor.js / actionLibrary.js /
automationEventBus.js (A6.2.3), monitoringAggregates.js (A6.2.4),
intelligenceRegistry.js (A6.2.5), processRegistry.js / processHealth.js /
orchestrationEngine.js / integrationHub.js / processGraph.js /
eventOrchestration.js (A6.3.1/A6.3.2), the AutomationFlow and
AutomationRunLog models, the AI pipeline (promptLibrary /
templateProvider / generativeAssistant), the Permission model /
requireAdmin middleware, the realtime `dashboardSyncTick` convention, and
the existing Admin design system (Card/Button/Modal/Badge/Loader/
EmptyState/SettingsTabs).

**Key finding:** two existing concepts looked similar to what this phase
needed but were not the same thing —
- `AutomationFlow` (A6.2.3) is a **flat** trigger → conditions → actions[]
  list. No branching, no approval/assignment node distinct from an
  "action", no multi-path graph.
- `processRegistry.js` (A6.3.1) is a **static, read-only catalog** of
  processes that already exist in code. Admins cannot author new entries
  in it, and it has no lifecycle.

A real graph-based Process Designer (nodes/edges, branching
condition/decision nodes, a genuine DRAFT→PUBLISHED→ACTIVE lifecycle,
immutable published versions) did not exist anywhere and was built as a
new, additive capability — never duplicating either of the above.

## Backend — new files

- `backend/models/ProcessDefinition.js` — the graph process definition:
  nodes/edges, full lifecycle (draft → validating → valid → published →
  active → paused → archived), version history, cached
  validation/risk results.
- `backend/process-designer/nodeRegistry.js` — maps every node type to a
  real backend capability. Delay/Wait is explicitly exposed as
  **unsupported** (no scheduler exists anywhere in this codebase) —
  never faked as a working no-op.
- `backend/process-designer/graphValidator.js` — real server-side
  validation: missing trigger/end, orphan/unreachable nodes, duplicate
  IDs, invalid edges, unsupported/mismatched action types, decision
  branch completeness, cycle detection.
- `backend/process-designer/riskEngine.js` — deterministic LOW/MEDIUM/
  HIGH/CRITICAL scoring from real structural factors (destructive
  actions, external integrations, financial/clinical triggers, missing
  failure handling, unsupported dependencies) — never AI-scored.
- `backend/process-designer/graphWalker.js` — the **one** function used
  by both the Simulation Engine (`dryRun:true`) and the real execution
  bridge (`dryRun:false`). Delegates every action-like node to the
  existing `actionExecutor.js#runActionStep` and every condition/decision
  node to `conditionEvaluator.js#evaluateConditions` — never a second
  engine.
- `backend/process-designer/impactAnalysis.js` — cross-references an
  authored definition's nodes against the real, existing Process
  Registry. Never invents a percentage or count; reports "insufficient
  historical data" where a number genuinely isn't derivable yet.
- `backend/process-designer/processExecutionBridge.js` — the thin
  adapter (brief's "control plane vs execution plane" split), called
  from inside `automationEventBus.js`'s existing event entry point —
  never a second event bus.
- `backend/controllers/admin/processDesignerController.js` +
  `backend/routes/admin/processDesignerRoutes.js` — mounted at
  `/api/admin/process-designer`, reusing the existing `manage_settings`
  permission (no new roles).
- `backend/tests/processDesignerValidation.test.mjs` +
  `backend/tests/processDesignerGraphWalker.test.mjs` — dependency-free
  unit tests (no live DB) covering valid/invalid graphs, orphan/
  unreachable/cycle detection, unsupported action types, risk scoring,
  and simulation branching (matched/unmatched conditions, blocked gates,
  unsupported delay passthrough).

## Backend — extended in place (no duplication)

- `backend/automation-studio/actionExecutor.js` /
  `actionLibrary.js` — added a real `workflow_resolve` action (the
  Approval node needed a genuine "approve" outcome distinct from
  escalate; delegates to the same `executeWorkflowTransition` primitive
  `workflow_escalate` already uses).
- `backend/automation-studio/automationEventBus.js` — additively calls
  `processExecutionBridge.js#runActiveProcessesForTrigger` from inside
  the same real event entry point every domain controller already fires
  through.
- `backend/models/AutomationRunLog.js` — relaxed `flowId` to optional,
  added `processDefinitionId`/`processKey`/`processVersion`/`nodeTrace`
  with a pre-validate either/or hook (same fix pattern already used for
  `Invoice` in Phase D4) — so process-graph runs land in the **same**
  execution log the Monitoring Platform already reads, instead of a
  second monitoring system.
- `backend/ai/promptLibrary.js` / `generativeAssistant.js` /
  `providers/templateProvider.js` — two new grounded AI capabilities,
  `processDesignExplain` and `processSimulationExplain`, via the existing
  pipeline. Both are handed only server-computed real data (the
  definition's own nodes/validation/risk, or one real simulation run's
  node trace) — never allowed to invent a node, capability, or number.
- `backend/app.js` — mounted the new routes alongside the existing
  read-only `/api/admin/process` (Process Registry viewer).

## Frontend

- `src/pages/admin/AdminProcessDesigner.jsx` — one connected hub at
  `/admin/process-designer`: Process Library (search/filter/status),
  Designer (form-driven node/edge editor populated entirely from the
  real `/node-registry` endpoint — no hardcoded trigger/action list),
  Validation, Simulation (scenario JSON input, node-by-node trace,
  "SIMULATION — NO PRODUCTION DATA MUTATED" banner, run history), Impact
  Analysis, Version History & Compare, and AI Explain.
- `src/api/processDesignerApi.js` — API client.
- Route registered in `AppRoutes.jsx`; Quick Action added to
  `AdminDashboard.jsx`; cross-link added from `AdminWorkflowEngine.jsx`.
- Deliberately a form/list editor with per-node config panels, not a
  drag-drop canvas library — same precedent Automation Studio (A6.2.3)
  already set ("vertical connected step list... rather than a drag-drop
  canvas") and consistent with "no heavy dependency if the existing
  project can support the UI."

## Explicitly deferred (documented, not fabricated)

- **True drag-and-drop canvas** — built as a form/list editor instead,
  matching Automation Studio's own precedent.
- **Delay/Wait node execution** — no scheduler exists anywhere in this
  codebase; exposed in the node registry as `unsupported: true` with an
  explicit reason, disabled in the palette, flagged by the Validator as
  a warning and by the Risk Engine as a risk factor, and blocks
  Activation outright. Building a real scheduler is out of scope for
  this phase.
- **Loop/repeat node type** — no action in this system has a safe repeat
  semantic; any cycle in the graph is treated as a hard validation
  error, not a feature.
- **Numeric SLA/workload projections before any run has happened** — the
  Impact Analysis honestly reports "insufficient historical data" rather
  than guessing; real numbers become available from the Monitoring
  Platform once a version has actual `AutomationRunLog` rows.
- **A distinct standalone Process Simulation UI page** — folded into the
  same connected hub as a tab, consistent with every prior phase's
  "one connected surface, not ten routes" pattern.

## Verification

- `node --check` clean on every backend `.js` file in the repository.
- **24/24 backend tests passing** (22 pre-existing + 2 new:
  `processDesignerValidation.test.mjs`,
  `processDesignerGraphWalker.test.mjs`).
- Server boots cleanly (ECONNREFUSED-only — no live MongoDB in this
  sandbox, same as every prior phase).
- `npx eslint .` (whole repo, backend + frontend) — **0 errors, 0
  warnings**.
- `npm run build` — clean production build with the new
  `AdminProcessDesigner` chunk confirmed in `dist/assets`.

## Known limitations

- The Vitest suite (`api.test.js`) remains unrunnable in this sandbox
  (mongodb-memory-server cannot download its MongoDB binary — network
  restricted). This is a pre-existing, previously documented sandbox
  limitation, not something introduced by this phase.
- Delay/Wait nodes cannot be made genuinely functional without adding a
  real job scheduler to the codebase — flagged, not faked.
