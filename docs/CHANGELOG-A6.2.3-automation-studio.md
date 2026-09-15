# CHANGELOG — A6.2.3: Enterprise Automation Studio

## Summary

Built a real, working no-code automation builder on top of the existing
Workflow Engine / Assignment Engine foundation (A6.1 → A6.2.2) — an admin
can now define "when real event X happens, if real condition Y, do real
action Z" without writing code, publish/version/rollback it, dry-run it in
a simulator with zero production impact, and get AI-grounded explanations
and risk advice on it. Scoped down from the brief's full 10-module,
enterprise-suite-scale spec (see "Deferred" below) to a core slice that is
fully real, fully wired, and fully verified — same discipline as every
prior phase in this project.

## Audit findings (before writing any code)

- **No existing infrastructure supports admin-authored automations.**
  `workflowEngine.js`/`workflowStateMachine.js`/`workflowRegistry.js`
  (A6.2.1) execute a **fixed** lifecycle (claim/assign/escalate/resolve/
  cancel/pin) for the 10 hard-coded Operation Registry types.
  `assignmentEngine.js` (A6.2.2) scores candidates for that same fixed
  lifecycle. Neither has any concept of a variable trigger→condition→action
  definition. This phase adds that as new, clearly-scoped infrastructure
  (`backend/automation-studio/`) that **calls into** the existing engine,
  assignment scorer, notification pipeline, AI pipeline, and feature-toggle
  store — it never re-implements any of them.
- **Real bug found and fixed:** `payments/webhookHandler.js` created a
  `WebhookEvent` row but the code path that could mark it `status: "failed"`
  never ran — a processing error skipped straight past it to
  `next(error)`. This meant the pre-existing "webhook_failure" Operation
  Registry type (which reads `WebhookEvent.find({ status: "failed" })`)
  could never surface an item, no matter how many webhooks genuinely
  failed to process. Fixed with a proper try/catch around `processEvent()`
  that now honestly records the failure on the row that already existed
  for it.
- **No real "Insurance Approved" write path exists** anywhere in this
  codebase — insurance claims are only ever closed via the generic
  Operations Queue resolve/cancel action (A6.1), which does not itself
  mutate `Insurance.claimStatus`. This trigger is deliberately **not**
  in the Trigger Library rather than fabricated.
- **No in-process event bus for domain state changes** existed (only
  `workflowEvents.js`'s 6 lifecycle events for the fixed Operation
  Registry types, and paymentEmitter/appointmentEmitter/clinicalEmitter,
  which only fan out to sockets/notifications, not to any generic
  subscriber). Every one of the 14 real triggers below was added as
  **one additive `emitAutomationTrigger(...)` call** at the exact line
  where that state change already happens in an existing controller —
  never a new state change, never a synthetic/polled event.
- **No background scheduler exists** anywhere in this codebase (confirmed
  again from A5.2's audit) — everything is on-demand or standalone-cron.
  The "Reminder Note" action is therefore an honest **immediate**
  reminder-type notification, not a fake delayed send — documented in
  `actionExecutor.js`.

## New backend infrastructure (additive only)

- `models/AutomationFlow.js` — versioned automation definitions (draft/
  published/archived, trigger, nested AND/OR condition tree, ordered
  action list, version history snapshots, real execution stats).
- `models/AutomationRunLog.js` — real execution history, one row per run
  (live or simulated).
- `backend/automation-studio/`
  - `triggerRegistry.js` — the **14 real, verified** triggers, each with
    an exact `wiredAt` code location (see below).
  - `conditionEvaluator.js` — pure-function nested AND/OR evaluator,
    shared by the live runner and the Simulator so they can never disagree.
  - `actionLibrary.js` / `actionExecutor.js` — 10 real action types, every
    one dispatching to an existing service (notificationEmitter,
    AdminActivityLog, FeatureToggle, the existing AI pipeline, the
    existing Assignment Engine's `getRecommendations`, the existing
    Workflow Engine's `executeWorkflowTransition`) — plus one genuinely
    new capability, a real outbound webhook POST (this codebase previously
    only ever *received* webhooks).
  - `automationEventBus.js` — the flow runner (`runFlow`/
    `emitAutomationTrigger`), deliberately separate from
    `workflow/workflowEngine.js` (see audit findings above for why).
  - `templates.js` — 8 templates, every one mapped only to real triggers/
    actions.
- `controllers/admin/automationStudioController.js` +
  `routes/admin/automationStudioRoutes.js`, mounted at
  `/api/admin/automation-studio`, gated by the existing
  `manage_settings` permission — no new roles/permissions.
- `utils/adminAudit.js` gained `writeSystemLog` — the same
  `AdminActivityLog` write as `writeAdminLog`, minus the `req` dependency,
  for audit entries written by event-triggered (not HTTP-triggered) flows.
- `ai/promptLibrary.js` + `ai/generativeAssistant.js` gained 2 new grounded
  capabilities: `automationFlowExplain`, `automationFlowAdvisor` — covering
  the brief's whole "AI Workflow Builder" cluster (Explain/Suggest/
  Optimize/Detect Missing Step/Detect Risk) as two prompts rather than
  six near-duplicates, since a flow definition here is small enough that
  one advisor call already covers gap+risk+optimization together.

## Real triggers wired (14)

| Trigger | Wired at |
|---|---|
| Doctor Verified | `controllers/doctorController.js#approveDoctor` |
| Appointment Cancelled | `controllers/appointmentController.js#cancelAppointment` |
| Appointment Completed | `controllers/appointmentController.js#updateAppointmentStatus` |
| Refund Requested | `controllers/refundController.js#createRefundRequest` |
| Refund Approved | `controllers/refundController.js#approveRefundRequest` |
| Payment Failed | `payments/webhookHandler.js` (`payment.failed`) |
| Payment Success | `payments/webhookHandler.js` (`payment.captured`) |
| Insurance Submitted | `controllers/patient/patientWorkflowController.js#submitInsuranceClaim` |
| Critical Report Uploaded | `controllers/patient/patientWorkflowController.js#uploadReport` |
| New Registration | `controllers/authController.js#register` |
| Role Changed | `controllers/admin/permissionAdminController.js#updateAdminRole` |
| Feature Toggle Changed | `controllers/admin/featureAdminController.js#updateFeatureToggle` |
| Webhook Failure | `payments/webhookHandler.js` (catch branch — see bug fix above) |
| Automation/Cron Job Failed | `utils/cronRunTracker.js#trackRun` (catch branch) |

## Frontend

One connected hub page, `AdminAutomationStudio.jsx` at
`/admin/automation-studio` — Home dashboard (real counts, category
breakdown, execution timeline, transparent Health Score formula), Flows
list with search/filter, a no-code Builder (trigger picker, nested
condition-rule editor, ordered/reorderable action-step editor with
per-action config fields driven by `actionLibrary.js`, Publish/Archive/
Restore/Clone/Rollback/Compare-versions), an Execution Simulator (dry-run
with a JSON sample-payload editor, condition trace, per-step results, zero
production impact), an Inspector (success/failure %, related flows,
recent runs), and AI Explain/Advisor panels. New `src/api/
automationStudioApi.js` client. Linked from `AdminWorkflowEngine.jsx`
("Open Automation Studio →") and from `AdminDashboard.jsx`'s Quick Actions.

Deliberately a vertical connected step list with CSS connector lines
rather than a full drag-drop canvas library — per the brief's own "without
introducing a new frontend framework unless absolutely necessary" note,
and consistent with this codebase's existing dependency-free custom
visualization pattern (`FinanceCharts.jsx`).

## Architecture decisions

- **Two engines, not one duplicated.** `workflowEngine.js` (fixed
  lifecycle for 10 operation types) and `automationEventBus.js` (variable,
  admin-authored flows for 14 triggers) solve different problems and never
  re-implement each other. Where a flow's action needs the fixed
  lifecycle (the `workflow_escalate` action), it calls
  `executeWorkflowTransition` directly.
- **Versioning via embedded snapshots**, not a second collection — a flow
  document is already small, so `versionHistory[]` on the same document
  keeps Rollback/Compare/Clone all reading one place.
- **Dry-run semantics**: every side-effecting action (notify/feature_toggle/
  webhook) is skipped and reported as "would run" during a simulation;
  read-only actions (AI insight, assignment recommendation) still execute
  for real since they mutate nothing — this means a simulation's condition
  evaluation and AI insight are always accurate, never guessed.
- **Protected delete**: only a never-published draft with zero run history
  can be hard-deleted; anything with real history must be archived
  instead, so execution/audit history is never silently lost.

## Deferred (documented, not fabricated)

- **9 of the brief's 10 modules were folded into fewer, real screens** —
  "Studio Home", "Trigger Library", "Action Library", "Condition Builder",
  "Templates", "Versioning", "Execution Simulator", "AI Workflow Builder",
  and "Workflow Inspector" are all real and present, but as tabs/panels
  within one connected page + API, not ten separate routes — matching the
  brief's own "NOT pages... one connected ecosystem" instruction.
- **True drag-drop canvas with node connectors** — built as a vertical
  connected step list instead (see Frontend section) to avoid introducing
  a new charting/canvas dependency for a codebase that has none.
- **Loop nodes** — the brief flags these as "only where business-safe";
  no action in this codebase has a safe repeat semantic (a webhook retry
  loop or notification loop would be a spam vector), so this node type is
  omitted rather than added unsafely.
- **Approval nodes as a distinct action type** — refund/insurance
  approval already have their own dedicated, audited endpoints
  (`refundController.js`, the Operations Queue resolve action); adding a
  generic "approval" action here would either bypass those real approval
  checks or duplicate them. Deferred; `workflow_escalate` covers the
  "route to a human for review" need for Operation Registry items
  specifically.
- **"Insurance Approved", "AI Draft Generated", "Review Submitted",
  "Realtime Event", "Notification Failed", "Workflow Failed" triggers** —
  each has no real, unambiguous write path in this codebase (see audit
  findings above). Omitted rather than invented.
- **True delayed/scheduled reminders** — no scheduler exists anywhere in
  this codebase; the `reminder_note` action is an honest immediate send.
- **Per-flow personalization (Recent/Favorites/Pinned as user-scoped
  lists)** — `isPinned`/`isFavorite` exist as real boolean fields per flow,
  but are global rather than per-admin (no per-admin flow-list storage
  exists elsewhere in this codebase to extend, unlike Widget Grid's
  localStorage pattern which is client-only and wouldn't survive a
  refresh reliably for this use case).
- **Command Palette integration** — no command palette exists anywhere
  in this codebase to integrate with.

## Verification

- `node --check` clean across the entire backend tree (models,
  automation-studio module, controllers, routes, every edited controller).
- Full server boot clean — `ECONNREFUSED` only (no live MongoDB in this
  sandbox, consistent with every prior phase).
- **19/19 backend tests passing** (18 pre-existing + 1 new
  `automationConditionEvaluator.test.mjs`, 13 dependency-free unit tests
  covering every operator, nested AND/OR groups, dot-path field access,
  and the condition-trace shape the Simulator depends on).
- `npx eslint backend/ src/` → **0 errors, 0 warnings**.
- `npm run build` → clean, `AdminAutomationStudio` chunk confirmed in
  `dist/assets`.

## Deliverable

`MediCore-HMS-automation-studio.zip` + this changelog.
