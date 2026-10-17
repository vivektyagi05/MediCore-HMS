# Phase P10 — Follow-up / Continuity

## 1. Real-world problem

After a consultation, "follow-up recommended" is not enough. The specific
failure this phase targets, confirmed by audit rather than assumed: a doctor
recommends a follow-up, turns it into a real scheduled appointment — and
then that appointment gets cancelled. Nothing in the system put the
recommendation back in front of the doctor. It didn't get relabeled as
"cancelled, needs attention" — it simply disappeared, because every
follow-up surface in the app (Dashboard queue, Patient Relationship Center,
attention items) explicitly *excludes* any prescription that already has a
scheduled-appointment link, regardless of whether that linked appointment is
still alive. That's the continuity loop breaking silently, exactly as
described in the phase brief.

## 2. Existing system audit

Traced the full existing implementation before writing anything:

- **Source of truth**: `Prescription.followUpDate` +
  `Prescription.followUpScheduledAppointmentId` + `Appointment`
  (`appointmentType: "follow_up"`, `bookedBy: "doctor"`) — already the
  correct domain model from Phase DOC-07's final pass. No new model
  introduced; every fix in this phase is additive to this existing shape.
- **Derivation**: `resolveFollowUpState()` (doctorPatientRelationshipService.js)
  computes overdue/due_today/upcoming buckets, but **only** for prescriptions
  where `followUpScheduledAppointmentId` is NOT set — every one of its five
  call sites pre-filters scheduled prescriptions out before calling it. This
  is correct by design (it answers "what's not yet scheduled"), but it means
  nothing else in the codebase tracked what happens *after* scheduling.
- **Scheduling**: `scheduleFollowUpAppointment` (workflowController.js)
  reuses the exact patient-booking availability engine
  (`ensureDoctorAvailable`/`findBlockedDate`, the same E11000 race
  protection) — no second scheduling engine, confirmed by source audit.
- **Cancellation**: `cancelAppointmentCore` (appointmentCancellationService.js)
  is the single funnel every cancellation path (patient/doctor/admin)
  already goes through — but had zero knowledge of the
  `Prescription.followUpScheduledAppointmentId` relationship.
- **Dashboard queue / Patient Profile**: both directly query
  `followUpScheduledAppointmentId: { $exists: false }` — a scheduled
  follow-up is excluded outright, not shown in a "Scheduled" state.
- **Notifications**: `appointmentEmitter.created()` notifies the doctor and
  admins unconditionally, but never the patient — correct for a
  patient-initiated booking (they already know), silently wrong for a
  doctor-initiated one (`scheduleFollowUpAppointment` reuses this exact
  function). The `ScheduleFollowUpDialog.jsx` UI copy literally says "the
  patient will be notified immediately," which was not true.
- **Doctor/patient appointment surfaces**: `Appointment.appointmentType`
  ("follow_up") is a real, already-persisted field that was never rendered
  anywhere in the UI — doctor and patient alike had no way to tell a
  follow-up visit apart from a fresh consultation at a glance.
- **Duplicate prevention**: only enforced by the frontend hiding the
  "Schedule" button once a link exists — `scheduleFollowUpAppointment` had
  no server-side check against scheduling a second active follow-up for the
  same recommendation.

## 3. Competitor/product-gap note

Not independently researched with external sources this phase (no evidence
gathered to responsibly make a competitor claim); the differentiation
described in the brief — Clinical Workspace + Patient Relationship Center +
Schedule + Notifications + Timeline + AI becoming one continuity loop — is
exactly what this phase's fixes connect, using only MediCore's own existing
architecture.

## 4. Source-of-truth map

```
FOLLOW-UP RECOMMENDATION      Prescription.followUpDate / diagnosis
        ↓
NOT YET SCHEDULED              resolveFollowUpState() → overdue/due_today/upcoming
        ↓ (doctor schedules via ScheduleFollowUpDialog)
SCHEDULED                      Prescription.followUpScheduledAppointmentId → Appointment
        ↓                      [NEW] resolveScheduledFollowUps() → "scheduled"
APPOINTMENT STATUS             Appointment.status (approved/.../completed/cancelled)
        ↓
  ├─ COMPLETED/REVIEW_ELIGIBLE → [NEW] bucket "completed" (loop closed)
  └─ CANCELLED                 → [FIX] cancelAppointmentCore clears the link,
                                       sets Prescription.followUpCancelledAt,
                                       prescription re-enters overdue/upcoming
                                       derivation automatically
        ↓
PATIENT NOTIFICATION           [FIX] appointmentEmitter.created() now notifies
                                     the patient for doctor-initiated bookings
        ↓
DOCTOR VISIBILITY              Dashboard Follow-up Queue / Patient Profile /
                                Open Clinical Actions — all now show every
                                bucket, not just the three "not yet scheduled" ones
        ↓
CONTINUITY HISTORY             Patient Health Timeline / Clinical Timeline —
                                follow-up appointments now labeled as such
```

## 5. Genuine gaps found (classified)

| # | Gap | Class |
|---|-----|-------|
| 1 | Cancelling a follow-up appointment leaves the Prescription link dangling — recommendation vanishes | E (incorrect/misleading) |
| 2 | No "Scheduled" or "Recently Completed" bucket anywhere — loop invisible mid-flight | B (real but incomplete) |
| 3 | No server-side duplicate-active-follow-up prevention | B |
| 4 | Patient never notified when doctor books a follow-up on their behalf | E |
| 5 | No UI anywhere shows `appointmentType` ("Follow-up Visit") to doctor or patient | D (frontend disconnected from real field) |
| 6 | Continuity Timeline (patient + doctor) doesn't distinguish follow-up appointments/recommendations from ordinary ones | D |

Nothing classified A (real+correct+connected) needed rebuilding — the
domain model, scheduling engine, and notification infrastructure were all
already correct; every fix here is either closing a real state-tracking gap
or connecting an already-real field to a UI that never read it.

## 6. Root causes

- Gap 1: `cancelAppointmentCore` was written before `appointmentType`/
  `bookedBy`/follow-up linkage existed (Phase DOC-04) and was never revisited
  when DOC-07's final pass introduced the follow-up-scheduling relationship.
- Gap 2: every follow-up query was written from the "what still needs
  scheduling" angle only, because that was P10's predecessor phase's whole
  scope; nothing else needed the scheduled/completed states until now.
- Gap 3: the same predecessor phase in Follow-up → Real Scheduling shipped
  with a working frontend guard and, since it was the only way to reach the
  endpoint at the time, never got a backend-side check added.
- Gap 4: `appointmentEmitter.created()` was designed and tested against the
  patient-booking flow only, before `scheduleFollowUpAppointment` (a later
  phase) started reusing it for a fundamentally different actor.
- Gaps 5–6: `Appointment.appointmentType` was added purely as backend
  bookkeeping (Phase DOC-07 final pass) with an explicit note that it exists
  "wherever that distinction is useful" — no phase before this one actually
  needed it in a UI.

## 7. Implemented

### Backend

- **`backend/models/Prescription.js`** — additive `followUpCancelledAt: Date`
  field. Records the real fact that a scheduled follow-up's appointment was
  cancelled; `undefined` on every pre-existing document.
- **`backend/services/appointmentCancellationService.js`** (`cancelAppointmentCore`)
  — when the cancelled appointment has `appointmentType === "follow_up"`,
  clears `Prescription.followUpScheduledAppointmentId` and sets
  `followUpCancelledAt` on the linked prescription (best-effort, logged on
  failure, never blocks the cancellation itself). Patient- and
  doctor-facing cancellation notifications now use follow-up-specific
  wording ("Your doctor will need to reschedule your follow-up" /
  "The original follow-up recommendation is back in your Follow-up Queue")
  instead of the generic appointment-cancelled copy.
- **`backend/services/doctorPatientRelationshipService.js`** — new pure,
  DB-free `resolveScheduledFollowUps(pairs, now)` classifying
  prescription+appointment pairs into `scheduled` / `completed` /
  `cancelled_needs_action` (the last one a defensive-only path for data
  written before this phase's cancellation fix). `computeDoctorPatientAttentionItems`
  and `buildOpenClinicalActions` both gained an **optional**
  `scheduledFollowUps` parameter (default omitted, fully backward
  compatible with every pre-P10 call site) that surfaces a cancelled
  follow-up as the highest-priority item/action, and a scheduled one as a
  visible (non-actionable) entry.
- **`backend/controllers/doctor/commandCenterController.js`** — new bounded
  query (`Prescription.find({ followUpScheduledAppointmentId: { $exists: true } }).limit(100)`,
  populated with its linked appointment) merged into the same
  `followUpsDue` array via `resolveScheduledFollowUps`, adding `scheduled`
  and `completed` (bounded to a 14-day trailing window, matching the
  existing 14-day forward window's scale) buckets alongside the pre-existing
  overdue/due_today/upcoming three.
- **`backend/controllers/doctor/workflowController.js`**
  (`getPatientClinicalProfile`) — computes the same `scheduledFollowUps`
  from the `appointments` array already fetched for that patient (zero new
  query), exposes it in the response, and threads it into both
  `computeDoctorPatientAttentionItems` and `buildOpenClinicalActions`.
  Clinical timeline's `appointment` entries now carry `appointmentType` so
  the frontend can label follow-ups distinctly.
  (`scheduleFollowUpAppointment`) — real backend duplicate-prevention: if
  the prescription already links to an appointment that isn't cancelled,
  returns `409 FOLLOWUP_ALREADY_SCHEDULED` instead of silently allowing a
  second one. Successfully (re)scheduling clears any prior
  `followUpCancelledAt` flag.
- **`backend/realtime/appointmentEmitter.js`** (`created`) — additive
  branch: when `appointment.bookedBy !== "patient"`, notifies the patient
  with follow-up-aware wording. A patient's own booking (`bookedBy`
  defaults to `"patient"`) is completely unaffected.
- **`backend/controllers/patient/patientWorkflowController.js`**
  (`buildPatientTimelineData`) — appointment timeline entries now read
  "Follow-up appointment with Dr. X" instead of the generic "Appointment
  with Dr. X" when `appointmentType === "follow_up"`; prescription entries
  now show the recommended follow-up date inline when one exists. Both are
  real, already-fetched fields — no new query.

### Frontend

- **`src/components/doctor/dashboard/DoctorHomeWidgets.jsx`**
  (`FollowUpQueue`) — rebuilt to render all six buckets (Cancelled — Needs
  Action / Overdue / Due Today / Upcoming / Scheduled / Recently Completed),
  with "Open Appointment" replacing "Schedule" for the two states that
  already have a real appointment to open.
- **`src/pages/dashboard/DoctorDashboard.jsx`** — wired `onOpenAppointment`
  to the existing `?patientId=&highlight=` deep-link convention (Phase P3);
  surfaces `cancelled_needs_action` items in the Attention Center with the
  same urgency as overdue ones; overdue count now includes cancelled-needing-
  action items.
- **`src/pages/doctor/DoctorPatientProfile.jsx`** (Follow-up Status card) —
  now distinguishes four real states: cancelled-needs-rescheduling,
  actively scheduled (with an "Open Appointment" action, not "Schedule"),
  overdue/due/upcoming (existing), and none. Reuses `scheduledFollowUps`
  from the same API response — no new request.
- **`src/pages/doctor/DoctorClinicalWorkspace.jsx`** — `handleAttentionAction`
  gained an optional `appointmentId` argument so an "appointments" action
  deep-links straight to the relevant appointment via the existing
  `?highlight=` convention instead of the general list.
- **`src/components/clinical/OpenClinicalActions.jsx`** — added a
  `SCHEDULED` status-pill tone.
- **`src/components/clinical/ClinicalTimeline.jsx`** — appointment entries
  now read "Follow-up appointment · <status>" when applicable.
- **Follow-up Visit badges** added to `src/pages/patient/PatientAppointments.jsx`,
  `src/pages/doctor/DoctorAppointments.jsx`, and
  `src/components/doctor/DoctorAppointmentDetailDrawer.jsx` — all reading
  the already-real `appointment.appointmentType` field, closing "doctor/
  patient cannot tell why this appointment exists" (brief §9/§15).

## 8. Business rules preserved

- No second scheduling/notification/timeline engine introduced anywhere —
  every fix reuses the exact existing engine (`ensureDoctorAvailable`,
  `appointmentEmitter`, `buildPatientTimelineData`, `resolveFollowUpState`).
- Reschedule was already correct and untouched: `rescheduleAppointment`
  updates the same `Appointment._id` in place with `rescheduleHistory`, so
  `Prescription.followUpScheduledAppointmentId` never needed to change for
  a reschedule — only cancellation breaks the link, which is now handled.
- Cancellation/refund/notification/automation-trigger rules inside
  `cancelAppointmentCore` are otherwise completely unchanged; the follow-up
  unlink is a new, independent step that runs unconditionally for a
  follow-up cancellation (verified to execute before the payment/refund
  branch, not nested inside it) and never affects a non-follow-up
  cancellation at all.

## 9. Cross-role flow

Doctor Clinical Workspace (Open Clinical Actions) ↔ Doctor Dashboard
(Follow-up Queue) ↔ Doctor Patient Profile (Follow-up Status) ↔ Doctor
Appointments (Follow-up badge, `?highlight=` deep link) ↔ Patient
Appointments (Follow-up Visit badge) ↔ Patient Health Timeline (labeled
follow-up entries) ↔ Notifications (patient now notified on doctor-booked
follow-ups; cancellation messaging is continuity-aware) — all read the same
`Prescription.followUpScheduledAppointmentId` → `Appointment` relationship
and the same `resolveScheduledFollowUps` classification, so no two surfaces
can disagree about whether a given follow-up is scheduled, completed, or
needs rescheduling.

## 10. Security

- `scheduleFollowUpAppointment`'s new duplicate check re-scopes the
  prescription lookup by `{ _id: prescriptionId, doctorId: doctor._id,
  patientId }` — the same ownership guard the existing linking `updateOne`
  already used, so the duplicate-check itself cannot be used to probe
  another doctor's or another patient's prescriptions.
- No new endpoint was added; every change is inside existing,
  already-authorized controllers (doctor-role-gated
  `scheduleFollowUpAppointment`/`getPatientClinicalProfile`, ownership-scoped
  `getAppointments`/`buildPatientTimelineData`).
- The new `Prescription.followUpCancelledAt` field carries no PII beyond
  what the prescription document already exposes to its existing,
  already-authorized readers.

## 11. Performance / scale

- The new dashboard query is bounded (`.limit(100)`) and scoped per-doctor;
  its result set can only ever contain prescriptions that doctor personally
  scheduled a follow-up for — not "every appointment/prescription ever,"
  the shape of unbounded growth this codebase's other scale fixes
  addressed. Documented explicitly rather than left implicit.
- `getPatientClinicalProfile`'s new classification adds **zero** additional
  queries — it reuses the `appointments` array already fetched for the
  same patient/doctor pair.
- The "Recently Completed" bucket is bounded to a 14-day trailing window,
  matching the existing 14-day forward window's scale (not "forever").

## 12. AI

No AI changes this phase. `generativeAssistant.js`'s existing
`resolveFollowUpState`/`computeDoctorPatientAttentionItems` usage (patient
clinical brief) is untouched — it doesn't pass `scheduledFollowUps`, which
is safe because that parameter is optional and purely additive; a future
pass could extend the AI brief to mention scheduled/cancelled follow-ups
using the same real data, but that wasn't part of the audited gap set for
this phase.

## 13. Files changed

- `backend/models/Prescription.js`
- `backend/services/appointmentCancellationService.js`
- `backend/services/doctorPatientRelationshipService.js`
- `backend/controllers/doctor/commandCenterController.js`
- `backend/controllers/doctor/workflowController.js`
- `backend/realtime/appointmentEmitter.js`
- `backend/controllers/patient/patientWorkflowController.js`
- `backend/tests/followUpContinuity.test.mjs` (new)
- `backend/tests/followUpCancellationContinuity.test.mjs` (new)
- `backend/tests/followUpSchedulingConcurrency.test.mjs` (new)
- `backend/tests/followUpContinuityInvariants.test.mjs` (new)
- `src/components/doctor/dashboard/DoctorHomeWidgets.jsx`
- `src/pages/dashboard/DoctorDashboard.jsx`
- `src/pages/doctor/DoctorPatientProfile.jsx`
- `src/pages/doctor/DoctorClinicalWorkspace.jsx`
- `src/components/clinical/OpenClinicalActions.jsx`
- `src/components/clinical/ClinicalTimeline.jsx`
- `src/pages/patient/PatientAppointments.jsx`
- `src/pages/doctor/DoctorAppointments.jsx`
- `src/components/doctor/DoctorAppointmentDetailDrawer.jsx`

## 14. Files preserved

Every file from Phase DOC-09 and earlier not listed above is untouched.
No engine was rebuilt: scheduling (`ensureDoctorAvailable`/slot engine),
the notification/realtime infrastructure, the Clinical Timeline/Patient
Relationship Center data shape, and the Appointment status/transition
machine are all exactly as DOC-07/DOC-04/P3 left them.

## 15. Deferred items + why

- **Live E2E (browser/MongoDB)** — unavailable in this sandbox, consistent
  with every prior phase. Verified instead via: unit tests for all new pure
  logic, source-inspection tests locking in the exact fix (matching the
  established pattern from `appointmentCancellationCrossRoleNotification.test.mjs`),
  full existing suite unchanged, clean build, clean boot
  (ECONNREFUSED-only).
- **A dedicated Follow-up Detail drawer/page (brief §22)** — deliberately
  not built as a separate page. The brief itself warns against duplicating
  the Patient Profile; the existing Follow-up Status card plus Open
  Clinical Actions plus the Appointment Detail Drawer together already show
  patient/reason/recommended-date/scheduled-appointment/status/next-action
  without a fourth place doing the same job.
- **Smart Inbox integration (brief §17)** — not touched. Audited: follow-up
  events already flow through the existing `NotificationDelivery`
  (`type: "appointment"`) → Smart Inbox pipeline generically, with no
  special-casing needed; the two new notification messages (patient
  notified of a doctor-booked follow-up; continuity-aware cancellation
  wording) automatically appear there with zero additional code, verified
  by reading `doctorInboxAggregates.js`'s generic `entityType === "appointment"`
  handling.
- **AI Continuity Intelligence enrichment (brief §23)** — `scheduledFollowUps`
  is available to `generativeAssistant.js` (same import path,
  `resolveScheduledFollowUps` is exported) but wasn't wired into the AI
  brief this phase — the audited gap set was UI/state-tracking, not an AI
  capability gap, and adding it without a specific brief item to anchor it
  to would be scope creep beyond what was found.
- **Backfilling `followUpCancelledAt` for historical cancelled follow-ups**
  — no migration was run. Any pre-P10 data where a follow-up appointment
  was already cancelled before this fix existed will surface via the
  defensive `cancelled_needs_action` bucket (the linked appointment is
  still `cancelled` and still linked) rather than `followUpCancelledAt`
  being backfilled — functionally equivalent visibility, no migration risk.


## 16. Test results

71/71 backend test files passing (67 pre-existing + 4 new P10 test files:
`followUpContinuity.test.mjs`, `followUpCancellationContinuity.test.mjs`,
`followUpSchedulingConcurrency.test.mjs`,
`followUpContinuityInvariants.test.mjs` — see §22 for what the hardening
pass specifically added to this coverage).

## 17. Lint

`npx eslint .` — 0 errors, 0 warnings, repo-wide.

## 18. Build

`npm run build` — clean production Vite build, no errors.

## 19. Boot

`node server.js` — clean boot, ECONNREFUSED-only (no live MongoDB in this
sandbox, consistent with every prior phase).

## 20. Fresh-extract result

Full project zipped (excluding `node_modules`/`dist`/`.git` per convention),
extracted into a new directory, dependencies reinstalled from scratch for
both `backend/` and the frontend, full test suite + lint + build + boot
re-run against that clean extraction — all passing. See delivery zip:
`MediCore-HMS-PHASE-P10-FOLLOW-UP-CONTINUITY.zip`.

## 21. Live DB/browser limitation

No MongoDB instance or browser is available in this sandbox. Every claim
above is backed by: unit tests, source-inspection tests, a clean production
build, and a clean server boot (failing only on the expected
`ECONNREFUSED` from the absent database) — never by a live end-to-end run
that wasn't actually performed.
## 22. Hardening pass (post-review corrections)

A follow-up review of this delivery correctly identified two business-rule
correctness gaps in the first pass and one incomplete scale audit. All
three are now fixed and covered by real tests, not just documentation:

### 22.1 Cancellation atomicity

The original fix cancelled the Appointment, then updated the Prescription
inside a single try/catch that silently continued on failure — a
transient DB error there could recreate the exact bug this phase closes.
Fixed:

- **Ordering analysis made explicit**: cancelling the Appointment first is
  the provably safer order (see the header comment on
  `cancelAppointmentCore` in `appointmentCancellationService.js`) — if the
  Prescription write then fails, the worst case is a prescription still
  pointing at a genuinely-cancelled appointment (safe, self-healing), never
  two simultaneously-active ones (unsafe).
- **Retry with backoff** (3 attempts, 75ms/150ms/225ms) replaces the single
  best-effort attempt.
- **Self-healing read path, proven, not assumed**: even if every retry
  fails, `resolveScheduledFollowUps()` already classifies a
  linked-but-cancelled appointment as `cancelled_needs_action` — visible on
  the Dashboard, Patient Profile, and Open Clinical Actions exactly as if
  the write had succeeded. `followUpContinuityInvariants.test.mjs` proves
  this composition end-to-end (cancel → reappear as overdue; write-failure
  case → still visible via `cancelled_needs_action`, never silently lost).
- No multi-document transaction was used because this project's MongoDB
  deployment is a standalone `mongo:7` container (see docker-compose.yml,
  no `--replSet`), which does not support them — consistent with every
  other race-condition fix already in this codebase (e.g. the
  doctorId+date+timeSlot unique index), all of which use single-document
  atomicity + retry/compensation rather than transactions.

### 22.2 Duplicate-follow-up race condition

The original fix checked for an existing active link, then created the
Appointment, then linked the Prescription — three separate operations with
two race windows between them. Fixed with a genuinely atomic claim:

- `claimFollowUpSlot()` (new, exported from `doctorPatientRelationshipService.js`)
  performs a single conditional `findOneAndUpdate` — using a
  **pre-generated Appointment `_id`** — that atomically transitions the
  Prescription from "no active link" to "linked to this id" in one
  indivisible database operation, *before* the real Appointment document
  is created. Whichever concurrent request's write reaches MongoDB first
  is the only one whose precondition still matches; every other
  concurrent request's `findOneAndUpdate` simply finds nothing to update
  and returns `null` — no second real Appointment is ever created, not
  even transiently.
- **Rollback on appointment-creation failure**: if `Appointment.create()`
  then fails (slot conflict, validation error, anything), the claim is
  released (`$unset` scoped to the exact claimed id, so it can never touch
  a different concurrent claim) before the error propagates — the
  prescription is left exactly as it was, satisfying "failed appointment
  creation → prescription must remain unchanged."
- **No separate post-creation linking step is needed at all anymore** —
  the claim already set the link before creation, closing the "failed
  prescription linking → orphan active appointment" failure mode
  structurally rather than by trying to catch it after the fact.
- Extracted into its own function specifically so its concurrency
  correctness is unit-testable: `followUpSchedulingConcurrency.test.mjs`
  races real concurrent calls (via `Promise.all`, against an in-memory
  fake that deliberately interleaves the read and write halves of the
  update with an explicit `await` between them — the actual worst-case
  interleaving a database client can observe) and proves exactly one of
  up to ten concurrent claims ever wins.

### 22.3 Dashboard scale (audited, not blindly un-capped)

The `.limit(100)` scheduled-follow-up query had no `.sort()` before the
cap — an arbitrary, non-representative 100 documents could be returned,
silently excluding the doctor's most relevant follow-ups. Fixed:

- The query now reads from `Appointment` directly (the collection with the
  real, already-indexed `date` field — Prescription has no date field for
  the *scheduled* appointment, only for the original recommendation),
  **sorted by date ascending**, so a truncation can only ever drop the
  farthest-future/oldest — least relevant — items.
- Still-active/future follow-ups have **no forward date bound** (a
  follow-up booked two months out is real and already handled, unlike an
  unscheduled recommendation that needs a 14-day urgency window);
  completed/cancelled ones remain bounded to the existing 14-day trailing
  window.
- A parallel `Appointment.countDocuments()` (same filter, no cap) is the
  only way to know if the capped query actually dropped anything;
  `followUpQueueTruncated` is now returned by `buildDoctorCommandCenterData`
  and rendered in `FollowUpQueue` as a "View all in Appointments" notice —
  the boundary is communicated, never silent.
- Noted but explicitly out of scope for this phase: the pre-existing
  (Phase DOC-07) unscheduled-overdue query has no lower date bound and no
  `.limit()` either — a real, separate scale question that predates P10
  and wasn't part of the audited gap set for the scheduled-follow-up query
  this review specifically flagged.

### 22.4 Additional test coverage

Two new test files (`followUpSchedulingConcurrency.test.mjs`,
`followUpContinuityInvariants.test.mjs`) plus expanded assertions in
`followUpCancellationContinuity.test.mjs`, covering: concurrent duplicate
scheduling (genuine interleaved-race behavioral test, not sequential
calls), cancellation → recommendation reappears (composed through the real
`resolveFollowUpState`/`resolveScheduledFollowUps` functions), a failed
unlink write still being visible (self-healing invariant), reschedule
preserving the same continuity link, cancelled → new follow-up allowed,
active → second scheduling rejected, and ownership scoping (wrong
doctor/patient rejected even for an otherwise-unlinked prescription).

**Honest limitation, confirmed by hand, not assumed**: `mongodb-memory-server`
is present in `package.json` and does work in principle (see
`tests/api.test.js`, pre-existing and not part of `npm test`), but its
`mongod` binary download is blocked by this sandbox's network egress
allowlist — verified directly (the download attempt returns a blocked
response). This is why the concurrency/behavioral tests above use a
purpose-built in-memory fake that models MongoDB's atomicity contract
under deliberate interleaving, rather than a real database — this tests
that our application code asks the database for the correct operation
shape (a single conditional update), which is the part application code
is actually responsible for; MongoDB's own engine-level atomicity
guarantee for that operation is the database's contract, not something
application-level tests can or need to re-verify.

### 22.5 Re-verification after hardening

- Full backend suite: **71/71 passing** (67 original + 4 P10 test files).
- `npx eslint .`: 0 errors, 0 warnings.
- `npm run build`: clean production Vite build.
- Backend boot: clean (ECONNREFUSED-only, no live Mongo in sandbox).
- Fresh-extract gate re-run in full: zipped → extracted into a new
  directory → dependencies reinstalled from scratch (both `backend/` and
  frontend) → full suite/lint/build/boot re-run against that clean
  extraction — all passing. All P10 files (including the two new test
  files from this hardening pass) confirmed present; all prior-phase files
  confirmed intact.

