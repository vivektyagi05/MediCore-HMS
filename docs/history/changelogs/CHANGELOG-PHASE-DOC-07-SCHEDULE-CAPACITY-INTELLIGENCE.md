# PHASE DOC-07 — Schedule & Capacity Intelligence

## Audit summary

Before writing any code, the existing scheduling stack was read in full:
`backend/utils/slotEngine.js`, `Doctor.availability`/`blockedDates` schema,
`appointmentController.js` (available-slots, create, reschedule, cancel),
`appointmentCancellationService.js`, `LeaveRequest`, the Appointment unique
partial index (doctorId+date+timeSlot, active statuses only), realtime
`appointmentEmitter`, and the doctor-side `workflowController`/`ScheduleGrid`.

**Finding: nearly the entire scheduling engine was already REAL + CONNECTED.**
Slot generation, working-hours/breaks/duration config, server-side booking
validation, DB-level double-booking protection, rescheduling, cancellation,
realtime, and notifications all already existed as one real source of
truth. No parallel `scheduleEngineV2`/`slotEngineV2`/etc. was built — the
mission's Golden Rule (§3) explicitly forbids that, and none was needed.

The genuine gaps were: (1) a handful of real bugs where the AI/API layer had
silently drifted out of sync with the real booking rules, and (2) the
**Capacity Intelligence layer itself did not exist yet** — there was no
single place that turned "working hours + breaks + real appointments" into
"today's capacity, utilization, next free slot, and conflicts," which is
the actual product ask of this phase.

## Real bugs fixed

1. **Double-booking race conditions surfaced as raw 500s.** The
   findOne-based pre-check in `createAppointment`/`rescheduleAppointment` is
   only a best-effort check — the Appointment schema's unique partial index
   is the real guarantee, and it throws a MongoDB `E11000` error when two
   requests lose a race in the same instant. That error was never
   translated into anything the frontend could act on. Now both paths
   catch `error.code === 11000` and throw a structured 409 with
   `code: "SLOT_CONFLICT"` and a clear message. `errorMiddleware.js` also
   gained a generic E11000 → 409 fallback for any other unique-index race
   in the codebase that isn't already pre-translated.

2. **`workflowController.getSchedule` fetched every appointment a doctor
   has ever had, with no date bound and no pagination** — a real Large Data
   Protection violation (mission §33). Audited every frontend consumer
   (`DoctorSchedule.jsx`, `DoctorDashboard.jsx`) and confirmed neither reads
   `data.appointments` from this endpoint at all — it exists purely to
   configure the weekly template. Removed the unbounded query rather than
   just bounding it, since nothing consumed it. Day-specific appointment
   data is now served by the new `getScheduleDay`, which is always
   date-bounded to a single day.

3. **`aiScheduler.suggestSlots` never checked `doctor.blockedDates` or
   approved `LeaveRequest`s.** It could recommend a slot on a day the doctor
   explicitly blocked off or is on leave — the same "AI must not invent
   availability" failure this phase's mission (§13, §21) explicitly calls
   out. The real booking path already excludes both; the AI path had
   silently drifted out of sync with it. Fixed to reuse the same exclusion
   rules.

4. **Patient booking had no recovery path on a booking conflict.**
   `BookAppointment.jsx` previously just showed a toast on any error and
   left the patient stuck on the review step with stale slot data. Now a
   `SLOT_CONFLICT` response refetches real slots for that date and sends
   the patient back to the date/time step — matching mission §10's
   requirement ("reason, available alternatives, retry/recovery").

## New capability built: Capacity Intelligence

- **`backend/utils/capacityAggregates.js`** — new pure, dependency-free
  engine (`buildDayCapacity`). Reuses `slotEngine.generateDaySlots` (the
  existing single source of truth for slot generation) and adds exactly
  the layer DOC-07 needs on top: annotates every theoretical slot with
  what's really happening in it (booked/available/break/blocked/leave/past),
  a capacity summary (total/booked/available/completed/cancelled,
  utilization%), and real conflict detection — double-booked slots (legacy
  data or a pre-index race) and appointments that now fall outside
  currently-configured working hours (doctor edited hours after the
  appointment was booked). Never fabricates a number: utilization is `null`
  (not `0`) when there are no slots to divide by, and an unconfigured/
  blocked/leave day reports its real reason instead of a guessed capacity.
  9 dependency-free regression tests in
  `backend/tests/capacityAggregates.test.mjs`.

- **`GET /api/doctor/workflow/schedule/day?date=`** (new,
  `workflowController.getScheduleDay`) — real per-day capacity + timeline
  for the authenticated doctor, built from their own availability config,
  blocked dates, approved leave, and every real appointment on that exact
  date (all statuses, correctly labelled — not just active ones, so the
  Today view can show cancelled/completed history too).

- **`GET /api/appointments/next-available?doctorId=&fromDate=`** (new,
  `appointmentController.getNextAvailableSlot`) — a real, bounded (60-day
  max), single-request "next available slot" search. Fetches blocked dates,
  approved leave, and every active appointment across the whole search
  window up front, then walks forward in memory using the exact same
  `buildDayCapacity` engine the Doctor Today view uses — so "next
  available" can never disagree with what the doctor's own schedule shows
  for that day. Wired into `BookAppointment.jsx`'s "Find Next Available",
  replacing what was previously 14 sequential client-side
  `/available-slots` requests with one real backend call.

## Doctor Schedule UI rebuild

`DoctorSchedule.jsx` was a single flat config form with no live view of
today. Per mission §29/§48 ("must not look like the old schedule page"),
rebuilt into three tabs:

- **Today** (new, `DoctorScheduleToday.jsx`) — date navigator, capacity
  summary cards (total slots / booked / available / next free slot,
  reading directly from `GET /schedule/day`), a real conflict banner when
  `capacityAggregates` reports any, and an annotated timeline (each slot
  labelled with status + patient name where booked). A doctor can see
  today's whole picture without leaving this tab.
- **Configure** — the existing weekly `ScheduleGrid`, session templates,
  and blocked dates, unchanged (this was already real and didn't need
  rebuilding — reused, not duplicated).
- **Leave & Templates** — existing leave request form/history, unchanged.

No new Calendar/Modal/Table primitives were created — `Card`, `Button`,
`MetricCard`, `StatusBadge`, `ErrorState`, and `Loader` from the existing
design system were reused throughout.

## Verification

- `node --check` on every backend file: clean.
- Full backend suite: **58/58 passing** (57 pre-existing + 1 new file, 9
  new assertions).
- Server boot check: clean (`ECONNREFUSED`-only, no MongoDB in sandbox —
  consistent with every prior phase).
- `npx eslint .`: **0 errors** repo-wide.
- `npm run build`: clean production build.
- Manual structural scan of every new/changed JSX file for nested
  interactive elements (open/close tag counts balanced; no `<button>`
  nested inside another interactive element).
- Fresh-extract gate: full project re-zipped, extracted to a clean
  directory, dependencies reinstalled from scratch, full suite/lint/build
  re-run against that clean copy (see below).

## Explicitly deferred / not verified

- **Live browser + MongoDB E2E** — NOT VERIFIED. No browser or MongoDB
  runtime is available in this sandbox, consistent with every prior phase.
- **Admin/public-booking connection to the new capacity engine** — the
  admin appointment views and public discovery booking already share the
  same `getAvailableSlots`/booking engine (verified during audit), but
  were not additionally wired to the new `getScheduleDay`/capacity
  summary views — that was scoped as a doctor-facing capability this
  phase, and admin already has its own operations views from earlier
  phases.
- **Follow-up scheduling connection** (mission §14) — DOC-01/DOC-02
  already built a real follow-up queue against `Prescription.followUpDate`;
  this phase did not add a dedicated "schedule this follow-up" action
  button wired to the new capacity view. Real gap, not built this pass.
- **Week/Month views on the Today tab** — only a single-day view was
  built. A week view would reuse the same `getScheduleDay` per-day but
  wasn't built out this phase.
