# Appointment Business Logic Specification

Describes only behaviour that exists in code. Source of truth: **MongoDB + backend rules**. Socket.IO, notifications and the UI never create truth.

## 1. Request contract
`request → auth → role → ownership/relationship → status → time window → visit state → payment → business policy → atomic DB transition (+ audit in the same write) → realtime → notification → email outbox`.
Every mutation that can race (doctor, scheduler, patient, payment) uses `services/appointmentTransitionService.atomicTransition`: one conditional `findOneAndUpdate` (status + visit-state + extra preconditions) with the history entry `$push`ed in the same update. If the precondition no longer holds → `APPOINTMENT_STATE_CHANGED` (409); jobs get `null` and skip. No stale `.save()` of appointment state remains except the post-create history write on a not-yet-visible new document.

## 2. Time (`backend/utils/hospitalTime.js` — the only resolver)
* `Appointment.date` = hospital-local **calendar-day key** (UTC-midnight Date whose Y-M-D is the local day). `timeSlot` = hospital **wall-clock** `HH:MM-HH:MM`.
* Instant = day key + slot start in `HospitalSetting.timezone` (default `Asia/Kolkata`), DST-safe via `Intl`.
* `classifyAppointmentTime` → `UPCOMING | CURRENT | RECENTLY_MISSED | EXPIRED | UNKNOWN` (start inclusive; end inclusive CURRENT; resolution deadline inclusive RECENTLY_MISSED).
* Migrated: slot availability, past check, booking window, next-available, quick-date filters, doctor day/range views, public availability horizon, reminders, expiry, lifecycle sweep, action policy.
* **Contract change:** the previous convention compared IST slot digits to UTC clock digits (5.5 h off). No data migration needed (storage format unchanged); `appointmentBookingPolicy.test.mjs` was updated to the IST contract.
* Legacy free-typed slots (unparseable) → `UNKNOWN`: date-level checks only; time-window guards cannot be enforced for them.

## 3. Configuration (`HospitalSetting.appointmentRules`, read via `getAppointmentRules()`; invalid values fall back to defaults)
`resolutionWindowDays=3`, `checkInEarlyWindowMinutes=30`, `noShowGraceMinutes=15`, `reminderIntervalsMinutes=[1440,120,30]`, `delayNotifyThresholdMinutes=15`, `defaultSlotMinutes=30`, `earlyStartWindowMinutes=15`, `travelBufferMinutes=45`; plus existing `appointmentLimits.{dailyPerDoctor,bookingWindowDays}`. No env vars for business rules.

## 4. Lifecycle vs operational state
* **Business lifecycle** `Appointment.status` (unchanged state machine, `STATUS_TRANSITIONS`).
* **Visit state** `Appointment.visit.state`: `not_arrived → checked_in → called → in_consultation → completed`; terminal/side: `no_show_patient`, `no_show_doctor`, `missed`, `expired`. "Waiting" = `checked_in` (queue order: called first, then `visit.checkedInAt`, slot, `_id`). Persisted timestamps: `checkedInAt, calledAt, consultationStartedAt, consultationEndedAt, noShowAt`.
* Payment states (`payment_pending`, `payment_completed`) can **only** be set by the payment flow; `PUT /:id/status` rejects them (previously a doctor could fabricate "paid").

## 5. Action matrix (`services/appointmentActionPolicy.js`, enforced server-side; `GET /:id/actions` returns the verdicts the UI renders)
| Action | Actor | Allowed when |
|---|---|---|
| approve | doctor/admin | status `pending`, slot not yet over |
| cancel / reject | patient (cancel), doctor, admin | cancellable status, consultation not started; **patient only strictly before slot start** |
| reschedule | patient/doctor/admin | cancellable status, visit `not_arrived` (doctor/admin may also move `missed`); patient only before start |
| pay | patient | `approved`/`payment_pending`, unpaid, slot not over |
| check-in | patient | `payment_completed`, `not_arrived`, now ∈ [start − checkInEarly, end] |
| call | doctor | `payment_completed`, visit `checked_in` |
| start consultation | doctor/admin | `payment_completed` **and paid**; now ≥ start − earlyStart; after slot end only if patient checked in and same hospital day; else `APPOINTMENT_RESOLUTION_REQUIRED` / `…WINDOW_EXPIRED` |
| complete consultation | doctor/admin | status `consultation_started`, not future |
| finalize | doctor/admin | `consultation_completed` (+ existing documentation rule) |
| mark patient no-show | doctor/admin | paid, not checked in, now ≥ start + grace, within window |
| report doctor no-show | patient | **checked in**, doctor never started, now ≥ start + grace |
| resolve missed | doctor/admin | past slot end, unresolved; window-limited except started consultations |
| join online | patient/doctor | mode `online`, paid, window only (**no video system exists**) |
Future appointments can never be started, completed, marked no-show or resolved.

## 6. Missed / no-show / cancelled / expired (distinct)
* **Missed**: past slot end, unresolved → sweep sets `visit.state=missed`, `resolution.flaggedAt`, notifies both (once).
* **Resolve** (`POST /:id/resolve`, note required): `attended` (→ `consultation_completed`, no fabricated start time; paid only) | `patient_no_show` (closed, **no penalty, no auto-refund**) | `doctor_no_show` (refund request) | `cancelled` (refund request if paid). A started consultation can only be resolved as `attended`.
* **Expired**: after `end + resolutionWindowDays`, the sweep atomically cancels with `cancellation.source=system`, `reasonCode=MISSED_UNRESOLVED`, actor `system` (never a person), stores previous status/visit state, scheduled instant, job ref; notifies both + email; paid → refund request. A `consultation_started` appointment is never auto-cancelled (patient was seen): it is flagged and surfaced.
* Doctor earning: payouts are created at payment capture only when the atomic flip really won; refund flow (unchanged) governs adjustments. Cancelled/expired appointments never reach completion, so no completion-based earning/review eligibility arises.

## 7. Booking, capacity, conflicts
Unchanged: slotEngine, capacityAggregates, unique partial index `(doctorId,date,timeSlot)` on active statuses (final double-booking guard), idempotency, booking window, leave/blocked dates, offered modes. Added: **post-write daily-cap verification** (`verifyDailyCapacityAfterWrite`, used by booking, reschedule and follow-up: overshooting writers undo themselves → `DAILY_CAPACITY_REACHED`; safety over liveness); **patient overlap** across doctors for the same person (`PATIENT_SLOT_CONFLICT`); **clinical-minutes capacity** (`workMinutes/bookedMinutes/availableMinutes/utilizationMinutesPercent`); follow-ups use the same engine.
Reschedule is an atomic conditional update (status, slot, visit-state preconditions) with rollback if the target day exceeds the cap.

## 8. Modes
Offered-mode check unchanged. **Home visit** requires `visitAddress.{line1,city}` (stored only for home visits). `travelBufferMinutes` blocks a home visit adjacent to an appointment at another place/address (`TRAVEL_BUFFER_CONFLICT`). No map/ETA is claimed. **Online**: only an eligibility window exists; no video infrastructure.

## 9. Payment ↔ appointment
Payment completion and `payment_pending` entry are conditional + audited; payout creation gated on the winning flip; `paymentPendingAt` (business timestamp) drives expiry instead of `updatedAt`. Expiry cancel precondition: `status=payment_pending AND paymentStatus≠paid` at write time.

## 10. Leave / schedule impact
Leave approval and any availability edit (doctor or admin) flag affected future appointments (`Appointment.impact`), notify patients (deterministic keys) and the doctor, and return the impact list. Nothing is cancelled or moved automatically; resolution uses the normal reschedule/cancel flows (reschedule clears the flag). Restoring the schedule clears stale schedule flags.

## 11. Reminders
`automation/appointmentReminder.js`: canonical instant; intervals from settings; only the smallest due interval is sent; statuses `approved|payment_pending|payment_completed`; event key embeds the instant ⇒ idempotent, and a reschedule yields fresh keys while old-time reminders can never refire. Patient only (doctor reminders would be spam).

## 12. Delay
`delay = consultationStartedAt − scheduled start` (persisted timestamps only; none ⇒ no delay). After a late start ≥ threshold, later same-day patients get a factual "running about N minutes behind" notice, deduped by threshold bucket (conditional update + eventKey). No ETA is invented.

## 13. Notifications / email
In-app: unique `(eventKey, recipient)` ⇒ idempotent. Email: durable `EmailDelivery` outbox (`queued→sending→sent|retrying|failed`, atomic claim, backoff, ≤5 attempts, provider errors stored as category only), unique per `(eventKey, address)`. Templates (cancelled, automatically cancelled, missed, patient/doctor no-show, rescheduled) carry reference/names/date/time/mode/status/next step — no clinical data. Existing confirmation/receipt/refund emails keep their current fire-and-forget path.

## 14. Realtime
Events: `appointment:{checked_in,called,delay,missed,expired,resolution_required,queue_updated}` (no-shows and system cancellations also go out via the existing cancellation status event) (+ existing created/updated/rescheduled), emitted **after** the DB write; failures never roll back. Payloads: ids/status/visitState/date/slot/server time, no PHI. Clients treat events as hints: `useAppointmentSync` refetches REST on any event and on every reconnect. Room authorization (existing `roomManager`) unchanged.

## 15. Error codes (`details.code`)
`APPOINTMENT_NOT_FOUND, APPOINTMENT_NOT_OWNED, UNAUTHORIZED_APPOINTMENT_ACTION, APPOINTMENT_NOT_ACTIVE, APPOINTMENT_ALREADY_{CANCELLED,COMPLETED,STARTED,EXPIRED}, APPOINTMENT_NOT_FUTURE, APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW, APPOINTMENT_RESOLUTION_{REQUIRED,WINDOW_EXPIRED,NOT_REQUIRED}, APPOINTMENT_STATE_CHANGED, INVALID_APPOINTMENT_TRANSITION, CHECKIN_NOT_OPEN, CHECKIN_ALREADY_COMPLETED, PATIENT_NOT_CHECKED_IN, CONSULTATION_NOT_STARTED, PAYMENT_REQUIRED, PAYMENT_WINDOW_EXPIRED, REFUND_NOT_ELIGIBLE, REASON_REQUIRED, INVALID_APPOINTMENT_MODE, ACTION_NOT_ALLOWED, SLOT_CONFLICT, PATIENT_SLOT_CONFLICT, DAILY_CAPACITY_REACHED, TRAVEL_BUFFER_CONFLICT`. Frontend maps them in `src/utils/appointmentErrors.js`; `getApiErrorMessage` no longer concatenates machine metadata.

## 16. API additions
`GET /appointments/:id/actions`, `POST /:id/check-in`, `/:id/call`, `/:id/no-show`, `/:id/report-doctor-no-show`, `/:id/resolve`, `GET /appointments/doctor/today-clinic`, `GET /appointments/admin/operations` (SUPER_ADMIN). Roles remain PATIENT / DOCTOR / SUPER_ADMIN only.

## 17. Indexes added
`(status,date)`, `(doctorId,date,visit.state)`, `(status,updatedAt)` on Appointment; `EmailDelivery (eventKey,to)` unique + `(status,nextAttemptAt)`. Existing unique slot index preserved.

## 18. Scheduling jobs (must be scheduled in the deployment)
`appointmentLifecycleSweep` (registered in `automation/cronJobs.js`; standalone `cron/appointmentLifecycleSweep.js`), `expirePaymentWindows` (existing), `cron/processEmailOutbox.js` (**new, not yet registered in any deploy scheduler**). Sweep is bounded (`limit 200`, indexed), idempotent, and uses `CronRunLog` single-run locking via `trackRun`.
