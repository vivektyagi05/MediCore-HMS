# PHASE UI-8 — Reviews Management, Moderation & Reputation Operations Workspace

## Audit Findings

Full lifecycle traced before writing any code (patient submit → doctor
sees/replies → rating recalculation → admin inspect/manage → AI → realtime):

- **`Review` model** (`backend/models/Review.js`) already has everything the
  brief needs at the schema level: `rating`, `comment`, `isPinned`,
  `doctorReply{message,repliedAt}`, `adminDeleted/adminDeletedAt/adminDeletedBy`,
  `editHistory[]`. No schema changes were needed or made.
- **Doctor side is complete and correct**: `doctorReviewController.js` already
  has real reply (`replyToReview`, ownership-gated, one reply per review — no
  edit) and real pin/unpin (`togglePinReview`, ownership-gated), plus a shared
  `buildDoctorReviewIntelligence()` builder already reused by both the Doctor
  Reviews page and the Doctor Business Overview. `DoctorReviews.jsx` is a
  well-built page (server-driven, real filters, real pin UI, real reply UI) —
  **left completely untouched**, per the "don't break Doctor Reviews" rule.
- **Reputation intelligence already exists and is complete**:
  `buildDoctorReputationIntelligence()` in `publicController.js` computes real
  `businessReputationScore`, `patientTrustScore`, `clinicalReliabilityScore`,
  `responseRate`, `appointmentReliability`, `repeatPatientRate`,
  `topStrengths`/`improvementOpportunities` — all transparent weighted
  averages of real numbers, documented in the source, never fabricated. It is
  already exposed to admins via `GET /admin/doctors/:id`
  (`doctorAdminController.getDoctorDetailAdmin`). **Not recalculated anywhere
  in this phase.**
- **AI review sentiment already exists and is complete**:
  `generativeAssistant.reviewSentiment({ doctorId })` via the existing
  promptLibrary → templateProvider → generativeAssistant → controller → route
  pipeline, exposed at `GET /api/ai/assist/admin/review-sentiment`, and already
  accepts an optional `doctorId` (platform-wide when omitted, doctor-scoped
  when supplied). **No new AI capability, prompt, or provider was added.**
- **Admin side was the real gap.** `adminReviewController.js` had only
  `getAllReviews` (no pagination, no server-side filtering, no KPIs, no
  attention queue, no detail workspace) and `deleteReview` (soft delete,
  functionally correct). `AdminReviews.jsx` was a legacy, fully
  client-side-filtered page with `window.confirm()` and two dishonest UI
  elements:
  - An "AI: Draft a reply" button that generated a draft admins can **never
    actually submit** — `replyToReview` is ownership-gated to the doctor only.
    This was a fake action with no real backend capability behind it.
  - No visibility into `isPinned`, `doctorReply`, or any KPI beyond a raw
    total/average computed client-side from whatever page of data happened to
    be loaded.
- **Real bug found**: `deleteReview` (the one real state-changing admin
  action on this whole surface) never called `writeAdminLog`, unlike every
  other state-changing admin action in the app (appointment cancel, refund
  actions, service/CMS/settings changes, etc). This is a genuine audit-logging
  gap, not a stylistic one.

## Existing Functionality Reused (not duplicated)

- `computeAverageRating` / `recalculateAndPersistDoctorRating`
  (`reviewRatingService.js`) — doctor rating math, unchanged, imported not
  reimplemented.
- `buildDoctorReputationIntelligence()` (`publicController.js`) via the
  existing `GET /admin/doctors/:id` — the new Review Workspace's Reputation
  tab calls this endpoint directly; there is no second reputation calculation
  anywhere in this phase.
- `generativeAssistant.reviewSentiment` via the existing
  `GET /api/ai/assist/admin/review-sentiment` — reused for both the
  platform-wide sentiment panel (registry page) and a doctor-scoped panel
  (Review Workspace), by passing/omitting the `doctorId` param the endpoint
  already supports.
- `writeAdminLog` (`utils/adminAudit.js`) — reused, not a new logging system.
- `notificationEmitter` — reused as-is for the existing "review removed"
  patient notification.
- `dashboardSyncTick` (`RealtimeContext`) — reused as the realtime-refresh
  signal for the registry, KPI strip, and attention queue. No new Socket.IO
  channel or polling loop was introduced.
- Shared design-system primitives: `AdminTable`, `FilterBar`, `AdminModal`,
  `ConfirmDialog`, `MetricCard`, `SectionHeader`, `StatusBadge`, `ErrorState`,
  `Tabs`, `AIDraftPanel`, `Button`, `Card`, `Select` — all reused as-is,
  following the exact template established by `AdminAppointments.jsx` +
  `AppointmentDetailWorkspace.jsx` / `DoctorDetailWorkspace.jsx`.

## New Implementation

- **`backend/services/reviewAdminAggregates.js`** (new) — the single source
  of truth for the two pure, DB-independent calculations this phase needed:
  - `computeReviewAttentionItems(reviews)` — deterministic attention engine.
    Rules, in priority order: negative (rating ≤ 2) + unreplied → `critical`;
    negative only → `warning`; unreplied only → `warning`; pinned (and
    otherwise clean) → `info`. No emotion, abuse, fraud, or urgency is
    inferred — only what the schema actually records.
  - `buildReviewSummary(reviews)` — KPI strip math (total, average rating,
    negative count, unreplied count, pinned count, response rate). Returns
    `null` (not a fabricated `0`/`0%`) for `averageRating`/`responseRate` when
    there are zero reviews; the frontend renders these as "N/A".
- **`backend/controllers/admin/adminReviewController.js`** (rewritten,
  additive):
  - `listReviewsAdmin` — real server-side search (patient name/email, doctor
    name — resolved via `User`/`Doctor` lookups, same pattern as
    `appointmentAdminController.resolveSearchFilter`), filters (sentiment,
    replied/unreplied, pinned/unpinned, exact rating), and pagination.
  - `getReviewSummaryAdmin` — platform-wide KPIs via `buildReviewSummary`.
  - `getReviewAttentionQueueAdmin` — attention queue via
    `computeReviewAttentionItems`, capped at 25 items, sorted critical → info.
  - `getReviewDetailAdmin` — Review Workspace aggregate: the review with real
    doctor/patient/appointment context, and a timeline built **only** from
    real stored timestamps (`createdAt`, `editHistory[].editedAt`,
    `doctorReply.repliedAt`, `adminDeletedAt`). `isPinned` has no stored
    transition timestamp anywhere in the schema, so pin state is shown as a
    current fact, never a fabricated "pinned at" event
    (`pinTimestampAvailable: false` returned explicitly).
  - `deleteReview` — same soft-delete behavior, **plus the `writeAdminLog`
    call it was missing** (bugfix).
- **`backend/routes/adminReviewRoutes.js`** (rewritten) — `GET /summary` and
  `GET /attention-queue` mounted before `GET /:id` (Express ordering, same
  convention as every other admin routes file); switched from
  `authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN)` to `protect + requireAdmin`
  for consistency with every other admin route file in the app — functionally
  identical (`requireAdmin` checks the same `ADMIN_ROLES` set). **No new
  permission key was created**; the whole surface stays role-gated exactly as
  it already was, matching the brief's "do not invent new roles" instruction.
- **`src/api/adminReviewApi.js`** (extended) — `getReviewSummary`,
  `getReviewAttentionQueue`, `getReviewDetail` added; `getReviews` now accepts
  filter/pagination params; `deleteReview` unchanged.
- **`src/components/admin/ReviewDetailWorkspace.jsx`** (new) — the Review
  Workspace modal content, five tabs:
  - **Review** — rating, comment, submission date, edited-by-patient flag.
  - **Response** — doctor's reply if present; if not, an honest explanation
    that only the doctor can reply (no fake compose box for admins).
  - **Context** — doctor (name, specialization), patient (name, email),
    appointment (date, time slot) — only real, already-available fields.
  - **Reputation** — calls `adminApi.getDoctorDetailAdmin(doctorId)` and
    renders its `reputation`/`reviews` fields exactly as
    `DoctorDetailWorkspace.jsx`'s own Reputation tab does. Zero duplicate
    calculation.
  - **Timeline** — real timestamped events only, plus an explicit note when
    the review is pinned that no pin timestamp exists to show.
  - A "Remove Review" action wired to `ConfirmDialog` (not `window.confirm`)
    and the real delete endpoint.
- **`src/pages/admin/AdminReviews.jsx`** (full rewrite) — KPI strip → Attention
  Queue → platform-wide AI Sentiment panel → FilterBar → server-paginated
  `AdminTable` registry → `AdminModal`-hosted Review Workspace, following the
  page hierarchy the brief specifies. Server-side search/filter/pagination
  (no more full-collection client-side filtering). `ConfirmDialog` replaces
  `window.confirm()` for delete. Fake "AI draft reply" button removed (no
  backend capability ever existed for an admin to actually submit that
  reply). Empty states are honest ("No reviews have been submitted yet." /
  filtered-empty variant) — no sample/fake reviews ever rendered.

## Files Changed

- New: `backend/services/reviewAdminAggregates.js`
- New: `backend/tests/reviewAdminAttention.test.mjs`
- New: `src/components/admin/ReviewDetailWorkspace.jsx`
- Modified: `backend/controllers/admin/adminReviewController.js`
- Modified: `backend/routes/adminReviewRoutes.js`
- Modified: `src/api/adminReviewApi.js`
- Modified: `src/pages/admin/AdminReviews.jsx`

## APIs Added / Changed

All under the existing `/api/admin/reviews` mount (`backend/app.js`, single
mount point, unchanged):

- `GET /api/admin/reviews` — now server-side filtered/paginated (was:
  unfiltered, unpaginated, full-list-only).
- `GET /api/admin/reviews/summary` — new.
- `GET /api/admin/reviews/attention-queue` — new.
- `GET /api/admin/reviews/:id` — new (Review Workspace aggregate).
- `DELETE /api/admin/reviews/:id` — unchanged behavior, now writes an
  `AdminActivityLog` entry (bugfix).

No changes to any doctor-side or patient-side review route. No changes to
`GET /api/ai/assist/admin/review-sentiment` (reused as-is, both call sites —
platform-wide and doctor-scoped — already supported by its existing optional
`doctorId` param).

## Database Changes

None. No new fields, no new indexes, no new collections. The existing
`Review` schema already had every field this phase needed.

## AI Changes

None — no new prompt, template, provider, or pipeline. The existing
`reviewSentiment` capability is called twice from the new UI (once
platform-wide on the registry page, once doctor-scoped inside the Review
Workspace), both through its existing, unmodified endpoint and parameter
contract.

## UI Changes

- `AdminReviews.jsx`: full rewrite (see "New Implementation" above).
- `ReviewDetailWorkspace.jsx`: new component.
- `DoctorReviews.jsx`: **untouched** — audited and confirmed already correct.

## Security

- Whole surface stays behind `protect + requireAdmin` (admin/super_admin
  only) — same role set as before, no permission escalation, no new
  permission key invented.
- `getReviewDetailAdmin` / `listReviewsAdmin` never trust a client-supplied
  doctor/patient identity for anything beyond a read filter; all writes
  (delete) re-verify the review server-side (`Review.findById`) before
  mutating.
- No sensitive clinical data is exposed — the Context tab only surfaces
  fields already present on `Review`'s existing populated refs (doctor
  name/specialization, patient name/email, appointment date/time).

## Error Handling

- `loadReviews`/`loadSummary`/`loadAttentionQueue`/`loadDetail` each have
  distinct loading/error/empty states. KPI strip and attention queue fail
  silently into "not rendered" (non-critical, no fabricated fallback number)
  per the same pattern `AdminAppointments.jsx` already uses for its summary
  call; the registry list itself uses `ErrorState` with a real retry action
  and the real backend error message via `getApiErrorMessage()`.
- Delete failures surface the real server message via `getApiErrorMessage()`
  with an honest fallback string, never a bare "Error".

## Realtime

- Registry, KPI strip, and attention queue all re-fetch on `dashboardSyncTick`
  changes (existing `RealtimeContext` signal) — no new socket channel, no
  polling loop.

## Tests

- New `backend/tests/reviewAdminAttention.test.mjs` (dependency-free, plain
  `assert`, 15 assertions) covering: negative+unreplied → critical
  classification and top-of-queue ranking; negative-but-replied → warning;
  unreplied-but-positive → warning; pinned-and-otherwise-clean → info; a
  clean review produces no attention item; empty input → empty queue;
  KPI summary math (totals, negative/unreplied/pinned counts, response
  rate); and the explicit `null` (not fabricated `0`/`0%`) behavior for
  `averageRating`/`responseRate` on zero reviews.
- All pre-existing tests re-run unmodified.

## Verification

- `node --check` clean on every backend `.js` file (including all
  new/modified files).
- Full backend regression suite: **38/38 passing** (37 pre-existing + 1 new,
  15 assertions).
- `npx eslint .` across the whole frontend repo: **0 errors, 0 warnings**.
- `npm run build`: clean, `AdminReviews` chunk confirmed present
  (16.83 kB / 4.76 kB gzip).
- Server boot: clean (`ECONNREFUSED`-only against `127.0.0.1:27017` — no live
  MongoDB in this sandbox, same as every prior phase).
- Custom nested-interactive-element scan (button-in-button, Link-in-button,
  etc.): **0 violations** in both new/rewritten frontend files.
- Route/API mapping check: every `adminReviewApi` and AI-review-sentiment
  call maps 1:1 to a real, single, mounted backend route (`/api/admin/reviews`
  mounted exactly once in `app.js`; `/api/ai/assist/admin/review-sentiment`
  unchanged).
- Hardcoded-localhost scan: clean on all new/modified files.
- Doctor Reviews / patient submission / notification / realtime chain
  spot-checked by re-reading the code paths end-to-end — no regression
  introduced, no file in that chain modified.

## Live Verification Status

**NOT LIVE VERIFIED — ENVIRONMENT LIMITATION.** This sandbox has no running
MongoDB instance and no browser, so the 16-step live E2E checklist (create a
real review, open Admin Reviews, search/filter it, open the workspace, pin,
verify KPI changes, verify AI, verify realtime, verify unauthorized rejection,
etc.) could not be executed against live infrastructure. Everything above —
static verification, test suite, build, boot, route mapping, and manual code
trace of every consumer — was performed to the maximum extent possible
without live infrastructure.

## Explicit Deferrals / Known Limitations

- **Admin cannot pin/unpin or reply to a review.** This is intentional, not
  an oversight: those actions are ownership-gated to the doctor by design
  (`doctorReviewController.js`), and the brief explicitly says "never show a
  button for an action that doesn't exist" / "reuse existing capability, do
  not invent." Building an admin-side pin/reply would be a second,
  admin-privileged mutation path the existing domain model doesn't have, and
  was not genuinely required — the brief's filter requirements (Pinned /
  Unpinned) only need read access to `isPinned`, which this phase provides.
- **No pin/unpin timestamp in the Timeline tab.** The schema has never
  tracked one; fabricating one was explicitly disallowed. Current pin state
  is shown as a fact instead.
- **No new admin permission key** (e.g. a hypothetical `manage_reviews`).
  The existing role-only gate (`admin`/`super_admin`) was kept as-is, per the
  "do not invent new roles/permissions" instruction.
- **No hard-delete / restore workflow.** Only the existing soft-delete
  (`adminDeleted`) exists; a genuine hard-delete or "restore a deleted
  review" capability does not exist anywhere in the backend and was not
  invented.
- Real browser / live-Mongo end-to-end run — not performed (sandbox has
  neither), see "Live Verification Status" above.
