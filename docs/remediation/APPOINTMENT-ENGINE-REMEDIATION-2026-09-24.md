# APPOINTMENT ENGINE REMEDIATION — 2026-09-24

This is a focused continuation of the 2026-09-23 checkpoint, scoped to the
appointment engine correctness problem raised in this session's mission:
server-authoritative, real-world-correct appointment timing, availability,
conflict, state, and payment handling. It does not re-claim anything the
prior checkpoint already marked done, and does not re-open areas that were
audited here and found already solid.

**This document does not claim the appointment engine is now "complete."**
It documents exactly what was found, what was fixed, what was audited and
left untouched because it was already correct, and what remains open.

---

## 1. Existing appointment architecture (as found)

Traced end-to-end per Phase 1 before any change:

- **Patient booking**: `BookAppointment.jsx` → `appointmentApi.js` →
  `POST /api/appointments` → `appointmentRoutes.js` → `protect` middleware
  → `appointmentController.createAppointment` → `Appointment.create()` →
  `appointmentEmitter.created()` (Socket.IO) → UI refresh via query
  invalidation.
- **Doctor-initiated booking (follow-up)**: `DoctorPatientProfile`-adjacent
  UI → `doctorWorkflowApi.js` → `doctor/workflowController.
  scheduleFollowUpAppointment` — a second, independent entry point that
  intentionally reuses `ensureDoctorAvailable`/`findBlockedDate` from
  `appointmentController.js` (already a shared dependency before this
  session), but had its own independent past-date check.
- **Rescheduling**: `RescheduleAppointmentDialog.jsx` →
  `PATCH /api/appointments/:id/reschedule` →
  `appointmentController.rescheduleAppointment`.
- **Cancellation**: `CancelAppointmentDialog.jsx` /
  `AppointmentCancelDialog.jsx` → `PATCH /api/appointments/:id/cancel` →
  `appointmentController.cancelAppointment` →
  `services/appointmentCancellationService.cancelAppointmentCore` (shared
  by patient/doctor/admin — already the single source of truth before this
  session).
- **Status transitions / approval / consultation lifecycle**:
  `PATCH /api/appointments/:id/status` →
  `appointmentController.updateAppointmentStatus`, gated by
  `STATUS_TRANSITIONS` (constants/appointmentStatus.js).
- **Availability**: `Doctor.availability[]` (per-day structured or legacy
  slot lists) → `utils/slotEngine.generateDaySlots` → `utils/
  capacityAggregates.buildDayCapacity` → `GET /api/appointments/
  available-slots` (`appointmentController.getAvailableSlots`).
- **Payment/invoice**: `Appointment` carries no separate fee-snapshot field
  of its own; `paymentController.js`/`invoiceService.js`/`financeAggregates.
  js` were the subject of the **prior** checkpoint's tax-rate and
  `Payment.status==="paid"` fixes and were spot-checked again here (see
  Section 11) rather than re-audited from scratch.
- **Realtime**: `realtime/appointmentEmitter.js` emits
  `created`/`statusUpdated`/`rescheduled`/`slotUnavailable`/cancellation
  events through `socket/roomManager.js`, already scoped per-role (a
  patient's room, a doctor's room, admin's room) from prior phases.

## 2. Problems found

1. **CRITICAL — the exact bug the mission describes.**
   `createAppointment`, `rescheduleAppointment`
   (`controllers/appointmentController.js`) and
   `scheduleFollowUpAppointment` (`controllers/doctor/workflowController.
   js`) each rejected a booking using only:
   ```js
   const appointmentDate = normalizeDate(req.body.date); // UTC midnight
   const today = new Date(); today.setUTCHours(0,0,0,0);  // UTC midnight
   if (appointmentDate < today) throw new AppError("Past appointments are not allowed", 400);
   ```
   Both sides are normalized to UTC midnight, so for **today's date** this
   comparison is always `false` (equal, not less-than) regardless of the
   requested time-of-day. If the real server time is `2026-09-24 12:00`,
   a request for `2026-09-24 09:00` passed this check and was booked.
   `getAvailableSlots` (the read/display endpoint) already excluded
   already-passed times for today via `capacityAggregates.
   buildDayCapacity`'s `currentTimeMinutes` parameter — but that is a
   **frontend-facing display filter on a GET endpoint**, not enforcement
   on the three endpoints that actually write an appointment. A client
   that skipped the UI (a modified client, a stale cached slot list, or a
   direct API call) could still submit a past time and have it accepted.

2. **`HospitalSetting.appointmentLimits.bookingWindowDays` and
   `.dailyPerDoctor` were read only for public display**
   (`controllers/publicController.js`), never enforced anywhere. This was
   already flagged as found-but-not-fixed in the 2026-09-23 checkpoint
   (Section C, item 2) — confirmed again here by direct inspection, fixed
   in this pass.

3. **No canonical appointment-timing policy layer existed.** The
   past-date check above was hand-duplicated three times (once per write
   path) rather than living in one place — a violation of this mission's
   own Phase 2 instruction ("do NOT duplicate appointment rules across
   multiple controllers").

No other net-new appointment-engine defects were found. Sections 3–13
below record what was independently audited and found **already correct**
(not re-implemented), consistent with the 2026-09-23 checkpoint's own
explicit warning to treat the *original* mission prompt's generic problem
list with skepticism until independently re-verified against this specific
codebase.

## 3. Root causes fixed

- The single root cause behind Problem 1 is architectural: "is this
  appointment in the past" was defined as a **date** question everywhere
  it was checked, when it is actually an **instant** (date + time)
  question. Fixed by introducing one function,
  `assertAppointmentNotInPast`, that resolves the real instant from
  `date` + `timeSlot` and compares it against the real current time,
  falling back to the pre-existing date-only comparison only when the
  `timeSlot` string doesn't parse as a real clock time (protects legacy,
  non-`"HH:MM-HH:MM"` slot data from a new failure mode).
- Problem 2's root cause was simply that no code path ever read
  `appointmentLimits` outside of the public-display serializer. Fixed by
  adding `getAppointmentLimits()` to the existing canonical
  `hospitalSettingsService.js` (the same file the prior checkpoint
  established for `taxRate`/`refundsEnabled`) and calling it from the new
  policy layer.
- Problem 3 is fixed by the new policy layer itself.

## 4. Business rules now enforced (server-side, on every write path)

New file: `backend/services/appointmentBookingPolicyService.js`.

1. **Past-instant rejection** — a booking/reschedule is rejected if its
   resolved date+time instant is at or before the real current server
   time, not just if its calendar date is in the past.
   - `2026-09-24 12:00` server time, request `2026-09-24 09:00` → **reject**.
   - `2026-09-24 12:00` server time, request `2026-09-24 11:59` → **reject**.
   - `2026-09-24 12:00` server time, request `2026-09-24 12:30` → passes
     this check (subject to every other rule below).
2. **Booking window** — a booking/reschedule is rejected if its date is
   further out than `HospitalSetting.appointmentLimits.bookingWindowDays`
   (admin-editable, default 30) days from today.
3. **Per-doctor daily cap** — a booking/reschedule is rejected (409) if
   the doctor already has `HospitalSetting.appointmentLimits.
   dailyPerDoctor` (admin-editable, default 30) active appointments on
   that date. A reschedule excludes the appointment's own current slot
   from this count.
4. Every existing rule (doctor exists/approved/active, availability,
   blocked dates, approved leave, slot conflict, ownership, consent,
   consultation-mode contract, double-booking DB guarantee) is unchanged
   and still runs — see Section 6.

## 5. Security

- No new authorization surface was introduced; the three fixed write
  paths already had correct role/ownership checks (unchanged, verified
  during Phase 1 tracing, see Section 8).
- `Doctor daily cap`/`booking window` checks apply identically regardless
  of which of the three entry points (patient booking, doctor-initiated
  follow-up, reschedule) is used — no separate, weaker validation path.
- No client-supplied "current time" is trusted anywhere in the new code —
  `getServerNow()` is the single hook (`new Date()`), never taken from
  `req.body`.

## 6. Real-time

Not touched in this pass. Audited and confirmed already correct:
`appointmentEmitter.js` events are role-scoped (patient's own room,
doctor's own room, admin room) from prior phases; a rejected booking never
reaches `appointmentEmitter.created()` (the throw happens before it in all
three controllers), so no realtime event is ever emitted for a
booking that was actually rejected by the new policy checks.

## 7. Database / consistency

- **Double-booking / race protection (Phase 7)** — audited, already
  correct, not rebuilt: `Appointment` has a real unique partial index
  (`{doctorId, date, timeSlot}`, `partialFilterExpression: {status: {$in:
  ACTIVE_STATUSES}}`), and both `createAppointment` and
  `rescheduleAppointment` already translate the resulting MongoDB E11000
  error into a structured `409 SLOT_CONFLICT` response instead of a raw
  500. This is the actual concurrency guarantee; the `findOne` pre-checks
  in all three write paths are (and always were) best-effort UX, not the
  security boundary — confirmed correct, unchanged.
- **New daily-cap check is a soft limit, not a hard concurrency
  guarantee** — `assertDoctorDailyCapacityAvailable` does a
  `countDocuments` read with no equivalent atomic/unique-index guarantee
  (a per-day cap has no natural single-document uniqueness constraint to
  attach to, unlike a single slot). Under true concurrent load at the
  exact cap boundary, a doctor could in principle end up one appointment
  over their configured daily cap. This is disclosed explicitly, not
  silently accepted — see Section 12.

## 8. Authorization (audited, not touched)

Re-verified during Phase 1/15 tracing, found already correct, no changes
made:

- `createAppointment`: patient identity comes from `req.user._id`
  (authenticated session), never trusted from the body; family
  member/insurance/report ownership are all re-checked against
  `req.user._id` before use.
- `rescheduleAppointment`/`cancelAppointment`: doctor branch resolves the
  doctor's own profile via `ensureDoctorProfileForUser(req.user)` and
  compares against `appointment.doctorId`; patient branch compares
  `appointment.patientId` against `req.user._id`. Neither can act on
  another user's appointment (no IDOR).
- `getAppointmentById`/`getAppointments`: scoped through
  `buildRoleBasedFilter`, which restricts a patient to `patientId:
  req.user._id` and a doctor to their own `doctorId` — an admin-only
  endpoint cannot be reached by a patient/doctor role at the route layer
  (`ADMIN_ROLES`/`ROLES` gating in `appointmentRoutes.js`/
  `appointmentAdminRoutes.js`, unchanged).

## 9. State machine (audited, not touched)

`constants/appointmentStatus.js#STATUS_TRANSITIONS` is a real, complete
transition map (not a set of scattered if/else checks); `CANCELLABLE_
STATUSES` is derived FROM it (cannot drift independently, per a prior
phase's own fix). `updateAppointmentStatus` looks up `STATUS_TRANSITIONS
[appointment.status]` and rejects any status not in that list — a client
cannot force an illegal transition (e.g. `completed → confirmed`) by
sending an arbitrary body value. This area was found solid on inspection;
no changes were made to it in this pass.

## 10. Rescheduling (fixed to close the exact gap this mission asked about)

`rescheduleAppointment` already ran the new appointment through
`ensureDoctorAvailable` + leave check + conflict check (the same
functions booking uses) before this session — that part was already
correct. What it was missing was exactly the same past-instant/window/
daily-cap gap booking had; fixed identically, via the same
`enforceAppointmentBookingPolicy()` call, so rescheduling can never again
drift onto a weaker validation path than booking.

## 11. Payment consistency (spot-checked, not re-audited from scratch)

Not the focus of this pass (the mission's Phase 9 concern —
fee-snapshotting) was not touched; `Appointment` documents do not carry a
fee-snapshot field independent of `Payment`/`Invoice`, and that area was
already the subject of the prior checkpoint's `Payment.status==="paid"`
and tax-rate fixes. This pass adds no new payment logic and changes
nothing about how a payment amount is computed or stored. **Recommend
treating full fee-snapshot correctness as its own dedicated audit**, per
the prior checkpoint's own Section C item 3 recommendation, which this
pass does not supersede.

## 12. Tests added

New file: `backend/tests/appointmentBookingPolicy.test.mjs` — 7 assertions
groups, all pure-logic/stubbed-model style (no live DB — see Section 14):

1. `resolveSlotStartMinutes` parses structured `"HH:MM-HH:MM"` slots and
   safely returns `null` (never throws) for legacy/malformed input.
2. `resolveAppointmentInstant` resolves a real instant, or `null`.
3. `assertAppointmentNotInPast` reproduces the brief's exact Scenario A
   (`09:00` rejected when server time is `12:00` the same day), the
   `11:59`/`12:30` boundary cases named in the brief, confirms a past
   calendar date is still rejected outright (no regression), and confirms
   an unparseable legacy slot on today falls back to the pre-existing
   (safe) date-only behavior rather than throwing.
4. `assertWithinBookingWindow` enforces the configured window and
   confirms an out-of-schema-range stored value falls back to the real
   default rather than 0 or the raw bad value.
5. `getAppointmentLimits` fallback behavior (missing settings doc,
   out-of-range stored values for both fields).
6. `assertDoctorDailyCapacityAvailable` enforces the cap, scopes to
   `ACTIVE_STATUSES`, and correctly excludes the appointment's own current
   slot via `excludeAppointmentId` when rescheduling.
7. `enforceAppointmentBookingPolicy` composes all three checks with
   past-instant checked first (so a plainly-invalid request never reaches
   a DB-backed check).

**Exact command and result:**
```
$ node tests/run-all.mjs
145 passed, 0 failed (145 total)
```
(144 pre-existing + 1 new file; zero pre-existing tests were modified or
deleted.)

## 13. Lint / build

- `npx eslint .` (repo root) — **0 errors, 0 warnings**.
- `npm run build` (frontend) — **succeeds**. Output unchanged in size/shape
  from the prior checkpoint (`dist/assets/index-*.js`, ~706 kB / ~207 kB
  gzip, same Vite >500 kB chunk-size advisory as before — not an error,
  not touched by this pass since no frontend code changed).
- Backend boot check (`node server.js`, no live MongoDB in this sandbox) —
  clean, **ECONNREFUSED-only** (identical failure signature to every
  prior phase's boot check, confirming this pass introduced no new boot-
  time error).

## 14. NOT VERIFIED — ENVIRONMENT LIMITATION

Consistent with every phase before this one (see the 2026-09-23
checkpoint's Section B/F):

- **No live MongoDB** is reachable from this sandbox
  (`fastdl.mongodb.org`/`repo.mongodb.org` blocked, no local `mongod`).
  Every test above stubs the relevant Mongoose model methods directly.
  The new unique-partial-index reliance (Section 7) and the new
  `countDocuments` daily-cap query (Section 7) have **not** been run
  against a real MongoDB in this environment — their correctness is
  argued from the query/index shape and from stubbed-model tests, not
  from live execution.
- **No live browser/Socket.IO/frontend E2E** was performed (Phase 21's
  Scenarios A–J) — same sandbox constraint as every prior phase. The
  scenario-by-scenario mapping to what WAS verified:
  - Scenario A (book 09:00 when now=12:00 → block): **verified** by the
    new unit test reproducing this exact case against
    `assertAppointmentNotInPast`.
  - Scenario B (valid future booking → success if all rules pass):
    **verified** at the unit level (`enforceAppointmentBookingPolicy`
    test); not verified end-to-end against a live server/DB.
  - Scenario C (two users, same slot, only one succeeds): **not
    re-verified in this pass** — this is the pre-existing unique-index
    mechanism from Section 7, already covered by this codebase's own
    prior-phase tests (not duplicated here), not independently re-run
    against a live MongoDB in this pass either.
  - Scenarios D/E (leave/unavailable-hours blocking): **not changed,
    not re-verified** — pre-existing, unchanged logic, confirmed present
    on inspection only.
  - Scenario F (fee-snapshot unaffected by later fee change): **out of
    scope for this pass**, see Section 11.
  - Scenarios G/H (cross-patient/cross-doctor IDOR blocked): **audited on
    inspection** (Section 8), not re-proven with a live request.
  - Scenario I (stale booking-page slot rejected by backend): now
    **actually true** for the past-instant case specifically because of
    this pass's fix, verified at the unit level; not verified via a real
    stale browser tab against a live server.
  - Scenario J (invalid state transition blocked): **audited on
    inspection** (Section 9), pre-existing, unchanged, not re-proven live.

## 15. Remaining appointment-related issues (genuinely open)

1. **Daily-cap check is not atomic** (Section 7) — a soft limit, not a
   hard guarantee, under true concurrent load at the exact boundary.
   Closing this fully would need either a real MongoDB transaction (this
   environment has never had a reachable MongoDB to confirm transaction
   support against, consistent with every prior phase's finding of a
   standalone, non-replica-set `mongo:7` in `docker-compose.yml`) or a
   different data model (e.g. a running per-doctor-per-day counter
   document updated via `$inc` with a hard ceiling check) — judged out of
   proportion for this pass; flagged for a future concurrency-hardening
   pass if the daily cap becomes a hard business requirement rather than
   a soft one.
2. **`scheduleFollowUpAppointment`'s pre-existing claim-rollback gap**
   (found during this pass, not introduced by it): the atomic
   `Prescription.followUpScheduledAppointmentId` claim happens *before*
   `enforceAppointmentBookingPolicy`/`ensureDoctorAvailable`/leave/
   conflict checks, but only a failure of the subsequent
   `Appointment.create()` call rolls that claim back (see the `catch`
   block in `scheduleFollowUpAppointment`). If any of the checks between
   the claim and `Appointment.create()` throws, the claim is left
   dangling, which would incorrectly block that prescription's follow-up
   from ever being scheduled again with a `409 FOLLOWUP_ALREADY_SCHEDULED`
   for an appointment that was never actually created. This bug already
   existed for the pre-existing `ensureDoctorAvailable`/leave/conflict
   checks before this pass touched the file; this pass's own new check
   sits in the same gap and does not widen it, but does not close it
   either. **Not fixed in this pass** (out of the appointment-timing
   scope this pass was asked to close) — flagged for the next session.
3. **Timezone**: this codebase treats every appointment date/time value as
   literal UTC clock digits end-to-end (see the timezone-strategy comment
   at the top of `appointmentBookingPolicyService.js` for the full
   reasoning). `HospitalSetting.timezone` (`"Asia/Kolkata"`) remains
   display-only, unconnected to any date/time arithmetic anywhere in the
   codebase — this was true before this pass and remains true after it,
   documented here explicitly as a deliberate scope decision (see Section
   4 of the mission brief's own instruction to preserve an existing
   India-specific convention rather than introduce a second, disagreeing
   one) rather than a silently-accepted gap.
4. Every item still open in the 2026-09-23 checkpoint's own Section C
   that this pass did not touch (storage-abstraction remaining
   categories, CMS/analytics/exports truthfulness, database integrity
   audit, transactional consistency review, email/privacy lifecycle,
   dead-code sweep, final six deliverable documents, production-like
   E2E) remains exactly as open as that checkpoint described. This pass
   is scoped to the appointment engine only, per this mission's own
   "STRICT SCOPE CONTROL" instruction.

## 16. Timezone strategy (Phase 4 deliverable)

See the header comment of `backend/services/appointmentBookingPolicyService.
js` for the full reasoning. Summary: the codebase already has one
consistent (if implicit) convention — every appointment date/time is
stored and compared as literal UTC clock digits (`getDayOfWeek`/
`normalizeDate` are pinned to `timeZone: "UTC"`/`setUTCHours` in three
independent files: `appointmentController.js`, `doctor/
workflowController.js`, `ai/aiScheduler.js`). This pass's new policy
checks follow that exact same convention rather than introducing a second,
disagreeing one by projecting through `HospitalSetting.timezone`. A real
per-hospital-timezone-aware engine would require re-deriving slot
generation, capacity aggregation, reminders, and the AI scheduler from one
canonical instant-resolution function — a materially larger, cross-cutting
change explicitly out of proportion for an appointment-engine-timing pass
under this mission's own "do not casually refactor existing working
architecture" instruction.

## 17. Availability strategy (audited, unchanged)

`Doctor.availability[]` (per-day, structured-or-legacy) → `slotEngine.
generateDaySlots` → `capacityAggregates.buildDayCapacity` remains the
single source of truth for "what does this doctor's day actually look
like," reused unchanged by the Doctor Today view, next-available search,
and now (unchanged) by `ensureDoctorAvailable`. No changes were made to
slot generation or capacity computation in this pass.

## 18. Concurrency/double-booking strategy

See Section 7. Unchanged from the prior, already-correct implementation:
a real DB-level unique partial index is the actual guarantee; application-
level `findOne` checks remain best-effort UX only, and it was already
correctly documented as such in the pre-existing code comments before
this pass began.
