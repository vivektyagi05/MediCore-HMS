# PHASE DOC-05 — Doctor Reviews & Reputation Workspace

## Audit first (Step 1)

Traced the full existing chain before writing any code: `Review` model →
`doctorReviewController.js` (doctor reply/pin) → `publicController.js`
(`buildDoctorReputationIntelligence`, the Reputation Center's data) →
`reviewAdminAggregates.js` (admin-side attention engine, reused rather than
duplicated) → `DoctorReviews.jsx` / `DoctorReputationCenter.jsx` (frontend) →
`BusinessIntelligenceNav.jsx` (the 5-tab Business Intelligence Platform this
page is one tab of) → `doctorInboxAggregates.js` (Smart Inbox's existing
`/doctor/reviews?reviewId=` deep link) → `patientWorkflowController.js`
(patient-side submission) → `PatientAppointments.jsx` (patient-side review
UI) → `NotificationDelivery` model.

**Key finding that shaped the whole phase:** the brief assumes a single
"Reviews & Reputation Workspace" needs to be built from scratch. The real
architecture already splits this into two focused, sibling pages (Reviews =
action workspace, Reputation = deep analytics/intelligence) under one shared
`BusinessIntelligenceNav`, consistent with the other three Business
Intelligence tabs (Overview/Analytics/Earnings). Rebuilding this into one
mega-page would have broken that established, coherent pattern for no real
gain — so this phase kept the two-page split and substantially upgraded the
Reviews page toward "workspace" per the brief's information hierarchy
(PRIMARY reputation identity → SECONDARY attention → TERTIARY registry),
while having it deep-link to the existing Reputation Center for the
intelligence scores/rating distribution/trend charts it already does well,
rather than duplicating them (Golden Rule: reuse, never duplicate).

## Real bugs found and fixed

1. **Notification mistyping (2 producers).** `replyToReview` and the admin
   `deleteReview` both emitted `type: "appointment"` for a review event, even
   though `entityType` already correctly said `"review"`. This is the exact
   bug class the `NotificationDelivery` enum's own Phase DOC-02 comment
   documents having fixed at two *other* producers — these two were missed.
   `"review"` has been a valid enum value since DOC-02; this is a pure fix,
   not a schema change.

2. **`BusinessIntelligenceNav overview={null}`** on both `DoctorReviews.jsx`
   and `DoctorReputationCenter.jsx` — the nav component supports real stats
   (`Score: X/100`, `X/5 rating`, etc.) but both pages hardcoded `null`, so
   their own nav tiles permanently showed "—" even though the real
   `getBusinessOverview()` call (already used by the sibling Overview page)
   was one fetch away. Both pages now fetch it.

3. **Dashboard attention-list fragility.** `DoctorDashboard.jsx`'s "Unread
   Reviews" attention items were derived by filtering the full `reviews`
   array client-side. Once `getDoctorReviews` returns a real paginated page
   instead of the full set (see below), that filter would have silently
   under-reported — an older unreplied review outside the first page would
   never surface. Fixed by having the Dashboard consume the new
   server-computed `attentionItems` (see below) instead, which is always
   computed from the doctor's *full* review set regardless of pagination.

4. **Patient-side review lifecycle silently stopped at "Doctor responds."**
   Audited the full lifecycle per Step 16 (Patient submits → Doctor receives
   → Doctor sees → Doctor responds → Patient sees response). The backend
   (`patientWorkflowApi.getReviews()`) already returned `doctorReply` in
   full, but no patient-facing page ever rendered it — a doctor's reply was
   invisible to the patient it was written for. Added a doctor-reply card to
   `PatientAppointments.jsx`.

## What was built

### Backend

- **`buildDoctorReviewIntelligence`** (`doctorReviewController.js`) now
  additionally returns:
  - `attentionItems` — a real WHAT/WHY/ACTION queue, reusing the admin
    side's existing `computeReviewAttentionItems()` (`reviewAdminAggregates.js`)
    rather than inventing a second attention engine. Enriched with the
    patient name / appointment date this endpoint already has populated.
  - Real server-side **pagination + search/rating/attention filtering** on
    the returned `reviews` list (Step 9: never fetch-all-and-filter-in-React).
  - A real **month-over-month rating trend** (`ratingTrendDirection`),
    computed only once at least two populated months exist — never
    fabricated for a new doctor.
  - All of the above stats/attention queue are computed from the doctor's
    **full** review set, never from the current page/filter — this is what
    the Dashboard and the page's own hero/attention sections both read, so
    they can never disagree with each other or with whatever page the
    registry happens to be on.
- New **`backend/services/doctorReviewFiltering.js`** — the search/rating/
  attention filter and the deep-link "which page is this review really on"
  resolution logic, extracted as pure, dependency-free functions so they're
  regression-testable without a DB (same pattern as
  `reviewAdminAggregates.js` / `operationsQueuePagination.js`). Wired into
  the controller in place of the inline version.
- **Deep-link resolution**: a `focusReviewId` query param (used by Smart
  Inbox's existing `/doctor/reviews?reviewId=` link, and now also by this
  page's own Attention Workspace items) makes the backend ignore whatever
  filter is active and compute the real page the target review lives on —
  so a deep link always resolves regardless of the doctor's current filter
  state.
- Notification-type bugfixes (see above).
- New `backend/tests/doctorReviewFiltering.test.mjs` — 11 assertions
  covering the filter combinations and the focus-page resolution.

### Frontend

- **`DoctorReviews.jsx` rebuilt** around the brief's information hierarchy:
  - PRIMARY: a reputation identity strip (rating, review count, response
    rate, pinned count, month-over-month trend badge, "Full reputation
    report" link to the Reputation Center) — not a wall of MetricCards.
  - SECONDARY: an Attention Workspace — each item states WHAT (title), WHY
    (reason), and has a real ACTION button, never a bare count.
  - TERTIARY: the review registry — search/rating/attention filters, real
    server-side pagination (Prev/Next, same pattern as
    `AdminOperationsCenter.jsx`), progressive disclosure (short preview
    card → full detail on click).
  - AI Review Summary panel retained as-is (already real, already grounded).
- New **`DoctorReviewDetailDrawer.jsx`** (`src/components/doctor/`) — the
  focused per-review workspace (Step 6/7/8): full comment, visit context,
  read-only reply once one exists (the backend itself refuses a second
  reply — no edit button is shown for a workflow the API can't perform),
  a real compose-and-send flow otherwise, pin toggle, and deep links to
  the Patient Relationship Center / Clinical Workspace (never duplicating
  them). Same architectural pattern as the existing
  `DoctorAppointmentDetailDrawer.jsx`.
- **`DoctorReputationCenter.jsx`**: fixed the dead `overview={null}` bug
  (see above) — no other changes; its own intelligence scores, rating
  distribution, and trend charts were already real and are not touched.
- **`DoctorDashboard.jsx`**: attention-list fix (see above).
- **`PatientAppointments.jsx`**: doctor-reply display (see above).
- **`doctorApi.getReviews()`** now accepts query params (page/limit/search/
  rating/attention/focusReviewId).

## Deliberately NOT done

- **Not merged into a single "Reviews & Reputation" mega-page.** Explained
  above — the existing two-page, five-tab Business Intelligence architecture
  is coherent and the brief's own Golden Rule ("if another page already
  provides the functionality, deep-link to it instead of duplicating it")
  argues against merging. The Reviews page now surfaces the reputation
  identity at a glance and links to the full Reputation Center for depth.
- **Realtime**: reused the existing `dashboardSyncTick` convention (the same
  one every other Business Intelligence page uses) rather than adding a new
  socket event class for reviews — audited and confirmed no dedicated
  review-realtime event exists anywhere else in the codebase to be
  inconsistent with.
- **No new backend attention engine**: deliberately reused the admin side's
  `computeReviewAttentionItems()` rather than writing a doctor-specific
  version, so the severity rule a doctor sees can never drift from what an
  admin sees for the same review.
- **Live browser/Mongo E2E**: unavailable in this sandbox (no MongoDB/
  browser), consistent with every prior phase — explicitly NOT claimed.

## Verification

- `node --check` clean on every backend `.js` file (repo-wide sweep, not
  just touched files).
- Full backend suite: **56/56 passing** (55 pre-existing, unchanged +
  1 new `doctorReviewFiltering.test.mjs`, 11 assertions).
- `npx eslint .`: **0 errors, 0 warnings**, repo-wide.
- `npm run build`: clean; `DoctorReviews`, `DoctorReputationCenter`,
  `DoctorDashboard`, `PatientAppointments` chunks all present and grown,
  confirming compilation of the new content.
- Server boot: clean (`ECONNREFUSED`-only — no MongoDB in this sandbox,
  consistent with every prior phase).
- Fake-data / hardcoded-localhost sweep: clean on every touched file.
- Nested-interactive (button-in-button) scan: clean on every touched JSX
  file.
- Duplicate route-mount check: the only overlapping `/api/doctor` /
  `/api/auth` / `/api/realtime` prefixes are pre-existing, legitimate
  multi-router mounts untouched by this phase (no route files were changed
  this pass).
- **Fresh-extract gate**: re-extracted the final zip to a clean directory,
  reinstalled dependencies at root + backend from scratch, and re-ran the
  full suite + eslint + build + boot check against that extraction only
  (not the working copy) — identical results (56/56 passing, 0 lint
  issues, clean build with identical asset hashes, clean ECONNREFUSED-only
  boot).

Deliverable: `MediCore-HMS-PHASE-DOC-05-REVIEWS-REPUTATION.zip` +
`CHANGELOG-PHASE-DOC-05-REVIEWS-REPUTATION.md`.
