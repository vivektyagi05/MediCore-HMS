# Appointment Engine — Implementation Report

Baseline: 152/152 backend tests. Final: **158/158** backend tests, project lint clean, frontend production build succeeds.

## REUSED (not rebuilt)
Appointment model/state machine, slotEngine, capacityAggregates (extended additively), booking policy service (extended), cancellation core (hardened), history, unique slot index, bookingRequestId idempotency, HospitalSetting, CronRunLog/trackRun, notification + unique eventKey, appointment emitter, roomManager auth, payment/refund/payout architecture, existing reschedule/cancel dialogs and DoctorSchedule/PatientAppointments pages.

## FIXED (defects found in the existing code)
1. **Timezone**: IST slot digits were compared with UTC clock digits (past/“today” logic off by 5.5 h; "today" differed around midnight).
2. **Doctor could start a future consultation** and could PUT `payment_completed` to fabricate payment (status endpoint had no time/payment/actor guard).
3. **Read-then-`save()` races**: status update, reschedule, cancel, payment-window expiry.
4. **Payment-order creation** wrote `payment_pending` unconditionally (could resurrect a cancelled appointment) and without audit.
5. **Payment completion** could create a doctor payout even if its status flip lost the race.
6. **Expiry** measured from `updatedAt` and cancelled by stale in-memory object.
7. **Reminders**: date-only window, only `approved` (paid never reminded), one reminder per date, check-then-create race.
8. **Daily cap** was count-then-create (raceable).
9. **Patient could double-book** overlapping times with different doctors.
10. **Home visit** had no address field.
11. `getApiErrorMessage` would have appended machine metadata to messages.
12. Admin cancel had no state/time guard; follow-up scheduling lacked cap/overlap parity.

## ADDED
`utils/hospitalTime.js`; `constants/appointmentVisitState.js`; `utils/appointmentErrors.js`; `services/{appointmentActionPolicy,appointmentGuard,appointmentTransitionService,appointmentLifecycleService,appointmentImpactService,appointmentEmailService,emailOutboxService}.js`; `models/EmailDelivery.js`; `controllers/appointmentOperationsController.js`; crons `appointmentLifecycleSweep`, `processEmailOutbox`; Appointment fields `visit`, `resolution`, `cancellation`, `impact`, `visitAddress`, `paymentPendingAt`; HospitalSetting `appointmentRules`; frontend: API methods, error map, `useAppointmentSync`, `AppointmentOperationsPanel` (patient detail), `TodayClinicPanel` + `ResolveAppointmentDialog` (doctor Today tab), `AppointmentOperationsOverview` (admin).

## TESTED (new files)
`hospitalTime` (boundaries ±1 min, midnight, IST/UTC day boundary, DST, malformed), `appointmentActionPolicy` (scenarios 1–5 & 10, actors, windows, 1/2/3/>3 days), `appointmentReminder`, `appointmentImpact`, `appointmentTravelBuffer`, `appointmentConcurrencyContract`. Two existing contract tests were updated to assert the stronger atomic-write guarantee; one policy test was updated to the IST contract.

## VERIFIED (evidence in this environment)
Backend suite 158/158; `eslint .` clean; `vite build` succeeds; pure-logic behaviour of time resolver, action matrix, reminder selection, schedule-fit, travel buffer.

## NOT VERIFIED — and why
* **Concurrency against real MongoDB** — no mongod available (binary download blocked). `appointmentConcurrencyContract.test.mjs` is a **simulation** of single-document atomic `findOneAndUpdate`; it proves the services' logic (one winner, one history entry, cap never exceeded, stale expiry can't overwrite payment) *under that model*, not production behaviour. Real-DB race tests should be run before release.
* **Live Mongoose query behaviour** of new queries/indexes (`$in` with `null` for legacy docs, `$exists` filters, populate chains), and `runValidators` on `$push` into `statusHistory` — reasoned from Mongoose semantics, not executed.
* **Controllers/routes end-to-end** (HTTP → DB → socket → UI), socket reconnect behaviour in a browser, email delivery through Brevo, the cron scripts, any E2E journey. No frontend test suite exists.
* The full patient/doctor critical journeys were not run end-to-end.

## BLOCKED BY ENVIRONMENT
MongoDB binary; Brevo credentials; browser/E2E runtime.

## KNOWN LIMITATIONS
* `processEmailOutbox` and the sweep must be scheduled by the deployment; `processEmailOutbox` is not registered anywhere yet.
* Existing confirmation/receipt/refund emails are still fire-and-forget (not outbox). Emails for approved/payment/consultation-complete/earning/withdrawal events from the brief are **not** implemented.
* Patient/doctor **list** pages and i18n were not updated for the new state labels (detail page, Today's Clinic and admin overview were). New UI strings are English only.
* Online consultations: eligibility window only; no video, no "patient ready/doctor ready" states. Home visits: configurable buffer only, no routing.
* A started-but-never-completed consultation is flagged, never auto-closed (by design).
* Leave/schedule impact flags and notifies; there is no bulk "resolve all" tool. `appointmentAttention` still uses a coarse date-based 24 h heuristic. Emergency capacity and mode-specific schedule windows were not changed/added.
* Rolled-back over-cap bookings are deleted (never-paid, never-notified rows); under heavy contention several racers may all be rejected and must retry.
* Reminders cannot be enforced for legacy unparseable `timeSlot` values.
* Payment webhook replay semantics were not modified or re-verified.
