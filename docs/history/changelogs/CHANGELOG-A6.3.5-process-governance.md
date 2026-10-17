# Phase A6.3.5 — Process Governance, Compliance & Enterprise Control Intelligence

Scoped core slice of the full 24-section brief, following the same
discipline as every prior Process/Workflow/Automation phase in this
project: real data, real permissions, real workflow, no duplicate
architecture, deferred items documented honestly rather than faked.

## 1. Audit findings (Section 0/2)

Read before writing anything, against the actual codebase:

- `ProcessDefinition` had `createdBy/updatedBy/publishedBy/activatedBy`
  (who did what) but **no ownership, classification, or approval concept
  at all**. `publishProcess`/`activateProcess` executed unconditionally
  for any admin holding `manage_settings`, regardless of risk.
- `riskEngine.js` (A6.3.3) already computes real `low/medium/high/critical`
  risk from graph structure — reused directly as the governance risk
  signal, never recomputed or duplicated.
- `Permission` model (`models/Permission.js`) and `constants/roles.js` are
  **role-level only** (`super_admin`/`admin`), not per-user. The codebase
  genuinely cannot support distinct creator/reviewer/approver/publisher
  roles (Section 4H). Segregation of duties is therefore enforced by
  **actor identity** (creator ≠ approver), not role — per the brief's own
  instruction not to invent roles where the existing model can't support
  the distinction.
- `AdminActivityLog` + `writeAdminLog` (`utils/adminAudit.js`) already
  records every admin action with actor/action/resource/timestamp/
  metadata — reused as-is for the governance audit timeline. No second
  audit system was created.
- `HospitalSetting.operationsCapacity` (A6.2.2) established the precedent
  of an admin-editable settings block instead of hardcoded thresholds —
  mirrored here as `HospitalSetting.governancePolicy`.
- `ProcessOptimizationRecommendation` (A6.3.4) established the pattern of
  a real multi-stage lifecycle model — reused unchanged; governance reads
  its open critical findings, never re-implements optimization detection.
- Change control (fork-on-edit versioning + `compareVersions`) already
  exists in Process Designer — governance reuses it rather than building
  a second "current vs proposed" diff mechanism.
- No sidebar nav entry exists for the Process Designer/Analytics/
  Orchestrator/Integration Hub cluster — all reachable only via
  cross-links. Process Governance follows the same precedent.

## 2. Architecture decisions

- **No new model.** `governance`, `approval`, and `governanceExceptions`
  are additive fields directly on `ProcessDefinition`. Because a
  published/active version is immutable and editing forks a new document
  (existing convention), each version's own approval decision is already
  preserved on its own document — no separate approval-history collection
  was needed.
- **One new status:** `pending_approval`. Low/medium-risk processes are
  completely unaffected and still go `valid → published` exactly as
  before (Section 3 — preserve existing behavior). There is no separate
  `rejected` status; rejecting or requesting changes on a
  `pending_approval` process returns it to `draft` (already editable),
  avoiding an unnecessary duplicate state.
- **Single source of truth:** `process-governance/processGovernanceEngine.js#evaluateGovernance()`
  is the only place that decides whether approval/simulation/
  documentation/segregation-of-duties are required, and produces the
  entire Compliance Control Matrix. `publishProcess`, `submitForReview`,
  `approveGovernance`, the dashboard KPIs, and the AI explain endpoints
  all call into it — none of them duplicate a check.
- **Publish gate, not a duplicate activate gate.** Because `activate`
  only ever operates on documents that already reached `published`
  status, and publish itself is now gated, activation needed no separate
  governance check — adding one would have duplicated the same decision
  (Section 4: "do not duplicate these checks").
- **Policy is admin-editable, not hardcoded.** `governancePolicy.js`
  reads `HospitalSetting.governancePolicy` (`approvalRequiredTiers`,
  `simulationRequiredTiers`, `documentationRequiredTiers`,
  `segregationOfDutiesTiers`) with a 30s cache, mirroring
  `assignmentPolicy.js`'s existing pattern exactly. Defaults match the
  brief's own Section 8 example table (`high`/`critical` require
  approval+simulation+documentation; only `critical` requires
  segregation of duties) but every value is admin-changeable via the
  existing Settings surface.
- **Compliance matrix is computed live, never stored.** Section 4's "no
  fabricated compliance scores" rule means every control row
  (`Owner assigned`, `Risk classified`, `Process validated`,
  `Simulation completed`, `Documentation present`, `Approval completed`,
  `Segregation of duties`, `No unresolved critical findings`, `Audit
  trail complete`) is recomputed from real fields/queries on every read —
  nothing is cached as a stale "PASS".
- **Governance health is a deterministic label** (`Healthy` / `Attention`
  / `At Risk` / `Critical`), never an arbitrary percentage score, per
  Section 12.2's explicit instruction.
- **Batched evaluation for dashboards.** `governanceAggregates.js`
  pre-fetches simulation evidence and open-critical-findings counts for
  every process in one or two aggregation queries, then hands each
  document its own evidence — the engine itself never queries per
  document when evaluating many processes at once (Section 19).

## 3. Business rules implemented

- **Approval gate:** a process whose effective governance risk tier
  (structural risk escalated by owner-set criticality/data-sensitivity/
  patient-impact/financial-impact classification, never downgraded)
  requires approval per policy cannot be published directly —
  `publishProcess` returns 409 and points the caller at
  `submit-review`/`approve` instead.
- **Segregation of duties:** for tiers configured to require it (default:
  `critical`), the approver may not be the same identity as the creator.
  A `super_admin` may override with an explicit `overrideSegregation` +
  reason, which writes a real, reviewable governance exception — never a
  silent bypass.
- **Emergency publish:** `super_admin`-only, requires an explicit reason,
  writes a `governanceExceptions` entry (`reviewRequired: true`) on the
  document *and* a `critical`-severity `AdminActivityLog` entry — visible
  in both the Governance Exceptions tab and the normal Admin Audit page.
- **Reject / Request Changes:** both require a reason, return the
  process to `draft`, and are fully audited.
- **Governance classification** (owner, criticality, data sensitivity,
  patient/financial impact flags, documentation-required flag, an
  explicit `governanceOverride`, and an optional `nextReviewDue` date) is
  admin-set per process via `PUT .../classification` — every value
  defaults to `null`/`false` ("not configured"), never a fabricated
  default.

## 4. Files changed

**Backend (new):**
- `models/ProcessDefinition.js` — additive `governance`/`approval`/
  `governanceExceptions` fields; status enum gains `pending_approval`.
- `models/HospitalSetting.js` — additive `governancePolicy` block.
- `process-governance/governancePolicy.js`
- `process-governance/processGovernanceEngine.js`
- `process-governance/governanceAggregates.js`
- `controllers/admin/processGovernanceController.js`
- `routes/admin/processGovernanceRoutes.js`
- `tests/processGovernanceEngine.test.mjs`

**Backend (edited):**
- `controllers/admin/processDesignerController.js` — extracted
  `applyPublishMutation()` (zero behavior change for the existing
  ungoverned path), added the governance gate to `publishProcess`.
- `controllers/admin/settingsAdminController.js` — `governancePolicy`
  added to defaults + the allow-list.
- `app.js` — mounted `/api/admin/process-governance`.
- `ai/promptLibrary.js`, `ai/generativeAssistant.js`,
  `ai/providers/templateProvider.js` — 4 new grounded capabilities
  (`governanceExplain`, `approvalRiskExplain`, `complianceSummary`,
  `changeImpactExplain`), each explicitly separating FACT from
  RECOMMENDATION and grounded only in server-computed data (Section 16 —
  "AI MUST NOT decide approval").

**Frontend (new):**
- `src/api/processGovernanceApi.js`
- `src/pages/admin/AdminProcessGovernance.jsx` — one connected hub
  (Overview / Approval Queue / Compliance Matrix / Exceptions / Process
  Detail with its own Compliance Control Matrix + Audit Timeline),
  reusing `Card`/`Button`/`Modal`/`Badge`/`EmptyState`/`SettingsTabs` and
  `dashboardSyncTick` for realtime refresh — no new UI library.

**Frontend (edited):**
- `src/routes/AppRoutes.jsx` — new `/admin/process-governance` route.
- `src/pages/admin/AdminProcessDesigner.jsx`,
  `src/pages/admin/AdminProcessAnalytics.jsx` — cross-link header
  buttons (same precedent as the existing Designer↔Analytics link — no
  sidebar nav entry, matching this whole page cluster's convention).
- `src/pages/dashboard/AdminDashboard.jsx` — Quick Actions entry.

## 5. Security

- Every new route requires `protect` + `requireAdmin` +
  `requirePermission("manage_settings")` — the same permission every
  other Process/Workflow/Automation Studio surface already uses. No new
  roles or permissions were introduced.
- Emergency publish additionally requires `req.user.role === "super_admin"`.
- Approval/reject/request-changes/emergency-publish all write server-side
  `req.user._id` as the actor — never accepted from the client body.
- All governance transitions are validated server-side against the
  document's current `status`/`approval.status`; there is no client-set
  approval status or audit actor field anywhere in the request bodies.

## 6. Tests

- 21 new dependency-free assertions in `processGovernanceEngine.test.mjs`
  covering tier escalation (including classification-only escalation and
  the never-downgrade guarantee), policy-driven requirement toggling,
  every control's PASS/FAIL/WARNING/NOT_CONFIGURED/NOT_APPLICABLE path,
  segregation-of-duties pass/fail/not-applicable, the owner-control's
  draft-vs-active severity difference, unresolved-critical-findings as a
  warning (never a fabricated hard block), unchecked evidence reported
  honestly as `NOT_CONFIGURED` rather than guessed, and the
  `computeGovernanceHealth` label mapping.
- `evaluateGovernance()` accepts an injectable `policy` argument (same
  precedent as `assignmentPolicy.js`'s `computeUtilization(openCount,
  capacity)`) so the test suite stays fully dependency-free — no live
  MongoDB required.
- 26/26 backend tests passing (25 pre-existing + 1 new file).

## 7. Verification

- **COMPLETED:** `node --check` clean on every backend `.js` file in the
  repo; full server boot clean (`ECONNREFUSED` only — no live MongoDB in
  this sandbox, as with every prior phase); `node tests/run-all.mjs` →
  26/26 passing; `npx eslint .` (whole repo) → 0 errors, 0 warnings;
  `npm run build` clean with the `AdminProcessGovernance` chunk confirmed
  in `dist/assets`.
- **NOT LIVE-VERIFIED:** no live MongoDB instance exists in this sandbox
  (network-restricted, same as every prior phase), so the actual
  approve/reject/emergency-publish HTTP round-trips, the aggregation
  queries in `governanceAggregates.js`, and the React page's real network
  calls were not exercised against a live database or a running browser.
  The dependency-free unit tests, `node --check`, the clean server boot,
  and the clean production build are the verification that was possible
  in this environment.

## 8. Explicitly deferred (documented, not fabricated)

- **Distinct reviewer/approver/publisher/operator roles** — the real
  Permission model cannot support this granularity (Section 4H audit
  finding); segregation of duties uses actor identity instead.
- **A dedicated "review" stage separate from "approval"** — with only two
  admin-tier roles in this codebase, a distinct reviewer stage would have
  no different actor pool than the approver stage, so it was folded into
  one approval gate rather than an unenforceable second step.
- **Scheduled/automatic governance review reminders** — no job scheduler
  exists anywhere in this codebase (same finding as every prior phase);
  `nextReviewDue` is a real admin-set field surfaced as a live KPI count,
  not an automated reminder.
- **A generic emergency-activation path for already-published versions**
  — activation was never gated in the first place (the publish gate is
  the single control point), so a separate emergency-activate action
  would duplicate emergency-publish without a real distinct use case.
- **Change Request "current vs proposed" UI inside the Governance
  page itself** — Process Designer's existing version-compare view
  already covers this; Governance's Process Detail links to the same
  process rather than re-implementing the diff.
- **Numeric governance/compliance scores** — the brief explicitly forbids
  arbitrary percentage scores; only the deterministic
  Healthy/Attention/At Risk/Critical label is shown.
