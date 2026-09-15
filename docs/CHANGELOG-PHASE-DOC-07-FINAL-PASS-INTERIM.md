# DOC-07 Final Pass — Follow-up Scheduling, Week/Month Views (Interim)

Status: PARTIAL. This is an honest interim deliverable, not the completed
"DOC-07 final pass" brief (Doctor Dashboard IA redesign per Part 4–6 of the
brief is not done — see "Not done" below). Do not treat this as DOC-08-ready.

## Audit performed first (no second engines introduced)
Read the existing slotEngine, capacityAggregates, appointment
create/reschedule/cancel controllers, LeaveRequest/blockedDates handling,
doctor availability config, Doctor Dashboard (839 lines), DoctorSchedule /
DoctorScheduleToday, and the doctor patient-relationship/clinical-profile
services before writing anything.

## Done

### Follow-up → Real Scheduling
- `POST /api/doctor/workflow/patients/:patientId/schedule-follow-up`
  (`scheduleFollowUpAppointment` in `workflowController.js`) creates a real
  `Appointment` document. It reuses the *exact* patient-booking availability
  engine — `ensureDoctorAvailable`, `findBlockedDate`, `getDayOfWeek` are now
  `export`ed from `appointmentController.js` and imported here rather than
  reimplemented — plus the same approved-leave check, same-slot conflict
  check (`ACTIVE_STATUSES`), and the same E11000 race-condition → structured
  409 `SLOT_CONFLICT` handling `createAppointment`/`rescheduleAppointment`
  already have.
- Guards: `ensureDoctorTreatedPatient` (doctor can only book a follow-up for
  a patient they've actually treated), past-date rejection, consultation
  mode validated against the doctor's offered modes.
- Fires the existing `appointmentEmitter.created` realtime + notification
  path — the patient is notified and sees the appointment; no second
  notification engine.
- Additive `Appointment.bookedBy` (`patient`/`doctor`/`admin`) and
  `Appointment.appointmentType` (`consultation`/`follow_up`) fields — every
  pre-existing document defaults to exactly what it already implicitly
  meant, no migration needed.
- Additive `Prescription.followUpScheduledAppointmentId`, set once a
  follow-up is actually scheduled. The Follow-up Queue
  (`commandCenterController.js`) and the single-patient Follow-up Status
  (`getPatientClinicalProfile`) both now exclude prescriptions with this
  field set, so neither can still show a follow-up as pending after it's
  been scheduled.
- Frontend: new reusable `ScheduleFollowUpDialog.jsx` — pulls real
  available slots from `GET /doctor/schedule/day` (same `buildDayCapacity`
  engine the Today view uses), lets the doctor pick a date/slot, and calls
  the new endpoint. Wired into both the Dashboard's Follow-up Queue (a
  "Schedule" button per item) and `DoctorPatientProfile.jsx`'s Follow-up
  Status card. No fake "success" toast — it either creates a real
  appointment or surfaces the real backend error (no availability / leave /
  blocked date / conflict).

### Week / Month views
- `GET /api/doctor/workflow/schedule/range?startDate=&endDate=` — runs the
  *same* `buildDayCapacity` function once per date in the range (2 bulk
  queries total for the whole range, not one query per day). Bounded to 31
  days (`MAX_RANGE_DAYS`) as a Large-Data-Protection guard; a full calendar
  month (≤31 days) fits exactly at the bound.
- Frontend: `DoctorScheduleWeek.jsx` (Monday-start week navigator — booked
  count, utilization bar, conflict indicator per day, busiest/lightest-day
  and week-conflict-count summary) and `DoctorScheduleMonth.jsx` (real
  calendar grid, leave/conflict badges per day, month-level summary). Both
  read only from `getScheduleRange` — no frontend-computed capacity math.
  Clicking a day in either view jumps the existing Today view to that exact
  date (`DoctorScheduleToday` now accepts an `initialDate` prop) instead of
  building a third day-view implementation.
- `DoctorSchedule.jsx` gained "Week" and "Month" tabs alongside the
  existing Today/Configure/Leave tabs.

### Verification (this pass)
- `node --check` on every modified backend file.
- New regression tests: `scheduleRangeBoundary.test.mjs` (pure boundary
  arithmetic — same-day, 7-day, 31-day-exact, 32-day-rejected) and
  `followUpSchedulingAndRangeContract.test.mjs` (source-contract test
  locking in that the new code calls the real shared helpers rather than
  reimplementing them, since a live-DB integration test isn't possible in
  this sandbox).
- Full backend suite: **60/60 passing** (58 pre-existing + 2 new).
- ESLint: **0 errors, 0 warnings** repo-wide.
- Production Vite build: clean.
- Server boot check: clean (ECONNREFUSED-only — no live MongoDB in
  sandbox, consistent with every prior phase).
- Route-duplication scan, fake-data scan, hardcoded-localhost scan, and a
  nested-interactive-element scan on every new/changed file: none found.
- Fresh-extract gate: dependencies reinstalled from scratch on a clean
  extraction of this exact deliverable zip, full suite/lint/build/boot
  re-run and passing (see below).

## Explicitly NOT done (do not mark these complete)
- **Doctor Dashboard IA redesign** (brief Part 4–6: Hero/Command-Center
  restructure, Capacity & Workload panel on the dashboard itself, Clinical
  Work Completion, reworked Attention Center visual hierarchy). The
  dashboard was only touched to wire in the real Follow-up scheduling
  action — it was not re-architected.
- Next-available consistency wiring across Patient Booking / Public
  Booking / Follow-up scheduling (brief Part 3D) — not verified this pass.
- Patient/public booking integration with the new range/week/month
  intelligence (brief Part 8) — not touched.
- Responsive-design pass (brief Part 9) — not manually verified against
  tablet/mobile breakpoints for the two new views.
- Live E2E (no MongoDB/browser in this sandbox — consistent with every
  prior phase).
