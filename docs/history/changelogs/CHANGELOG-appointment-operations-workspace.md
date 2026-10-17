# CHANGELOG — Phase UI-3: Appointment Operations Workspace

## Summary

Rebuilt the Admin Appointment domain from a 917-line legacy CRUD page with
duplicated buttons, a fabricated revenue metric, and no working cancel path
for admins into a connected Appointment Operations Workspace: a real
server-derived dashboard, a lifecycle-aware operational queue with real
filtering/search/pagination, and a tabbed appointment detail workspace
covering patient/doctor/payment/clinical/timeline — all wired to genuine
backend data and existing infrastructure (refunds, payments, permissions,
realtime).

## Real bugs found and fixed (audit)

1. **Always-failing "Complete" button.** The old page called
   `updateAppointmentStatus(id, {status:"completed"})` directly from an
   `approved` row. `STATUS_TRANSITIONS` never allows `approved → completed`
   (it must pass through payment/consultation states first), so this button
   failed on every click. Removed; the dead `appointmentApi.completeAppointment`
   method (which encoded the same invalid transition) is also removed.
2. **Duplicated action buttons.** View/Approve/Complete/Cancel were rendered
   twice per row (copy-paste leftover) in the legacy component.
3. **Dead endpoint.** `appointmentApi.getAppointment(id)` called
   `GET /appointments/:id`, a route that has never existed on the backend
   (only `/` list and `/available-slots` exist) — a guaranteed 404, unused
   anywhere in the app. Removed.
4. **No working admin cancellation path at all.** The only cancel route
   (`PATCH /appointments/:id/cancel`) is patient-owned (403 for admin), and
   the admin page's "Cancel" button called `updateAppointmentStatus` with
   `status:"cancelled"`, which only worked for `pending`/`approved` and
   never created a refund request even when it accidentally succeeded. Admins
   had no way to cancel a paid appointment. Fixed with a new,
   permission-appropriate admin cancel endpoint (see below).
5. **State-machine inconsistency (root cause).** The patient-facing
   `cancelAppointment` decided "cancellable" from a *separate*
   `TERMINAL_STATUSES` list that had drifted out of sync with the canonical
   `STATUS_TRANSITIONS` map — `STATUS_TRANSITIONS` never allows
   `consultation_started → cancelled`, but `TERMINAL_STATUSES` never listed
   `consultation_started` as terminal either, so a consultation already
   under way could still be unilaterally cancelled by the patient. Fixed by
   introducing `CANCELLABLE_STATUSES`, derived programmatically *from*
   `STATUS_TRANSITIONS` (one source of truth, cannot drift again), and using
   it in both the patient and new admin cancellation paths.
6. **Fabricated metric.** "Estimated Revenue" was
   `paidAppointmentCount × ₹1500` — a flat per-visit guess with no relation to
   real `Payment.totalAmount` data. Replaced with a real aggregate over
   captured `Payment` documents, shown only to admins with `manage_payments`.
7. **No pagination, no real filtering.** The old page loaded up to 100
   appointments and filtered/sorted entirely client-side. The new list
   endpoint supports real server-side status/paymentStatus/consultationMode/
   date-range/doctor/patient/search/attention filtering with pagination
   (following the same page/limit/total/pages contract every other admin
   list endpoint in this app already uses).

## Backend — additive, reuses existing infrastructure

- `constants/appointmentStatus.js`: added `CANCELLABLE_STATUSES`, derived
  from `STATUS_TRANSITIONS`.
- `services/appointmentCancellationService.js` (new): the single
  cancellation core (state guard, auto-refund-request creation,
  patient/doctor notification, automation trigger) shared by both the
  existing patient `cancelAppointment` and the new admin cancel — extracted
  so the two paths cannot diverge again the way `TERMINAL_STATUSES` did.
- `controllers/appointmentController.js`: `cancelAppointment` refactored to
  call the shared core; unused imports removed. No other behavior change.
- `controllers/admin/appointmentAdminController.js` (new):
  - `listAppointmentsAdmin` — real filters (`status`, `paymentStatus`,
    `consultationMode`, `doctorId`, `patientId`, `dateFrom`/`dateTo`,
    `quickDate`, `attention`, `search`), pagination, and a real per-row
    `needsAttention` flag computed from actual `status`/`paymentStatus`/
    `date`/`createdAt` fields (documented three-condition rule — never a
    fabricated score). `search` resolves against real patient/doctor names
    server-side before filtering appointments, so it stays index-backed
    rather than downloading the collection to filter in memory.
  - `getAppointmentSummaryAdmin` — every dashboard number is a genuine
    `countDocuments`/aggregate over `Appointment`/`RefundRequest`/`Payment`;
    revenue is gated behind `manage_payments` and omitted (not zeroed) for
    admins without it.
  - `getAppointmentDetailAdmin` — composes the appointment with real
    patient/doctor/payment/refund/prescription/clinical-note/report data.
    Financial fields (`paymentId`, `invoiceId`, payment/refund detail) are
    stripped **server-side** without `manage_payments`, not merely hidden in
    the UI. The timeline is built only from timestamps the schema actually
    stores (`createdAt`, `paidAt`, note/prescription/report `createdAt`,
    `RefundRequest.timeline` entries, `updatedAt` for the current/cancelled
    state) — intermediate per-transition timestamps this schema doesn't
    track are deliberately not fabricated.
  - `cancelAppointmentAdmin` — admin-side cancellation via the shared core;
    requires a non-empty reason.
- `routes/admin/appointmentAdminRoutes.js` (new), registered at
  `/api/admin/appointments` in `app.js`.
- **Reused, not duplicated:** lifecycle transitions (approve/etc.) stay on
  the existing `PUT /appointments/:id/status`; refund review/approve/
  reject/initiate stays on the existing `/api/refunds` routes; payment
  detail stays on the existing `Payment` model — this phase only adds the
  admin-only read surface plus the one genuinely-missing action
  (admin cancel).

## Frontend

- `pages/admin/AdminAppointments.jsx` — full rewrite: clickable metric
  dashboard (today/upcoming/pending/needs-attention/approved/payment-
  pending/completed/cancelled, plus refund-pending/payment-failed/revenue
  when applicable), a real filter bar (status, payment status, consultation
  mode, quick date), and an operational queue with lifecycle-aware actions
  (Approve/Reject on `pending`; Cancel on `approved`/`payment_pending`/
  `payment_completed`; View always) — reusing `AdminTable`/`FilterBar`/
  `StatusBadge`/`MetricCard`/`SectionHeader`/`Select`/`AdminModal`, the same
  primitives every other admin page in this program uses.
- `components/admin/AppointmentDetailWorkspace.jsx` (new) — tabbed detail
  drawer (Overview/Patient/Doctor/Payment/Clinical/Timeline), following the
  exact `DoctorDetailWorkspace.jsx` pattern already established in this
  program. Payment tab shows "Financial information restricted" rather than
  a blank or fake ₹0 when the admin lacks `manage_payments`.
- `components/admin/AppointmentCancelDialog.jsx` (new) — the single
  reason-required cancel/reject dialog, used both by the queue's row-level
  Reject/Cancel buttons and by the detail workspace, so there is exactly one
  such modal in the app rather than two independently-maintained copies.
- `utils/appointmentStatusDisplay.js` (new) — status/payment/consultation-
  mode label+tone mapping, reusing the existing `STATUS_LABELS` text from
  `doctorAppointmentWorkflow.js` so the admin and doctor surfaces never
  disagree on what a status is called.
- `api/adminApi.js` — added `getAppointmentsAdmin`, `getAppointmentSummaryAdmin`,
  `getAppointmentDetailAdmin`, `cancelAppointmentAdmin`.
- `api/appointmentApi.js` — removed the two dead/broken methods described
  above (`getAppointment`, `completeAppointment`); `cancelAppointment` now
  accepts an optional reason.

## Verification

- **Backend tests:** 31/31 passing (29 pre-existing + 2 new —
  `appointmentCancellationGuard.test.mjs` locks in the
  `CANCELLABLE_STATUSES`-derived-from-`STATUS_TRANSITIONS` fix and the
  closed `consultation_started` loophole; `adminAppointmentAttentionAndFinance.test.mjs`
  locks in the non-fabricated attention rule and server-side financial-field
  stripping).
- `node --check` clean on every modified/new backend file.
- Server boot: clean (ECONNREFUSED-only — no live MongoDB in this sandbox,
  same as every prior phase in this program).
- `npx eslint .` (whole repo): **0 errors, 0 warnings**.
- `npm run build`: clean; `AdminAppointments` chunk confirmed in the output,
  confirming the route tree is intact.
- Custom nested-interactive-element scan (button/Button/a/Link/Modal
  nesting) run against all three new/rewritten frontend files: **0
  violations**.
- Route/API duplication check: `/api/admin/appointments` registered exactly
  once; no endpoint added that duplicates an existing one.
- Repo-wide `localhost` scan: no new hardcoded URLs introduced (only
  pre-existing dev-fallback env defaults and a comment referencing the old
  bug it replaced).

## Explicitly deferred (not fabricated)

- **No-show status, emergency/critical flags, doctor-availability context in
  the detail workspace:** the `Appointment`/`Doctor` schemas have no
  corresponding real field to source these from. Rather than invent one,
  the dashboard and detail workspace only surface metrics genuinely backed
  by existing data (the "Needs Attention" rule documented above stands in
  for a risk flag, built entirely from real fields).
- **Reschedule action:** no reschedule endpoint exists anywhere in this
  backend today; building one end-to-end (slot re-validation, notification,
  payment implications) is a substantial feature in its own right and was
  not attempted as a shim inside this phase. Cancel + rebook via the
  existing booking flow remains the supported path.
- **Fine-grained per-transition timeline timestamps** (exact moment of
  approval, exact moment consultation started): genuinely not stored by
  this schema (only `createdAt`/`updatedAt`/`paidAt` exist on `Appointment`)
  and were not fabricated. The timeline instead shows every event that *is*
  backed by a real timestamp, plus a final "current status as of
  `updatedAt`" line.
- **Real browser / live-MongoDB end-to-end click-through testing:** this
  sandbox has neither a live MongoDB instance nor a browser. Verification
  above (tests, lint, build, static scans) is what was actually performed;
  it is reported honestly rather than claimed as full E2E coverage.
