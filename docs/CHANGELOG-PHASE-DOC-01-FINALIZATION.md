# PHASE DOC-01 — Doctor Dashboard Command Center Finalization

Audited `DoctorDashboard.jsx` end-to-end against the existing backend
(`commandCenterController`, `workflowController` analytics, `doctorReviewController`,
`doctorController.getDoctorPatients`, `doctorRoutes.js`, `AppRoutes.jsx`,
`navigation.js`) before writing anything. Almost every data source the brief
asked for already existed and was real (command center queue/risk/report/
insurance data, review intelligence, analytics, earnings, schedule) — nothing
was rebuilt. Work was root-cause fixes plus one genuine information-
architecture rebuild of the page itself.

## What was changed

**Data-correctness bug (the exact class of bug the brief called out as an
example):** `analytics.approvalRate` is a 0–1 ratio from the backend (e.g.
`0.89`). The dashboard rendered it as `` `${approvalRate}%` `` → literally
"0.89%" instead of "89%". `DoctorAnalytics.jsx` already had the correct
`Math.round(approvalRate * 100)}%` conversion — matched that existing
convention instead of inventing a new one.

**Information architecture rebuild** (per the 13-section brief), replacing
~10 disconnected/duplicative cards with:
- **Attention Center** (new): URGENT / NEEDS ACTION / INFORMATION tiers, each
  item with a direct action, built from real `commandCenter` data (emergency
  queue, delayed patients, critical reports, overdue follow-ups, expiring
  insurance, unread critical alerts) plus review intelligence (unreplied
  reviews) and analytics (pending prescriptions, pending approvals). Falls
  back to a minimal locally-computed emergency list only if `commandCenter`
  fails to load.
- Removed: the old top 6-card stat grid, second 4-card stat grid, "My Clinic
  Today" card's internal Priority Queue / Delayed / Pending Reports /
  Insurance Expiring / Follow-ups Due subsections, and the standalone
  "Emergency Alerts" card — all of that signal now lives in the Attention
  Center instead of being scattered and repeated.
- **Practice Snapshot** and a slim 4-metric top strip replace the old two
  disconnected StatCard grids, now built on the shared `DoctorMetricCard`
  component (already used by `DoctorAnalytics.jsx`) instead of a
  page-local duplicate.
- **Earnings Snapshot**: merged the two separate Weekly/Monthly Earnings
  cards into one card with Today/Week/Month + a link to `/doctor/earnings`
  (dashboard stays a summary, not a second Earnings page, per the brief).
- **Follow-up Queue** rebuilt on `commandCenter.followUpsDue` (real
  Prescription.followUpDate data) instead of the old `patient.needsFollowUp`
  heuristic (days-since-last-visit), and now groups Overdue / Due Today /
  Upcoming as three distinct buckets, per the brief.
- **Current Consultation** moved above Today's Clinic (product goal: highest
  visibility for an active consultation) and gained an explicit "Open
  Clinical Workspace" action alongside "End Consultation".
- **Quick Actions** rebuilt to read from `buildNavigation(t)` in
  `src/config/navigation.js` — the sidebar's own source of truth — instead
  of a second hand-maintained list. Previously only 6 of ~17 real doctor
  routes were linked (missing Smart Inbox, Documents, Analytics, Reputation,
  Practice, Verification, Subscription/Billing, Professional Profile,
  Practice Settings). Every button is now guaranteed to point at a real,
  currently-mounted route, grouped the same way the sidebar groups them.
- Header now shows the doctor's real name (`useAuth().user.name`) and a real
  "Last synced {time}" timestamp set only after a successful load — no fake
  synchronization time.
- Replaced the plain red `<div>` error banner with the existing `ErrorState`
  component (title/description/Retry), consistent with the rest of the app.
- `reviewsRes.data` is now stored in full (not just the array) so the
  dashboard reads the backend's own `unrepliedCount` instead of recomputing
  it a second time client-side; unreplied reviews now appear in the Attention
  Center with a direct "Reply" link to `/doctor/reviews`.

## Backend/API changes (all additive, single-consumer, zero breaking changes)

- `backend/controllers/doctor/commandCenterController.js`:
  - `followUpsDue` query window widened from "≤ end of today" to a 14-day
    forward horizon, and each item now carries a `bucket`
    (`overdue`/`due_today`/`upcoming`) and `patientId` — needed so the
    dashboard can distinguish and directly link the three buckets the brief
    asked for. Grepped every consumer of `buildDoctorCommandCenterData`/
    `followUpsDue` first — the dashboard is the only one, so this is safe.
  - `pendingInsuranceExpiring` items now include `patientId` (the query
    already populated it; it just wasn't in the output shape) so each
    expiring-insurance item can link directly to the patient instead of
    being a dead-end text row (Smart Box Rule).
- `src/config/navigation.js`: added the one real doctor route
  (`/doctor/profile/edit`, "Professional Profile") that existed in
  `AppRoutes.jsx` but had never been added to the navigation source of
  truth — it was reachable by URL but linked from nowhere in the UI. This
  fixes both the sidebar and, by extension, the rebuilt Quick Actions.

## Cross-side changes

None beyond the two additive backend fields above and the one navigation
entry — no other Doctor/Admin/Patient page consumes the changed shapes.

## Tests / build / lint

- Backend: 49/49 tests passing (unchanged count — no new pure-logic module
  was introduced this pass; the two data-shape additions are covered by
  exercising the existing consumer, the dashboard itself).
- `node --check` clean on every backend file.
- Clean server boot (ECONNREFUSED-only — no live MongoDB in this sandbox,
  consistent with every prior phase).
- `npx eslint .` — 0 errors, 0 warnings, repo-wide.
- `npm run build` — clean; `DoctorDashboard` chunk present and grew
  (20.93 kB), confirming the rewrite compiled; every other existing chunk
  still present.
- Fake-data / hardcoded-localhost / nested-interactive greps on all
  touched files: clean.
- **Fresh-extract gate**: re-extracted the final zip to a clean directory,
  reinstalled dependencies at root and `backend/` from scratch, and re-ran
  the full test suite, lint, build, and boot check against that extracted
  copy only (not the working copy) — identical results (49/49, 0/0, clean
  build, clean boot).

## Explicitly NOT done / remaining issues

- No live browser/live-MongoDB E2E (no Mongo/browser available in this
  sandbox, consistent with every phase to date).
- Smart Search remains patient-name/email only (real, backed by the already-
  loaded patients list). Did not add appointment-level search, because no
  existing page supports deep-linking to a single appointment by ID — adding
  that would mean building new navigation/routing beyond this phase's scope,
  not just wiring up an existing capability.
- The two pre-existing, previously-flagged-and-deferred items from the prior
  DOC-01 pass are still open and out of scope for this pass: the unbounded
  `getDoctorPatients` (`/doctors/patients`) query (shared with the standalone
  Patient Directory page — needs both consumers touched together), and the
  same `limit:200`/100-cap truncation pattern on `PatientAppointments.jsx`/
  `PatientDoctors.jsx` (patient-side backlog).
- Did not add per-item deep-linking for the Live Activity Feed (notification
  → its specific entity) beyond a single "Open Inbox" link — the notification
  payload carries `entityType`/`entityId` but no existing doctor page accepts
  an arbitrary entity ID to deep-link to (e.g. one specific appointment or
  review); building that is a larger, cross-page change beyond this phase.
