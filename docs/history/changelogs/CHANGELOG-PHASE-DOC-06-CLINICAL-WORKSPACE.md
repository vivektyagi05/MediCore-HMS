# PHASE DOC-06 — Clinical Intelligence & Consultation Workspace

## Audit summary (read before code was written)

Traced the existing Clinical Workspace end-to-end: `DoctorClinicalWorkspace.jsx`
→ `doctor/workflowController.js` → `Prescription`/`MedicalNote`/`Certificate`
models → realtime (`clinicalEmitter.js`) → notifications
(`NotificationDelivery`) → patient-side consumers (`patientWorkflowController.js`,
`PatientRecords.jsx`).

Classification of what already existed:

| Capability | Status |
|---|---|
| Patient clinical profile aggregation (`getPatientClinicalProfile`) | REAL + CONNECTED |
| Clinical timeline (appointments/prescriptions/notes/reports/certificates) | REAL + CONNECTED |
| Prescription safety checks (allergy/duplicate/recent-Rx) | REAL + CONNECTED |
| Prescription PDF generation + patient download | REAL + CONNECTED (patient already sees medicines, diagnosis, notes, follow-up date) |
| AI advisory panels (note drafting, consultation summary, pre-charting, follow-up suggestion, patient education) | REAL + CONNECTED, correctly advisory-only, observed/summary/recommendation separated |
| Medical notes (SOAP-style) | REAL + BACKEND+FRONTEND, but doctor-private by design (no patient exposure — a deliberate existing boundary, left alone) |
| Certificate issuance + doctor-side download | REAL + BACKEND ONLY — **no patient-side access existed at all** |
| Prescription-created notification to patient | BROKEN — realtime-only, no persisted `NotificationDelivery` row |
| Certificate-created notification to patient | BROKEN — didn't even reach the patient's realtime room, let alone persist |
| Consultation state machine (payment_completed → consultation_started → consultation_completed → completed) | REAL + CONNECTED, correctly enforced both frontend and backend |
| Clinical Workspace information architecture | POOR — five flat tabs (Overview/Prescriptions/Notes/Certificates/History), documentation and prescribing were two disconnected forms with two separate appointment pickers |

No fake data, no fake buttons, no duplicate clinical engines found anywhere in
the existing implementation — the backend was almost entirely sound. The two
genuine gaps were connective (patient-side certificate visibility) and a
notification bug class already fixed elsewhere in this codebase (DOC-02,
DOC-05) that had recurred in a producer nobody had audited yet.

## Real bugs found and fixed

1. **`clinicalEmitter.prescriptionCreated` never notified the patient** —
   it emitted a live Socket.IO event only. A patient offline at the moment
   a prescription was written never saw it afterward; nothing was ever
   written to `NotificationDelivery`. Fixed by awaiting a real
   `notificationEmitter.emitToUser` call, idempotent via `eventKey`, matching
   every other producer in the codebase.
2. **`clinicalEmitter.certificateCreated` didn't notify the patient at all** —
   it only emitted to the *doctor's own* room. The patient the certificate
   was issued for got nothing: no realtime event, no persisted notification.
   Fixed the same way as (1), plus added the missing `patientRoom` realtime
   emit.
3. **`NotificationDelivery.type` had no `"certificate"` value** — so even
   after fixing (2), the notification would have failed Mongoose validation
   the moment it was created. Added additively; every existing enum value
   is untouched.

## Real missing connection — patient-side certificates (built, not faked)

Certificates (fitness / sick-leave / referral letters) could be issued by a
doctor but were completely invisible to the patient they were issued for —
zero endpoint, zero UI, despite the full model, PDF generation, and
ownership-scoping already existing on the doctor side. Per the phase's
end-to-end requirement, this was implemented rather than deferred:

- `GET /patient/certificates` — list certificates scoped to `patientId: req.user._id` (mirrors `listPatientPrescriptions` exactly)
- `GET /patient/certificates/:id/download` — ownership-scoped PDF download (mirrors `downloadPatientPrescription` exactly)
- Certificates now appear in the patient's existing Health Timeline (`buildPatientTimelineData`), additive-only — every other timeline entry type is untouched
- New "Certificates" card on `PatientRecords.jsx`, styled to match the existing Reports card exactly; shows revoked status/reason when applicable rather than hiding a revoked certificate

## Clinical Workspace redesign

`DoctorClinicalWorkspace.jsx`'s information architecture was rebuilt around
the actual doctor workflow (understand patient → document → diagnose →
prescribe → complete) instead of five disconnected tabs of raw API data:

- **Notes and prescriptions are now one workflow**, not two separate forms
  with two separate appointment pickers. Selecting a consultation once now
  drives both the SOAP note form and the prescription builder.
- **A real, non-fabricated documentation-readiness strip** shows whether a
  note and/or a prescription already exist for the selected consultation —
  computed from the same `notes`/`prescriptions` arrays already loaded, never
  guessed.
- **Primary workflow (note + diagnosis/prescription) is now visually
  dominant**; the searchable Prescription/Notes libraries (cross-patient
  browsing, not the active task) moved below the fold, matching the spec's
  "workstation, not a dashboard" requirement.
- **AI advisory panels are unchanged in behavior** — still clearly advisory,
  still require the doctor to Insert/Approve, never auto-write to a record.
- **Zero breaking changes to deep links.** ~15 existing call sites across
  `DoctorDashboard.jsx`, `DoctorPatients.jsx`, `DoctorAppointments.jsx`,
  `DoctorPatientProfile.jsx`, `DoctorReviewDetailDrawer.jsx`, and
  `DoctorAppointmentDetailDrawer.jsx` link in with `?tab=notes` or
  `?tab=history`. Both query values are still fully supported — `tab=notes`
  and `tab=prescriptions` now render the same merged Consultation view, and
  `tab=history` is untouched. Verified by grep audit of every existing
  `/doctor/clinical?` reference before making the change, not assumed safe.
- Patient Snapshot header, Clinical Timeline, Certificate Generator, and the
  Consultation Timer/One-click Complete cards were already real and correct
  — reused unchanged.

## What was deliberately NOT built

- No new patient-facing exposure of `MedicalNote` (symptoms/clinical
  notes/recommendations). The prescription already carries doctor-authored
  instructions (diagnosis, medicines, notes, follow-up date) to the patient
  end-to-end via the existing PDF + prescription timeline. Exposing the
  doctor's separate private clinical note as well would be a second,
  redundant instructions channel — not a real gap, and explicitly out of
  scope per the "no feature bloat" rule.
- No second AI pipeline, no `ClinicalEngineV2`/`PrescriptionEngineV2`, no new
  realtime transport — every fix reuses the existing Socket.IO/notification
  architecture.
- No controlled diagnosis vocabulary was invented — `Prescription.diagnosis`
  is, and remains, free text; there was no existing taxonomy to fake one
  against.

## Tests

New file: `backend/tests/clinicalWorkspaceNotifications.test.mjs` (4
assertions, dependency-free — no live MongoDB, matches the existing
`workflowNotifications.test.mjs` convention exactly):
- `NotificationDelivery` accepts `type: "certificate"`
- `NotificationDelivery` still accepts the pre-existing `type: "prescription"`
- `NotificationDelivery` still rejects an unrecognized type (enum isn't wide open)
- Locks the `eventKey` idempotency-key shape used by the new producers

**56 pre-existing + 1 new = 57/57 backend tests passing.**

## Verification

- `node --check` on every backend `.js` file: clean
- Full backend test suite (`node backend/tests/run-all.mjs`): **57/57 passing**
- Server boot check: clean (ECONNREFUSED-only — no live MongoDB in this
  sandbox, consistent with every prior phase)
- ESLint (`npm run lint`): **0 errors**
- Production frontend build (`npm run build`): clean
- Fresh-extract gate: this exact final zip was extracted to a clean
  directory, dependencies reinstalled from scratch (`npm ci` on both
  frontend and backend), and the full test suite / lint / build / boot check
  were re-run against that fresh extraction — **all passed identically**
- Live browser/MongoDB E2E: **NOT VERIFIED** — no live MongoDB or browser
  runtime available in this sandbox, consistent with every prior phase.
  Reason recorded honestly rather than claimed.

## Known limitations / explicitly deferred

- Live E2E (login → clinical workspace → note → prescription → complete →
  patient sees certificate/prescription/notification) is untested against a
  real database/browser in this environment.
- No new realtime event class was introduced; certificate/prescription
  notifications reuse the existing `notification:new` socket event and
  `NotificationDelivery` polling/socket pattern already used everywhere else.
- Patient-facing certificate revocation notice (a follow-up notification when
  a certificate is later revoked) was not added — out of scope for this
  phase's brief, which centered on the consultation workspace and the
  create-time notification bugs found during that audit.
