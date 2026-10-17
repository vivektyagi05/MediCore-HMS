# CHANGELOG — Appointment Regression Repair (pre-P10)

## Root cause (confirmed from the reported runtime log)

`GET /api/appointments/available-slots` → 200, then `POST /api/appointments`
→ 400 "Validation failed".

`Doctor.consultationMode` and `Appointment.consultationMode` are two
different, unreconciled vocabularies for the same real-world thing:

| Doctor (producer)      | Appointment (canonical, pre-fix) |
|-------------------------|-----------------------------------|
| `online`                | `online`                          |
| `offline`                | *(not accepted — enum was `online`/`in_person` only)* |
| `home_visit`             | *(not accepted at all — missing from the enum)* |

`BookAppointment.jsx` reads a doctor's offered modes straight off the
Doctor document and POSTs that value verbatim. A doctor whose profile said
`"offline"` produced a request `validateAppointmentCreate` had never been
taught to accept — a real cross-system contract mismatch, not a bad string
to just add to an enum. `home_visit` was equally broken and had never been
reachable at all.

## Fix — single source of truth for the contract

New file `backend/constants/consultationMode.js` defines the full
Doctor→Appointment mapping (`offline → in_person`, others pass through) and
the two vocabularies. Nothing else hardcodes this mapping.

- `backend/models/Appointment.js` — added `home_visit` to the
  `consultationMode` enum (it was silently unbookable, exactly like
  `offline`, just never reported).
- `backend/validations/appointmentValidation.js` — now validates the
  **canonical** vocabulary (`online` / `in_person` / `home_visit`).
  Callers accepting a raw Doctor-side value must canonicalize first.
- `backend/controllers/appointmentController.js` (`createAppointment`) —
  canonicalizes the incoming raw value before validation ever sees it,
  rejects anything outside the known Doctor vocabulary outright (no fake
  fallback), keeps the existing "doctor actually offers this mode"
  authorization check against the **raw** value (matches what's stored on
  Doctor.consultationMode), and stores the **canonical** value on the
  Appointment.
- `backend/controllers/doctor/workflowController.js`
  (`scheduleFollowUpAppointment`) — same contract applied for consistency;
  this doctor-initiated follow-up path shares the exact same field and had
  the identical latent bug (currently unreachable because its dialog
  doesn't send `consultationMode` yet, but now correct if it ever does).

## Second bug found during the mandated producer audit

Auditing every producer of `Doctor.consultationMode` (as required) turned
up an independent, more serious bug: `DoctorPracticeSettings.jsx` was the
**only** real UI for a doctor to set their consultation modes, and it was
completely disconnected from the actual schema —

- it single-selected from `["in_person", "online", "both"]`, none of which
  are real values;
- it compared that selection against the array the API returns, so nothing
  ever rendered as selected;
- `updatePracticeSettings` wrote whatever was sent straight onto the
  Doctor document with zero validation.

A doctor saving practice settings through the only settings page that
exists could silently corrupt their own `consultationMode` field. Fixed:

- `src/pages/doctor/DoctorPracticeSettings.jsx` — rebuilt as a real
  multi-select over the three actual values (`online` / `offline` /
  `home_visit`), matching `Doctor.consultationMode`'s array shape.
- `backend/controllers/doctor/practiceController.js`
  (`updatePracticeSettings`) — added validation rejecting anything that
  isn't a non-empty array of known values.

## Patient-facing correctness ("home_visit must not silently become
in-clinic")

- `src/pages/patient/BookAppointment.jsx` — the consultation-type step
  labeled every non-"online" doctor mode as "In-Person Visit", so a
  home-visit doctor's option was mislabeled. Added distinct titles/
  descriptions for `online` / `offline` / `home_visit`, and a shared
  `doctorModeLabel()` helper used consistently in the summary and review
  steps (previously showed the raw string, e.g. literally "offline").
- `src/pages/patient/PatientAppointments.jsx` — the mode badge collapsed
  everything non-"online" into "In-Clinic"; now uses `consultationModeLabel`
  with a distinct color for `home_visit`. "Get Directions" was shown for
  any non-online appointment (including home visits, where the doctor
  travels to the patient, not the other way around) — now shown only for
  `in_person`.
- `src/components/doctor/dashboard/DoctorHomeWidgets.jsx` — added the
  missing `home_visit` icon/label branch (previously silently blank).
- `src/utils/icsGenerator.js` — a home-visit appointment's calendar entry
  previously showed the clinic's address; now says the doctor will visit
  the patient's address.
- `src/utils/appointmentStatusDisplay.js` — added the missing `home_visit`
  entry to `CONSULTATION_MODE_LABELS`.

## Error UX requirement

`src/api/axios.js` (`getApiErrorMessage`) only ever read the generic
`message` field, discarding the per-field `details` the backend's
`errorMiddleware` already computes for validation failures. A validation
error always surfaced as the bare "Validation failed" with the actual
reason silently dropped. Now surfaces the real field message(s) when
present, while deliberately ignoring non-string detail values (structured
payloads like `{ code: "SLOT_CONFLICT" }`, `{ governance }`,
`{ failedControls: [...] }`) so nothing beyond an author-written message is
ever shown — no stack traces, no DB internals, nothing new leaked.

## Full patient journey — traced, not assumed

Booking → doctor approval → payment → consultation start/end →
prescription/note → completion → review-eligible was already a real,
connected, single-source-of-truth state machine from prior phases
(`STATUS_TRANSITIONS`, `cancelAppointmentCore`, `dashboardSyncTick`
realtime pattern, `CANCELLABLE_STATUSES` derived from `STATUS_TRANSITIONS`
itself). No second engine was built or needed. The only defect in that
journey was the consultation-mode contract mismatch above, which blocked
step one (`POST /appointments`) for any `offline`/`home_visit` doctor
before the rest of the journey could ever be reached.

## Verification

- `node --check` on every changed backend file + a full repo-wide sweep —
  clean.
- New `backend/tests/consultationModeContract.test.mjs` (9 assertions):
  canonicalization contract, unknown-value rejection, vocabulary
  correctness, `isKnown*` guard scoping, and `validateAppointmentCreate`
  accepting the canonical vocabulary (including the newly-reachable
  `home_visit`) while rejecting raw Doctor-side values.
- Full backend suite: **65/65 passing** (64 pre-existing + 1 new).
- ESLint: 0 errors repo-wide.
- Production build: clean.
- Boot check: ECONNREFUSED-only (no MongoDB in sandbox — consistent with
  every prior phase; not claimed as live-verified).
- Fresh-extract gate: extracted this exact zip to a clean directory,
  reinstalled all dependencies from scratch, reran the full suite/lint/
  build/boot — identical clean results.

## Addendum — legacy data migration + remaining frontend gaps (this pass)

Independent re-verification of the state above (fresh test/lint/build run,
not just re-reading the prior notes) confirmed everything documented above
is real and passing, but found the fix was **incomplete**: nothing
normalized legacy MongoDB data, and two frontend consumers still read
`Doctor.consultationMode` raw, unfiltered. Together these reproduce the
exact reported bug on any doctor document written before this contract
existed.

### Root cause of the reported "Both" button (proven, not assumed)

`src/pages/patient/BookAppointment.jsx`'s `StepConsultationType` built its
list of selectable modes directly from `doctor.consultationMode` with zero
filtering: `doctor?.consultationMode?.length ? doctor.consultationMode :
["online"]`. A doctor document still holding the pre-repair legacy value
`"both"` therefore rendered a button labeled (via `capitalize` CSS)
literally **"Both"**. Selecting it set `form.consultationMode = "both"` and
POSTed it verbatim. `isKnownDoctorConsultationMode("both")` in
`appointmentController.js` correctly returns `false`, producing the
reported `POST /api/appointments → 400 "Validation failed"`.

The doctor-side error is the same root cause from the other direction:
`DoctorPracticeSettings.jsx`'s `load()` put whatever array the API
returned straight into editable state with no filtering. For a doctor
whose stored data still contained `"both"`, that value survived in state
(the multi-select buttons can't un-check a value they don't render) and
was re-sent on the next Save, tripping the practice-settings validation
added earlier in this repair: `"consultationMode must be a non-empty array
containing only: online, offline, home_visit"` — the exact reported error.

### Fix

- `backend/migrations/002_normalize_consultation_mode.js` (new) — the DB
  migration required by the spec and missing from the first pass. Maps
  `"both" → ["online","offline"]` and `"in_person" → ["offline"]`
  (documented reasoning for both mappings in the file), leaves already-
  canonical arrays untouched, handles legacy bare-string (non-array)
  values, dedupes mixed legacy+canonical input, and never guesses a mode
  for a wholly-unrecognized value — those documents are left unchanged and
  listed under "needs manual review" in the run's console output instead.
  Idempotent: a document with no changes needed is skipped entirely (no
  write), so a second run modifies 0 documents. Registered as
  `npm run migrate:consultation-mode` (both root and backend
  `package.json`), matching the existing `migrate:doctor-profiles`
  convention.
- `src/utils/consultationMode.js` (new) — single frontend source of truth
  for the Doctor-producer vocabulary (mirrors
  `backend/constants/consultationMode.js`), plus
  `normalizeDoctorConsultationModes()` used by every frontend reader below.
- `src/pages/doctor/DoctorPracticeSettings.jsx` — `load()` now normalizes
  the API response before it enters editable state, so a legacy value can
  no longer silently survive a save. Also switched its local
  `CONSULTATION_MODES`/`CONSULTATION_MODE_LABELS` to import from the new
  shared file instead of a second hardcoded copy.
- `src/pages/patient/BookAppointment.jsx` — `StepConsultationType`'s
  `modes` list and the initial `consultationMode` form default now both go
  through `normalizeDoctorConsultationModes()`. A legacy value can no
  longer be offered to a patient or silently pre-selected.
- `src/components/doctors/DoctorDiscoveryUI.jsx` — the doctor-search
  result cards had the identical bug one layer earlier (rendering a badge
  for every raw `doctor.consultationMode` entry, which for `"both"` has no
  `MODE_CLS`/i18n entry and would surface the raw value). Same normalizer
  applied.

### Tests

- `backend/tests/consultationModeMigration.test.mjs` (new, 6 assertions):
  the two documented legacy mappings, canonical values left byte-for-byte
  unchanged, idempotency (normalizing already-normalized output is a
  no-op), mixed legacy+canonical dedup, bare-string legacy input, and
  unrecognized/empty input never being guessed at.
- Full backend suite re-run: **66/66 passing** (65 from the first pass + 1
  new).
- `npm run lint` (root, eslint over the whole repo): 0 errors.
- `npm run build` (root, vite production build): clean.
- Backend boot check: `ECONNREFUSED`-only (no MongoDB in this sandbox),
  consistent with every prior phase.

### Explicitly deferred / not claimed (this pass)

- The migration has not been run against a live database in this sandbox
  (no MongoDB available) — its logic is covered by
  `consultationModeMigration.test.mjs` against the pure normalization
  function, but the live `updateMany`/`find` path against a real
  `doctors` collection is not live-verified. Run
  `npm run migrate:consultation-mode` against a real environment and
  review its console output (especially any "needs manual review" lines)
  before considering existing data fully normalized.
- Live browser/MongoDB E2E of the full patient journey remains unavailable
  in this sandbox, same as the first pass.

## Explicitly deferred / not claimed (original pass)

- Live browser/MongoDB E2E of the full patient journey — unavailable in
  this sandbox (no MongoDB, no browser), consistent with every prior
  phase. Source-level tracing confirms the state machine and its frontend
  consumers are wired correctly; this is **not** a substitute for live
  verification and is flagged as such rather than claimed.
- No other appointment-lifecycle regression was found during this audit.

## Files changed

- `backend/constants/consultationMode.js` (new)
- `backend/models/Appointment.js`
- `backend/validations/appointmentValidation.js`
- `backend/controllers/appointmentController.js`
- `backend/controllers/doctor/workflowController.js`
- `backend/controllers/doctor/practiceController.js`
- `backend/tests/consultationModeContract.test.mjs` (new)
- `src/pages/doctor/DoctorPracticeSettings.jsx`
- `src/pages/patient/BookAppointment.jsx`
- `src/pages/patient/PatientAppointments.jsx`
- `src/components/doctor/dashboard/DoctorHomeWidgets.jsx`
- `src/utils/icsGenerator.js`
- `src/utils/appointmentStatusDisplay.js`
- `src/api/axios.js`

Nothing else was touched. P9 was not reopened or modified.
