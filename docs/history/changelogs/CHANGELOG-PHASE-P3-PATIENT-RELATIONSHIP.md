# Phase P3 — Patient Relationship (MediCore-PRIME-20)

## Audit finding

The Patient Relationship Center was **not greenfield** — Phases DOC-03 and
DOC-03B (present in this same extracted project) had already built the core
of it: real server-side search/filter/sort/pagination on `getDoctorPatients`
(`doctorPatientRelationshipService.js`), a real chat-authorization fix
(`chatAuthorization.js` — closed a genuine IDOR where any authenticated user
could read/send messages to any other user), real unread-message read-state
tracking (`chatReadState.js`), a real `DoctorPatientProfile.jsx` workspace
hub with tabs (Overview/Timeline/Appointments/Prescriptions/Documents/
Communication), a live embedded `ConversationPanel.jsx` (single chat engine,
reused — not duplicated — from `ChatWorkspace.jsx`), deterministic
(non-fabricated) risk/attention rules, and real follow-up scheduling wired
into the actual booking/availability engine.

A full audit (frontend + backend, `TODO`/`FIXME`/mock/hardcoded/placeholder
sweep, route/deep-link verification, authorization tracing) found this
existing work sound. Per the brief's directive to reuse rather than rebuild,
this phase did **not** recreate any of it. It closed the genuine gaps found
during audit.

## Real gaps found and fixed

1. **Patient reviews were invisible in the Patient Relationship Center.**
   `Review` documents are already scoped by `doctorId` + `userId` (the
   patient) — a real per-relationship signal ("what did this patient say
   about their care") — but `getPatientClinicalProfile` never queried them,
   so neither the Overview tab nor the shared `ClinicalTimeline` (used by
   both `DoctorPatientProfile.jsx` and `DoctorClinicalWorkspace.jsx`) ever
   showed a patient's own reviews of that doctor.
   - Backend: added a bounded, scoped `Review.find({ doctorId, userId:
     patientId, adminDeleted: { $ne: true } })` query alongside the profile's
     existing parallel queries; merged into the timeline as a `review` kind
     event (`rating`, `hasReply`); returned as `reviews` in the response.
   - Frontend: `ClinicalTimeline.jsx` gained a `review` icon/label mapping
     (additive — every existing kind unchanged). `DoctorPatientProfile.jsx`
     gained a "Patient Reviews" card in Overview that deep-links to the
     existing Reviews workspace via its established `?reviewId=` focus
     mechanism (DOC-05) — no second reply UI built.

2. **A real disconnected-frontend-consumer bug.** `appointmentController.
   getAppointments` already supports scoping to one patient via
   `?patientId=` — the backend code comment literally names the intended
   caller ("e.g. from the Patient Directory's History/Follow Up links") —
   but `DoctorAppointments.jsx` never read that query parameter. The
   capability existed on the server with zero frontend consumer, the same
   bug class fixed repeatedly in earlier phases (DOC-06 certificates,
   UI-13 admin pages, etc.).
   - Fixed: `DoctorAppointments.jsx` now reads `?patientId=` and `?highlight=`
     from the URL. `patientId` scopes the list (defaults the queue tab to
     "All" instead of "Today's Clinic" — a doctor arriving from a patient's
     profile wants that patient's full history, not just today's clinic);
     `highlight` auto-opens the existing `DoctorAppointmentDetailDrawer` for
     that specific appointment once it's found on a loaded page (never a
     fake/blank drawer if it's on another page or was removed). A "Showing
     appointments for one patient — Clear filter" banner makes the scope
     visible and reversible. The doctor-wide summary cards deliberately stay
     whole-practice (no patient-scoped summary endpoint exists) rather than
     being silently mislabeled as this patient's numbers.
   - `DoctorPatientProfile.jsx`'s Appointments tab now has a "View all in
     Appointments" button and a per-row "View Details" button, both using
     this newly-wired deep link — closing the loop the backend comment
     described but the frontend never built.

## Files changed

- `backend/controllers/doctor/workflowController.js` — `Review` import;
  `getPatientClinicalProfile` gained the scoped review query, timeline
  merge, and `reviews` response field.
- `src/components/clinical/ClinicalTimeline.jsx` — additive `review`
  icon/label.
- `src/pages/doctor/DoctorPatientProfile.jsx` — Patient Reviews card;
  Appointments tab deep-links.
- `src/pages/doctor/DoctorAppointments.jsx` — `?patientId=`/`?highlight=`
  deep-link consumer, patient-scope banner, highlight auto-open, tab
  re-defaulting.

## Source-of-truth decisions

- No second review engine: reused the exact `Review` model/fields and the
  existing Reviews workspace's `?reviewId=` focus mechanism.
- No second appointment state machine or detail UI: reused the existing
  `DoctorAppointmentDetailDrawer` and `getAppointments`'s existing filter
  support verbatim.
- No new scheduling/chat/document engine touched — those were already
  correct per audit.

## Security

- Reviews query is scoped by both `doctorId` and `userId` (the patient) —
  a doctor can only ever see this one patient's own reviews of them, never
  another patient's or another doctor's, and the route this new query lives
  in (`/doctor/patients/:patientId/clinical-profile`) is already gated by
  `ensureDoctorTreatedPatient` (real ownership check).
- Appointment deep-link's `?patientId=` param is the same pre-existing,
  already-role-gated (`req.user.role === ROLES.DOCTOR`) backend filter — no
  new authorization surface introduced.

## Tests

- 60/60 pre-existing backend tests pass unchanged (no test regressions).
- No new pure/dependency-free function was introduced (the review-timeline
  merge is a small inline addition to an existing controller aggregate,
  consistent with how appointment/prescription/note/report/certificate
  events already merge into that same timeline) — so no new isolated test
  file was needed for this pass.

## Build / Lint

- `node --check` clean on both touched backend files.
- `npm run lint` — 0 errors, 0 warnings.
- `npm run build` — clean production build (pre-existing >500kB main-chunk
  advisory notice is unrelated to this phase's changes).
- Backend boot check: clean startup, `ECONNREFUSED 127.0.0.1:27017` only
  (no live MongoDB in this sandbox — expected, consistent with every prior
  phase).

## Fresh-extract verification

Performed on the exact final zip: extracted to a clean directory, ran
`npm install` (root + `backend/`) from scratch, re-ran the full backend
test suite, lint, and build against that clean extraction. See final report
for the fresh-extract-specific result.

## Known limitations / deferred

- **Live E2E (browser + real MongoDB) is NOT available in this sandbox** —
  every check above is static/unit-level verification, not a live click-
  through. Consistent with every prior phase's stated limitation.
- Appointment summary cards on `DoctorAppointments.jsx` remain whole-
  practice even when patient-filtered (no patient-scoped summary endpoint
  exists) — deliberately not fabricated as patient-specific; a real
  patient-scoped summary endpoint was out of this phase's audited-gap list
  and would be a new feature, not a bug fix.
- No new "doctor uploads a document directly to this patient" action was
  added — audited and confirmed no such backend capability/authorization
  exists yet, so no button was added for it (per the brief: never add a UI
  action the backend doesn't actually support).
- Patient contact fields beyond email (e.g. phone) are not surfaced in
  `PatientSnapshot` — audited `User`/`patientProfile` schema and found no
  top-level patient phone field exists outside `emergencyContact.phone`
  (a different person), so none was fabricated or invented.
