# PHASE UI-13 — Process, Automation & Governance Intelligence Workspace

## Audit findings (performed before any implementation)

The brief assumed a large build-out across Process Designer, Automation
Studio, Process Analytics, Optimization, Governance, Compliance, Approval
workflows, Version management, Simulation, Change Impact, and AI advisors.
A full source-of-truth trace (DB → services/engines → controllers → routes
→ API clients → frontend pages → navigation) found that **all of it
already existed as real, connected, non-duplicated systems** from prior
phases (A6.2.1–A6.2.5, A6.3.1–A6.3.5):

| Capability | Backend | Frontend | Status |
|---|---|---|---|
| Process Registry / Orchestration / Dependency graphs / Impact / Event trace | `backend/process/*.js` | `AdminProcessOrchestrator.jsx` | ✅ REAL + CONNECTED |
| Process Designer (create/edit/validate/simulate/version/publish/activate/pause/archive) | `backend/process-designer/*.js`, `ProcessDefinition` model | `AdminProcessDesigner.jsx` | ✅ REAL + CONNECTED |
| Process Analytics, Health Score, Bottlenecks, SLA, Version comparison, Optimization recommendations | `backend/process-analytics/*.js`, `ProcessOptimizationRecommendation` model | `AdminProcessAnalytics.jsx` | ✅ REAL + CONNECTED |
| Governance: compliance matrix, approval queue, exceptions, approve/reject/emergency-publish | `backend/process-governance/*.js` | `AdminProcessGovernance.jsx` | ✅ REAL + CONNECTED |
| Automation Studio: triggers, actions, templates, flow CRUD, publish/rollback/simulate, run history, inspector | `backend/automation-studio/*.js`, `AutomationFlow`/`AutomationRunLog` models | `AdminAutomationStudio.jsx` | ✅ REAL + CONNECTED |
| Workflow Engine / Workflow Intelligence (state machine, self-healing, anomaly/capacity forecasting) | `backend/workflow/*.js` | `AdminWorkflowEngine.jsx`, `AdminWorkflowIntelligence.jsx` | ✅ REAL + CONNECTED |
| AI advisors for every module above (grounded, FACT/RECOMMENDATION-labeled) | `promptLibrary.js` / `generativeAssistant.js` pipeline (A5.2, extended each phase) | AI-explain panels per page | ✅ REAL + CONNECTED |
| Navigation / routing for all 7 pages | `src/config/navigation.js`, `src/routes/AppRoutes.jsx` | — | ✅ REAL, no unreachable pages, no duplicate entries, no duplicate route mounts |

No fake data, no decorative buttons, no `Coming Soon`/`Simulate`-without-a-real-engine
patterns, no duplicate engines, and no `onClick={handler}`-without-wrapper
bugs were found across this domain in the targeted scan performed (full
line-by-line re-audit of all ~40 files was not re-done where prior phases'
CHANGELOGs already documented the same discipline — see
`CHANGELOG-A6.3.5-process-governance.md`, `CHANGELOG-A6.2.3-automation-studio.md`,
`CHANGELOG-A6.3.4-process-analytics-optimization.md`).

**Genuine gap found:** none of these 7 systems had ever been composed into
a single cross-domain workspace, unlike Finance/Reviews/Operations (UI-9's
Executive Command Center) or Mission Control/Assignment/Monitoring (UI-10's
Operations Command Workspace). That composition gap — not a missing engine
— is what this phase closes.

## What was built

### Backend
- **`backend/controllers/admin/automationStudioController.js`** — extracted
  `getStudioHome`'s inline query/aggregation logic into a new exported pure
  function `buildAutomationStudioHome()`. `getStudioHome` is now a thin
  `req/res` wrapper around it. No behavior change — this was done so the
  new command center reuses the exact same automation health computation
  instead of a second AutomationFlow/AutomationRunLog query (Golden Rule:
  never duplicate an existing computation).
- **`backend/services/commandCenter/processCommandCenterAggregates.js`**
  (new) — composes, and computes nothing beyond:
  - `listProcessDefinitions` + `computeAllProcessHealth` (process registry)
  - `buildExecutiveOverview` (process analytics)
  - `buildAutomationStudioHome` (automation studio)
  - `buildGovernanceOverview` + `buildApprovalQueue` (governance)
  - `ProcessOptimizationRecommendation` counts by status (already used
    elsewhere by `getExecutiveOverview`)
  Each section is wrapped in a `safeSection()` resilience helper (same
  pattern as UI-9's `commandCenterAggregates.js`) so one failing data
  source never breaks the rest of the response. The only genuinely new
  logic is `deriveNeedsAttention()` — a pure, exported, unit-tested
  function that filters/sorts processes by health score for the "needs
  attention" list; nothing here re-derives health, executions, governance
  status, or automation stats.
- **`backend/controllers/admin/processAdminController.js`** — added
  `getCommandCenter` (thin wrapper calling `buildProcessCommandCenter()`).
- **`backend/routes/admin/processAdminRoutes.js`** — added
  `GET /api/admin/process/command-center`, same `manage_settings` gate as
  every sibling route, registered above `/registry` so it can't be
  shadowed by or shadow the `:processId` catch-all.
- **`backend/tests/processCommandCenterAggregates.test.mjs`** (new) —
  dependency-free unit test for `deriveNeedsAttention()`: confirms
  processes with no computed health never appear (no fabricated score),
  healthy processes (≥80) are excluded, the unhealthy threshold (<50) is
  counted correctly, and the list sorts worst-first.

### Frontend
- **`src/api/processApi.js`** — added `getCommandCenter()`.
- **`src/pages/admin/AdminProcessCommandCenter.jsx`** (new) — the
  workspace itself: a KPI strip (total processes, active processes,
  automation health, governance health), a "Processes Needing Attention"
  list, an approval-queue preview, an automation snapshot, an optimization
  recommendation count, and a deep-link strip to all 7 existing full
  pages. It never re-implements any of their detail views — every "Open
  X" link routes to the real existing page. Every number is rendered
  exactly as returned by the backend; unavailable sections show "Data
  unavailable"/retry rather than a fabricated zero (via the same
  `SectionState` resilience-rendering pattern `AdminOperationsCommandWorkspace.jsx`
  established in UI-10).
- **`src/routes/AppRoutes.jsx`** — new lazy route
  `process-command-center` → `AdminProcessCommandCenter`.
- **`src/config/navigation.js`** — new primary nav entry "Process Command
  Center" in the Operations group, ahead of the 7 pages it composes (same
  `primary: true` treatment as "Operations Command Workspace").

## Explicitly NOT done in this pass
- No re-implementation, redesign, or line-by-line re-verification of the 7
  existing pages — per Golden Rule, they were confirmed real and were
  reused, not rebuilt.
- No new backend engine, no new AI pipeline, no new audit system — none
  were needed; every mutation this phase's new code performs is zero
  (the command center is read-only).
- No new permission/role was introduced.

## Verification performed
- `node --check` on every changed/added backend file — clean.
- Full existing backend test suite: **44/44 passing** (43 pre-existing,
  unchanged, + 1 new `processCommandCenterAggregates.test.mjs`, 3
  assertions).
- Clean server boot: `ECONNREFUSED 127.0.0.1:27017` only (ie. no live
  MongoDB in this sandbox — consistent with every prior phase; no other
  startup error).
- `npx eslint .`: **0 errors, 0 warnings** repo-wide.
- `npm run build`: clean production build; `AdminProcessCommandCenter-*.js`
  chunk present, all 7 pre-existing process/automation/governance page
  chunks still present and unchanged in count.
- Structural scans: no duplicate `/api/admin/*` route mounts introduced,
  no hardcoded `localhost` in any changed file, no nested interactive
  elements in the new JSX, no orphaned/unreachable route (new route is in
  both `AppRoutes.jsx` and `navigation.js`).
- API contract manually verified end-to-end: frontend `processApi.getCommandCenter()`
  → `GET /admin/process/command-center` → route → `getCommandCenter`
  controller → `buildProcessCommandCenter()` → response shape
  (`{registry, analytics, automation, governance, optimization}`) matches
  exactly what `AdminProcessCommandCenter.jsx` destructures.
- **Fresh-extract verification** (the mandated pre-delivery gate): this
  ZIP was extracted to a clean directory, `npm install` run from scratch
  in both `backend/` and the project root, the full backend test suite
  re-run (44/44 passing against the extracted copy, not the working
  copy), and `npm run build` + `npx eslint .` re-run — all clean.

## NOT verified
- **Live E2E — NOT VERIFIED.** No MongoDB instance or browser is available
  in this sandbox (consistent with every prior phase's changelog). The
  full Login → Registry → Detail → Edit → Validate → Simulate → Approve →
  Publish → Activate → Execute → Monitor → Retry → Governance → Audit
  flow was not exercised against a live database.

## Files changed
- `backend/controllers/admin/automationStudioController.js` (refactor —
  extracted pure function, no behavior change)
- `backend/controllers/admin/processAdminController.js` (new endpoint)
- `backend/routes/admin/processAdminRoutes.js` (new route)
- `backend/services/commandCenter/processCommandCenterAggregates.js` (new)
- `backend/tests/processCommandCenterAggregates.test.mjs` (new)
- `src/api/processApi.js` (new API method)
- `src/pages/admin/AdminProcessCommandCenter.jsx` (new page)
- `src/routes/AppRoutes.jsx` (new route registration)
- `src/config/navigation.js` (new nav entry)

## Final requirement matrix

| Requirement | Backend | API | Frontend | DB | Validation | Error Handling | Permission | Audit | Tests | E2E | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Cross-domain command center composition | ✅ | ✅ | ✅ | n/a (read-only) | n/a (no input) | ✅ safeSection per section | ✅ manage_settings | n/a (read-only, no mutation) | ✅ 44/44 | 🟡 not live-verified | 🟡 REAL + STATICALLY VERIFIED / LIVE E2E PENDING |
| Everything else in the UI-13 brief (Designer/Analytics/Governance/Automation/Workflow lifecycle) | ✅ pre-existing | ✅ pre-existing | ✅ pre-existing | ✅ pre-existing | ✅ pre-existing | ✅ pre-existing | ✅ pre-existing | ✅ pre-existing | ✅ pre-existing (unchanged) | 🟡 not live-verified (unchanged from prior phases) | ✅ REAL + VERIFIED (carried forward, not rebuilt) |

## Deferred / known limitations
- No cross-cutting cost/revenue-per-process signal exists anywhere in the
  platform (same limitation UI-9 and UI-12 already documented) — the
  command center does not show one, per the "no fabricated data" rule.
- Live browser/MongoDB E2E remains unavailable in this sandbox for every
  phase to date.
