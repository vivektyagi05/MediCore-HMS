# Phase DOC-02 — Doctor Smart Inbox

## Summary

Rebuilt the Doctor Smart Inbox from a flat, type-grouped notification list
into a real work queue: deterministic Urgent / Action Required / Information
prioritization, correct categorization, real per-item actions that deep-link
into the app with doctor+patient context preserved, search, filters, real
pagination, and a realtime gap fix — all on top of the existing
NotificationDelivery pipeline. No new notification system, no new AI
architecture, no dummy data anywhere.

## IMPLEMENTED

**Backend**
- `backend/services/doctorInboxAggregates.js` (new, pure/dependency-free):
  `resolveCategory`, `classifyPriority`, `resolveAction`, `priorityWeight`.
  Category resolves from `entityType` first (falls back to `type`) so it's
  correct even for historical rows created before the type-field bugfix
  below — no DB migration needed. Priority is derived only from real
  persisted state (severity, plus a few entityType-specific overrides using
  real batched context) — never randomly or AI-assigned. Action resolution
  reuses the existing `/doctor/clinical?patientId=...&tab=history`
  convention already shipped on the Doctor Dashboard, plus new
  `?reviewId=`/`?documentId=`/`?payoutId=` deep links (see below) — and
  returns `null` (no button) rather than inventing a route when no real
  destination/context exists (e.g. automation/workflow broadcasts).
- `backend/controllers/realtimeController.js` — `getSmartInbox` rewritten.
  One bounded query (`INBOX_SCAN_CEILING = 500`, same pattern as
  governance's `GOVERNANCE_SCAN_CEILING`) loads the doctor's own recent
  notifications; a handful of small batched `$in` lookups (never N+1 — one
  query per entity type actually present) resolve `appointmentStatus` /
  `patientId` / `reviewReplied` context. Category/priority/action are
  computed once per item and reused for both the attention summary and the
  filtered, paginated item list. Real pagination via the existing
  `paginationValidation.js` (`clampPagination`/`buildPaginationMeta`) —
  replaces the old hardcoded `limit(200)`. Response now returns
  `{ items, attentionSummary, categories, pagination }`.
- `backend/models/NotificationDelivery.js` — additive enum values `"review"`,
  `"payout"`.
- **Real bug fixed** — `backend/controllers/patient/patientWorkflowController.js`
  (`upsertReview`) and `backend/controllers/financeController.js`
  (payout-settled notice): both doctor-facing notifications were typed
  `"appointment"` despite `entityType` already correctly saying
  `"review"`/`"payout"` — this mis-grouped them under "Appointments" in any
  type-based UI. Fixed at the source (now typed correctly) *and* the
  categorizer prefers `entityType`, so existing/historical rows also
  categorize correctly without a migration.
- **Real gap fixed** — the review-submitted-to-doctor notification never
  included the patient's name ("A patient left a 4-star review"), failing
  the phase's information-density requirement. Now reads `req.user.name`
  (already authenticated, no extra query): "Vivek Tyagi left a 4-star
  review."
- `backend/realtime/appointmentEmitter.js` — added `metadata: { status }` to
  the doctor "new appointment booked" notification (additive Mixed field,
  same pattern already used by `paymentEmitter`'s `invoiceId`/
  `refundRequestId`) so a still-pending booking can be classified Action
  Required without a second lookup.

**Frontend**
- `src/pages/doctor/DoctorSmartInbox.jsx` — full rebuild per the phase brief:
  header, search + category/unread filters, priority tabs, an Attention
  Summary strip (Urgent / Action Required / Unread), items rendered in
  priority-tier runs (Urgent/Action Required tier first, then Information),
  real Loader/ErrorState(retry)/contextual EmptyState (different copy for
  "no urgent items" vs "all caught up" vs "no search results"), and
  Prev/Next pagination.
- Deep-link support added to 3 destination pages (all additive, existing
  behavior unchanged when the query param is absent):
  - `DoctorReviews.jsx` — `?reviewId=` clears filters and scrolls/highlights
    the matching review card.
  - `DoctorDocuments.jsx` — `?documentId=` same pattern, via a new optional
    `highlightRowId`/`highlightedRowRef` prop pair on the shared
    `AdminTable` component (opt-in only — the other 12 existing consumers
    of `AdminTable` are visually unaffected since they don't pass it).
  - `DoctorEarnings.jsx` — `?payoutId=` same pattern; search also extended
    to match a payout's own `_id`, not just its appointment id.
  - Appointment/prescription/report inbox items need no destination-page
    changes at all — they reuse the exact existing
    `/doctor/clinical?patientId=...&tab=history` convention the Dashboard's
    Attention Center already uses.

## FIXED
- Review and payout notifications mis-categorized under "Appointments"
  (wrong `type` field vs. correct `entityType`) — see above.
- Missing patient name in review-submitted notification (information
  density gap).
- No pagination on Smart Inbox (`limit(200)` hardcoded) — now real
  page/pageSize with proper meta.
- Realtime gap: the page previously only refetched on `dashboardSyncTick`,
  which several producers (review, document-verified, subscription-updated)
  never trigger — they only emit `notification:new`. The page now also
  reacts to `RealtimeContext`'s `notifications` head-id+length signal
  (ignores read-state-only updates so `markNotificationRead` doesn't cause
  a redundant refetch loop).

## REUSED
- `notificationEmitter` / `NotificationDelivery` pipeline — unchanged, no
  second notification system introduced.
- `paginationValidation.js` (`clampPagination`/`buildPaginationMeta`) — no
  new pagination helper invented.
- `markNotificationRead` endpoint/ownership scoping (`recipientId: req.user._id`)
  — unchanged; already doctor-scoped and secure (STEP 15).
- `AdminTable`, `Card`, `Button`, `Badge`, `EmptyState`, `ErrorState`,
  `Loader` design-system primitives — no new UI primitives built.
- Existing `/doctor/clinical?patientId=...&tab=history` deep-link
  convention (from the Doctor Dashboard's Attention Center) — reused as-is
  for appointment/prescription/report actions.

## TESTED
- New `backend/tests/doctorInboxAggregates.test.mjs` — 12 assertions,
  dependency-free (no DB), covers: category resolution preferring
  `entityType` over stale `type` (the historical-row fix), fallback to
  `type`, unresolvable-category safety, critical-severity-always-urgent,
  pending-appointment and unreplied-review action-required overrides,
  warning-severity default, priority ordering, all real action
  destinations (including the "no patientId resolved → no invented route"
  case), and the automation/workflow "no fabricated route" case.
- Full backend suite: 50/50 passing (49 pre-existing unchanged + 1 new).
- `node --check` clean on every touched backend file.
- `npx eslint .` — 0 errors/0 warnings repo-wide.
- `npm run build` — clean; `DoctorSmartInbox`/`DoctorReviews`/
  `DoctorDocuments`/`DoctorEarnings` chunks confirmed present and compiled.
- Clean server boot (`ECONNREFUSED`-only, no live MongoDB in this sandbox —
  consistent with every prior phase).
- Zero duplicate `/api/*` route mounts; fake-data/hardcoded-localhost sweep
  of all touched files clean.
- **Fresh-extract gate**: zipped the working tree, extracted to a clean
  directory, reinstalled dependencies at root + backend, and re-ran the
  full suite/lint/build/boot against the extracted copy only (not the
  working copy) — identical results.

## REMAINING (explicitly not done, stated plainly)
- No live MongoDB/browser E2E — not available in this sandbox, consistent
  with every prior phase. The developer should manually verify against
  running data: unread/read lifecycle across a refresh, realtime arrival of
  a review/document/subscription notification without a manual reload, and
  that every deep link lands on the correct, doctor-scoped record.
- AI was deliberately **not** added to this phase. STEP 17 permits AI only
  where it provides genuine value and explicitly discourages building new
  AI architecture just for one phase; no existing "summarize my inbox"
  capability exists to reuse, and the deterministic classifier already
  meets the phase's prioritization requirements without any fabrication
  risk. This was a deliberate scope decision, not an oversight.
- `workflow_assigned` / `workflow_escalated` / generic `automation`/
  `reminder` notifications (these mostly target admin/ops roles, not
  doctors) render as information-only with no action button, since their
  `entityId` (an operation key or arbitrary `triggerType`) doesn't map to a
  real doctor-facing route — per STEP 4, no route was invented for these.
- `DoctorAppointments.jsx` was **not** modified — appointment inbox actions
  deliberately reuse the Clinical Workspace deep link instead of a new
  `?appointmentId=` convention on the Appointments page itself, since that
  already gets the doctor to the right patient context with zero new page
  work. If a future phase wants the queue itself to deep-link/highlight a
  specific appointment row, that's a small, isolated addition on top of
  this.
