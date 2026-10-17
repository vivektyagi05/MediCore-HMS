# Phase P4 — Appointment 2.0

## Audit findings

The appointment domain was audited end-to-end (backend controller/routes/
services/utils, all four appointment-facing frontend pages, the shared
cancel/reschedule dialogs, the doctor detail drawer, the realtime emitter,
and the cancellation service) before any code was changed, per the
MediCore-PRIME-20 rule against rebuilding what already works.

**Conclusion: the appointment booking engine, availability/capacity engine,
status-transition machine, and cancellation service are all real, single-
source-of-truth, and already correctly connected across Doctor ↔ Patient ↔
Admin** (built across Phases DOC-04, DOC-07, and P3). No second engine of
any kind was built. Real, server-side search/pagination/date-range/status
filtering already exists on `GET /api/appointments`; a real `next-available`
search and a real `getAppointmentSummary` aggregate already exist; real
rescheduling with history and race-condition (`SLOT_CONFLICT`) handling
already exists; a real doctor-specific cancel endpoint funneling through a
single `cancelAppointmentCore` already exists.

Three real, narrowly-scoped gaps were found during this audit and fixed
below. No feature was added "for visual complexity" — each maps to a
specific brief requirement (§9 Payment Connection, §10 Reschedule recovery,
§16 Cross-Role Consistency).

## Real bugs found & fixed

1. **Admin-cancelled appointments never notified the doctor** (brief §16
   Cross-Role Consistency). `cancelAppointmentCore`'s notification logic was
   an `if (cancelledBy !== "patient") { notify patient } else { notify
   doctor }` — a mutually-exclusive pair written for exactly two cases
   (patient cancels → notify doctor; doctor cancels → notify patient). Admin
   cancellation (`appointmentAdminController.js` passes `cancelledBy:
   "admin"`) fell into the `!== "patient"` branch and notified **only** the
   patient — the doctor was never told the clinic had cancelled their own
   appointment. Fixed by making both notifications independent (`notify
   patient unless they cancelled` / `notify doctor unless they cancelled`),
   so a third actor value can never again silently drop one side. Locked in
   with a new source-contract test (`appointmentCancellationCrossRoleNotification.test.mjs`).

2. **Reschedule dialog had no slot-conflict recovery** (brief §10: "If race
   condition occurs: show a real SLOT CONFLICT recovery state → refresh
   availability → choose another valid slot"). `BookAppointment.jsx` already
   implements this exact recovery pattern for booking (Phase DOC-07), but
   `RescheduleAppointmentDialog.jsx` — the one other place a slot pick can
   lose a race against the DB's unique index — just showed a dead-end toast
   on `SLOT_CONFLICT`, leaving the stale slot list and the now-conflicting
   selection on screen. Fixed by reusing the same pattern: on conflict,
   re-fetch real availability for the same date and clear the selection so
   the doctor can immediately pick a slot that's actually still open.

3. **Real payment/invoice data was fetched and silently dropped in the
   doctor's Appointment Detail workspace** (brief §6/§9: the detail
   workspace must answer "PAYMENT?", never invent it, never duplicate
   payment logic). `appointmentController.getAppointments` already populates
   `paymentId` (status/refundStatus/refundedAmount/amount) and `invoiceId`
   (invoiceNumber) on every doctor-facing appointment row — this is real
   data already on the wire, but `DoctorAppointmentDetailDrawer.jsx` never
   rendered it, so a doctor could see only the coarse `paymentStatus` badge
   and had no way to see refund state or the invoice number without leaving
   the drawer. `PatientAppointments.jsx` already surfaces the invoice number
   for patients — this was a one-sided (patient-only) connection, not a
   doctor-side one.

## Implemented (additive, reused existing data — no new backend logic)

- `DoctorAppointmentDetailDrawer.jsx`: new **Billing** tab, shown only when
  the appointment actually has a payment or invoice record (never fabricated
  for an appointment with neither). Shows payment status, amount, refund
  status/amount when present, and invoice number — all straight from fields
  the backend was already sending — plus a deep link to the existing
  `/doctor/earnings` page for full payment history (no duplicate payment UI
  built).

## Reused (confirmed real, left untouched)

- Booking engine, availability engine (`slotEngine.js`/`capacityAggregates.js`),
  DB-level unique-index double-booking protection, cancellation service,
  reschedule endpoint + history, `next-available` search, doctor appointment
  summary aggregate, real server-side search/pagination/filtering, the
  Doctor Appointments page's Today/Attention/Pending/Upcoming/Completed/
  Cancelled/All queue architecture, the P3 `?patientId=`/`?highlight=`
  deep-link consumer, the existing Cancel/Reschedule dialogs' UX shape.

## Backend

- `backend/services/appointmentCancellationService.js`: cancellation
  notification fix (see bug #1 above). No schema, endpoint, or route
  changes — the fix is entirely inside the existing shared service every
  cancel path (patient/doctor/admin) already funnels through.

## Frontend

- `src/components/shared/RescheduleAppointmentDialog.jsx`: slot-conflict
  recovery fix (see bug #2 above).
- `src/components/doctor/DoctorAppointmentDetailDrawer.jsx`: new Billing tab
  (see bug/gap #3 above).

## Security

- No new endpoints, no new authorization surface. The Billing tab renders
  only data the backend was already returning to an authenticated,
  ownership-checked doctor request (`buildRoleBasedFilter` already scopes
  `getAppointments` to `doctorId: doctor._id`) — no new IDOR surface
  introduced. No sensitive gateway payload is exposed; only the same
  aggregate fields (`status`, `refundStatus`, `refundedAmount`, `amount`,
  `invoiceNumber`) the controller's existing `.populate(...)` select list
  already restricts the query to.

## Cross-role connection

- Doctor cancels → patient notified (unchanged). Patient cancels → doctor
  notified (unchanged). **Admin cancels → both patient AND doctor now
  notified** (previously doctor was silently skipped) — this was the actual
  gap; realtime `appointment:updated`/`appointment:rescheduled` socket
  events were already correctly fanned out to all three rooms and required
  no change.

## UI/UX

- Billing tab follows the existing tab pattern (`Tabs` component, same
  `MetricCard` primitives used everywhere else in the drawer) — no new
  design system, no new component class introduced.

## Tests

- New: `backend/tests/appointmentCancellationCrossRoleNotification.test.mjs`
  (source-contract test locking in independent, non-`if`/`else` patient and
  doctor notification gating).
- Full suite: **61/61 passing** (60 pre-existing + 1 new).

## Lint / Build

- `npm run lint`: 0 errors, 0 warnings.
- `npm run build`: clean production build.
- Backend: `node --check` clean on every backend file; `server.js` boots to
  the expected `ECONNREFUSED` (no live MongoDB in this sandbox) — the same
  pattern every prior phase has verified against, not a new failure.

## Fresh-extract verification

Performed on the exact final zip: extracted into a clean directory,
reinstalled both `backend/` and root frontend dependencies from scratch,
re-ran the full backend test suite, lint, and production build — all clean.

## Known limitations / deferred

- **Live E2E** (real browser + live MongoDB double-booking race, real
  Razorpay refund flow, rendered-viewport responsive check) is **NOT
  LIVE VERIFIED** — this sandbox has no MongoDB instance or browser, exactly
  as every prior phase has disclosed. All three fixes above were verified
  via source-contract tests and the existing dependency-free backend test
  suite, not live requests.
- No new backend endpoint, model field, or migration was needed for any of
  the three fixes — all three gaps were connection/notification-logic gaps
  in code that already existed, not missing infrastructure.
- Did not build a week/month reschedule-conflict preview, AI conflict
  explanation, or any other feature not traceable to a real audit finding —
  per the brief's explicit instruction not to add features "for visual
  complexity."
