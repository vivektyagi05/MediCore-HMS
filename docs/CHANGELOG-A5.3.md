# CHANGELOG — Phase A5.3: Executive Action Center

Builds on Phase A5.1 (Executive Dashboard / Mission Control) and A5.2
(Platform Health / Smart Widgets / Widget Registry). Nothing from those
phases was redesigned; everything below extends the existing architecture.

## 1. Audit Report (real findings, before any code was written)

- `buildSmartAlerts()` (A5.1) already produced real, condition-based alerts
  with `priority`/`title`/`count`/`link`, but no `owner`/`reason`/`impact`/
  `recommendedAction`/`deadline` — the fields an executive needs to actually
  act, not just see. **Never rebuilt** — enriched additively.
- No platform-wide "high risk patient" or "delayed appointment" signal
  existed. The Doctor Command Center had a per-doctor version
  (`riskLevelFor`/`slotStartMinutes`), never exposed at platform scope.
- Doctor approvals/rejections (`approveDoctor`/`rejectDoctor`) and refund
  approvals/rejections never wrote to `AdminActivityLog` — so no single
  query could ever produce a true cross-module Executive Timeline.
- `notificationEmitter.emitToRole(role, payload)` already existed as a real
  broadcast-to-role capability and was never exposed as an admin action —
  "Broadcast Announcement" was a pure UI/route gap, not a missing backend.
- No way existed to pause new registrations short of taking the API down.
  `FeatureToggle` already existed as a generic key/isEnabled store.
- No structured refund/payment failure-reason taxonomy exists anywhere in
  the data model (`RefundRequest.reason` is free text; `Payment` has no
  failure-reason field at all). Recommendations were therefore built only
  from real counts/rates that already exist elsewhere, not an invented
  "top reason" categorization.
- AI pipeline (`promptLibrary`/`templateProvider`/`generativeAssistant`) was
  reused as-is; only one new grounded prompt (`metricExplain`) was added.

## 2. Business Rules (Step 11) — `GET /admin/executive-actions/business-rules`

Static documentation, pulled from the real formulas already in code
(health score, patient risk level, alert thresholds, recommendation
thresholds) — not a description of anything invented for this phase.

## 3. Architecture

One new controller (`executiveActionController.js`) and one new route file
(`executiveActionRoutes.js`), reusing `buildSmartAlerts` /
`buildExecutiveDashboardData` / `buildPlatformAnalyticsData` rather than
re-querying. No duplicate controllers, APIs, or calculations.

## 4. Backend changes

- **New:** `backend/controllers/admin/executiveActionController.js` —
  Action Center (enriched alerts + 2 new real cards: platform-wide
  high-risk-patients-today, delayed-appointments-today, plus
  unread-ai-drafts), Executive Recommendations (rule-based, grounded),
  Decision Cards, Executive Timeline (merged from real collections),
  Business Rules doc, Broadcast Announcement action, Pause/Resume
  Registrations action, AI Explain endpoint (whitelisted metrics only).
- **New:** `backend/routes/admin/executiveActionRoutes.js`, mounted at
  `/api/admin/executive-actions` in `app.js`.
- **Extended (additive):** `commandCenterController.js` — exported
  `riskLevelFor`/`slotStartMinutes` (previously private) so the platform-wide
  cards reuse the exact same rule as the per-doctor Command Center.
- **Extended (additive):** `authController.register` — checks the
  `registrations_paused` `FeatureToggle` before creating an account. Default
  (toggle absent/disabled) behavior is unchanged.
- **Extended (additive):** `featureAdminController.js` — added
  `registrations_paused` to the default feature list so it is also visible
  from the existing Feature Toggles admin surface.
- **Extended (additive):** `promptLibrary.js` / `templateProvider.js` /
  `generativeAssistant.js` — added the `metricExplain` prompt, its
  deterministic-fallback renderer, and the `generativeAssistant.metricExplain`
  method. No new AI system; same pipeline, same disclaimer convention.

## 5. Frontend changes

- **New:** `src/pages/admin/AdminExecutiveActionCenter.jsx` at
  `/admin/executive-actions` — Decision Cards, Action Center cards (with
  owner/reason/impact/recommended action/deadline/click-through button),
  Executive Recommendations, "AI Explain Everything" buttons, Executive
  Timeline, and two quick actions (Broadcast Announcement, Pause/Resume
  Registrations) that open in-page as modals (Step 9 workspace pattern)
  instead of navigating away.
- **Extended:** `src/api/adminApi.js` with the 8 new endpoint methods.
- **Extended:** `src/routes/AppRoutes.jsx` (lazy import + route) and
  `src/config/navigation.js` (single nav-catalog source of truth, so the
  Sidebar and Command Palette both pick it up automatically).

## 6. AI changes

One new grounded capability: `metricExplain`. Explanations are built only
from a fresh, server-side re-fetch of the real builder data for a
whitelisted metric set (`healthScore`, `cancellationRate`,
`paymentFailureRate`, `refundBacklog`) — the client cannot pass in a number
to "explain," preventing any drift between what's shown on screen and what
gets explained.

## 7. Security changes

No new roles or permission keys. All new routes reuse the existing
`requireAdmin` + `requirePermission("manage_settings")` middleware, the
same permission already gating the Platform Health Center.

## 8. Performance changes

Every read endpoint composes existing builder functions
(`buildSmartAlerts`, `buildExecutiveDashboardData`,
`buildPlatformAnalyticsData`) via `Promise.all` rather than re-querying the
same collections a second time. The Executive Timeline is the one place
that queries several collections directly (see audit finding on
`AdminActivityLog` above) — each query is `.select()`-scoped, `.lean()`,
and capped by `limit`.

## 9. Verification report

- `node --check` — clean on all new/edited backend files.
- Backend test suite (`node tests/run-all.mjs`) — all 17 pre-existing
  plain-assert tests still passing, unchanged.
- Server boot check — clean boot, only error is
  `ECONNREFUSED 127.0.0.1:27017` (no live MongoDB in this sandbox) — the
  same baseline every prior phase has reported.
- `npm run lint` (ESLint, frontend + backend) — zero errors.
- `npm run build` (Vite) — clean production build; new
  `AdminExecutiveActionCenter` chunk confirmed present in `dist/assets`.
- The one Vitest suite (`api.test.js`) remains **not runnable** in this
  sandbox — `mongodb-memory-server` cannot download its MongoDB binary
  (network-restricted). Consistently flagged as unverified in every phase;
  not claimed as passing here either.

## 10. Deferred items (documented, not fabricated)

- **Full 6-level drill-down chains** (Step 6, e.g. Revenue → Payments →
  Invoices → Doctor → Appointments → Patient → Insurance → Reports →
  Timeline) were not built as a dedicated new navigation layer. The
  existing pages already link to each other one hop at a time (e.g.
  Payments → Refunds, Patients → Records/Insurance); building a bespoke
  multi-hop breadcrumb/drill-down UI across ~8 modules was out of scope
  for this slice and would risk duplicating navigation that already works.
- **AI-generated Morning Brief / Evening Summary / Weekly / Monthly
  reports** (Step 3) were not added as separate new prompt variants beyond
  the existing `executiveBrief`. `executiveBrief` already grounds an
  on-demand executive summary in real data; adding four more near-identical
  prompt variants with no distinct data source behind them would be prompt
  proliferation without new capability. Deferred pending a real trigger
  (e.g. a scheduler) to make "morning" vs "evening" actually meaningful.
- **Retry-window / auto-remediation actions** (e.g. "increase retry
  window" as a one-click action) were not built — there is no configurable
  payment-retry-window setting anywhere in the codebase to change. Surfaced
  only as a text recommendation, not a fabricated button.
- **"Run Automation" / "Trigger Reminder" / "Export Executive Report" quick
  actions** were not added as new endpoints in this controller — they
  already exist (`POST /api/ai/automation/run`, the existing reminder cron
  jobs, `GET /api/admin/exports`) and are reachable from their existing
  pages. Duplicating them here as a second entry point was avoided per the
  "no duplicate APIs" instruction; the Action Center's card buttons link to
  those existing pages instead.
- **Refund/payment failure root-cause categorization** — deferred, see
  audit finding above; no structured field exists to group by.
- Consistent with A5.1/A5.2: no SMS provider, no background job scheduler,
  and the real RBAC roles remain `super_admin`/`admin`/`doctor`/
  `receptionist`/`patient` (no Finance/Support/Operations roles invented).
