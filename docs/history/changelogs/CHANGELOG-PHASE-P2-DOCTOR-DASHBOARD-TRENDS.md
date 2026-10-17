# PHASE P2 — Doctor Dashboard 2.0 (Trends & Intelligence pass)

## Audit finding

The DOC-07 Command Center redesign already delivered almost everything the
P2 brief asks for: Hero, Today-at-a-Glance, Current/Next Consultation,
Schedule Preview, real Capacity (buildDayCapacity), a deterministic
three-tier Attention Center, Follow-up Work Queue, Clinical Work
Completion, Pending Approvals, Reputation Snapshot, Earnings Snapshot, and
Quick Actions sourced from the shared navigation registry — all backed by
real, already-tested endpoints, with genuine empty/loading/error states
throughout.

The one section of the brief genuinely missing was **§15 Charts / Data
Visualization**. Auditing the backend turned up real, already-computed
trend series that the dashboard fetched but never rendered:

- `analytics.revenueTrend` / `analytics.cancellationTrend` /
  `analytics.revenueForecast` / `analytics.growthForecast` —
  `buildDoctorAnalyticsIntelligence` (`backend/controllers/doctor/workflowController.js`),
  already fetched via `doctorWorkflowApi.getAnalytics()` on every dashboard
  load, but only `analytics.pendingPrescriptions` /
  `analytics.incompleteConsultations` were ever read from it.
- `reviewIntelligence.monthlyTrend` —
  `buildDoctorReviewIntelligence` (`backend/controllers/doctor/doctorReviewController.js`),
  already fetched via `doctorApi.getReviews()`, with only the derived
  `ratingTrendDirection` delta shown (no chart).

This is category **C** from the audit taxonomy — real backend, frontend
disconnected. No new backend calculation, endpoint, or trend engine was
built; this phase only renders data that already existed.

## What changed

**Frontend only — no backend files touched.**

- `src/components/doctor/dashboard/DoctorHomeWidgets.jsx`: new
  `TrendsIntelligencePanel` (Revenue Trend / Cancellation Trend / Rating
  Trend), placed after the existing Reputation + Earnings row, matching
  the brief's Revenue Signals → Trends/Intelligence ordering. Each chart:
  - Has a title, an explicit "Last 6 months" period label, and a deep
    link to the real destination page (Earnings / Schedule / Reviews).
  - Distinguishes **unavailable** (the underlying fetch failed —
    `analytics`/`reviewIntelligence` is `null`) from **empty** (loaded,
    genuinely zero activity in the window) — never silently shows a zero
    for a failed request.
  - Reuses the existing dependency-free `MiniBarChart`
    (`src/components/finance/FinanceCharts.jsx`) rather than introducing a
    charting library or a second chart component.
  - Revenue forecast is shown only once there's at least one real revenue
    month to project from, and is explicitly labeled "a projection, not a
    guarantee" — reusing the existing `revenueForecast`/`growthForecast`
    fields rather than computing a new one.
- `src/components/finance/FinanceCharts.jsx`: additive-only change to
  `MiniBarChart` — each bar now renders an SVG `<title>` tooltip
  (`"<label>: <formatted value>"`) and the chart root gained
  `role="img"`/`aria-label` for accessibility. A new optional
  `barClassName` prop lets each dashboard chart use a distinct color
  without touching the two existing callers
  (`WalletDashboard.jsx`'s monthly credit/debit chart and the Patient
  Financial Ecosystem's spending chart still get the same default blue
  bars they always had). No existing call site's output changed.
- `src/pages/dashboard/DoctorDashboard.jsx`: wired `TrendsIntelligencePanel`
  in, passing the `analytics`/`reviewIntelligence` state the page was
  already fetching — no new API calls added.

## What was deliberately not touched

- The dashboard's `Promise.all` data-loading pattern (all six core calls
  succeed or the page shows one error banner) was audited and left as-is —
  it's the same pattern `PatientDashboard.jsx` uses, so changing it here
  would be an inconsistent, unscoped resilience change rather than a
  documented gap in this brief.
- No new monthly *appointment volume* or *completion* trend series was
  added — the backend has no such series computed anywhere yet, and
  building one would be a new calculation engine outside this pass's
  audit-driven, additive-only scope. Revenue, cancellation, and rating are
  the three real trend series that already existed and were disconnected.

## Verification

- `npx eslint .` — 0 errors, 0 warnings (repo-wide).
- `npm run build` — clean production Vite build.
- `node tests/run-all.mjs` (backend) — 60/60 passing, unchanged (no
  backend files were modified in this phase).
- `node server.js` boot check — clean startup/shutdown; MongoDB
  `ECONNREFUSED` only, consistent with every prior phase (no live MongoDB
  in this sandbox) — **NOT LIVE VERIFIED** against a real database or
  browser, same as every earlier phase.
- Fresh-extraction gate: full zip re-extracted to a clean directory,
  `npm install` (frontend + backend) re-run from scratch, lint/build/tests
  re-run against the fresh extraction — passed.

## Known limitations

- Live browser/MongoDB E2E remains unavailable in this sandbox (as in
  every prior phase) — not claimed as verified.
- No new appointment-volume/completion trend series (see above) —
  explicitly deferred, not a silent omission.
