# MediCore HMS — Doctor Clinical Intelligence Workspace (Phase D2)

Rebuilds **Clinical**, **Schedule**, and **Documents** into one connected
workflow, on top of the already-completed Phase D1 (Doctor Command Center).
Every item below reuses existing architecture (models, controllers, routes,
components) first and extends only where a real gap existed. Nothing is
fabricated — where the backend genuinely lacked support for a requested
capability, it's listed under Deferred, not faked.

## 1. Audit findings (before writing code)

- No dedicated `prescriptionController`/`medicalNoteController`/`scheduleController` —
  this logic lives in `backend/controllers/doctor/workflowController.js`, already fairly complete.
- **No Certificate model or endpoints existed at all** — Document Center's
  "Generated Certificates" and Clinical Workspace's "Certificate Generator"
  had nothing to build on.
- Doctors had **no way to open a patient's actual report file** — `getDoctorPatients`
  only ever surfaced title/category/reportDate, no download route, no ownership-checked read endpoint.
- No medicine templates / favourite medicines existed on the Doctor model.
- No schedule "Session Templates" existed — every schedule change meant re-entering the full week.
- `Doctor.documents` subdocuments had a `status` enum (pending/verified/rejected) that
  **nothing in the codebase ever moved off "pending"** — no admin endpoint existed to verify a document.
- **Real bug**: `updateLeaveStatus` only ever blocked the leave's *start* date when approved — a
  multi-day approved leave left every date after day 1 still bookable.
- **Real bug**: `scheduleOptimization`'s first draft assumed `Doctor.availability[].dayOfWeek` was
  numeric (0–6); the actual schema uses lowercase day-name strings (`"monday"`, etc.) — caught and
  fixed before shipping via cross-checking the model.
- **Real bug (caught during verification)**: several new endpoints were first written against
  `MedicalReport.patientId` / `Insurance.patientId` / `Payment.patientId` — the actual field name on
  all three models is `userId`. Fixed by re-checking every model schema against every new query
  before finalizing.
- No safety gate existed preventing a consultation from being finalized to `COMPLETED` with zero
  prescription or note on file for that visit.

## 2. Backend changes (additive only)

**Models**
- `Doctor`: added `medicineTemplates[]`, `favouriteMedicines[]`, `scheduleTemplates[]`; documents
  gained `expiryDate`, `verifiedBy`, `verifiedAt`, `verificationNotes`.
- New `Certificate` model (doctor-issued fitness/sick-leave/referral/other certificates, scoped to
  doctor+patient+optional appointment).

**New utilities**
- `backend/utils/prescriptionSafety.js` — rule-based (not AI) duplicate-medicine (hard block),
  allergy-conflict, recent-duplicate, and dosage/duration completeness checks.
- `backend/realtime/clinicalEmitter.js` — Socket.IO events for prescription created, schedule
  updated, leave status changed, document verified, certificate created (reuses existing
  socket/notification infrastructure).

**`doctor/workflowController.js`** (extended)
- `createPrescription` now runs safety checks and returns `safetyWarnings` (non-blocking) alongside
  the saved prescription; emits `prescription:created`.
- New `checkPrescriptionSafety` — live pre-submit check, same rules, nothing persisted.
- Medicine Templates & Favourite Medicines: full CRUD.
- Certificates: create/list/download (PDF, via the same `pdfkit` pattern as prescriptions)/revoke,
  with a `ensureDoctorTreatedPatient` ownership guard shared across certificates and reports.
- **New doctor-scoped, ownership-checked read access to a patient's lab/medical reports** —
  `getPatientReportsForDoctor` / `downloadPatientReportForDoctor`.
- **New `getPatientClinicalProfile`** — single-patient clinical snapshot/timeline aggregate (merges
  real appointments, prescriptions, notes, reports, insurance, family, certificates, outstanding
  bills into one sorted timeline). Empty sections render as empty, never a placeholder.
- Schedule Session Templates: save/list/apply/delete, re-validated through the existing
  `validateAndDeriveAvailability` slot engine at both save and apply time.
- `getDocumentCenterOverview` — aggregates real document expiry/verification counts and generated
  certificate/prescription/report counts. Explicitly reports `versionHistorySupported: false` rather
  than inventing a history the schema doesn't keep.
- Fixed the leave-approval date-range bug (now blocks every date in `[startDate, endDate]`).
- `uploadDoctorDocument` now accepts an optional `expiryDate`; added `deleteDoctorDocument`.

**`appointmentController.js`**
- New clinical-safety guard: finalizing `CONSULTATION_COMPLETED → COMPLETED` now requires at least
  one `Prescription` or `MedicalNote` on file for that appointment (placed on the *next* transition,
  not on entering `CONSULTATION_COMPLETED`, since prescription/note creation is only unlocked from
  that status onward — putting the check earlier would have been a chicken-and-egg block).

**Admin (`doctorController.js` / `doctorRoutes.js`)**
- New `verifyDoctorDocument` (admin-only) — the missing piece that lets a document's status actually
  move off "pending". Emits a real-time notification to the doctor.

**AI pipeline** (promptLibrary → templateProvider → generativeAssistant → aiAssistController → routes,
following the exact existing pattern, all grounded in real passed-in data, never diagnosing):
- `prescriptionFollowUpSuggestion` — suggests a follow-up window from the real prescribed duration.
- `scheduleOptimization` — compares real upcoming bookings against the doctor's own configured
  capacity per weekday.
- `documentCenterSuggestions` — prioritized action list from real expiry/verification/certificate counts.

## 3. Frontend changes

**New shared components**
- `components/clinical/PatientSnapshot.jsx` — sticky patient-context header (allergies, current
  medications, chronic conditions, insurance, outstanding bills, family).
- `components/clinical/ClinicalTimeline.jsx` — renders the backend's merged timeline.
- `components/clinical/CertificateGenerator.jsx` — issue/download/revoke certificates.
- `components/prescription/PrescriptionEditor.jsx` — extended (backward compatible, all new props
  optional) with medicine-template/favourite selectors, save-as-favourite, and inline safety warnings.

**Rebuilt pages**
- `DoctorClinicalWorkspace.jsx` — Patient Snapshot, Overview tab (Timeline + AI Clinical Brief +
  Reports on File), Prescription Builder (templates/favourites/live safety warnings/follow-up AI
  suggestion), SOAP-style Notes tab (unchanged AI drafting, kept), Certificates tab, History tab,
  plus a new "One-click Complete Consultation" action gated by the new backend safety check.
- `DoctorSchedule.jsx` — Session Templates (save current/apply/delete), Today's Availability and
  Upcoming Leave panels (both derived client-side from real already-loaded data), AI Schedule
  Optimization panel. Existing weekly grid, blocked dates, and leave request/history kept as-is.
- `DoctorDocuments.jsx` — Professional Clinical Vault: expiry/renewal alert banner, category/search
  filters over real documents, Generated Certificates and Generated Prescriptions hubs, AI Document
  Center Suggestions, and an honest note that version history isn't tracked rather than pretending it is.

**API clients**: `doctorWorkflowApi.js` and `aiAssistApi.js` extended with every new endpoint above.

## 4. Clinical safety enhancements (Step 8)

- Duplicate-medicine-in-draft: hard-blocked.
- Allergy conflict, recent-duplicate, dosage/duration completeness: advisory, always shown, never
  silently hidden.
- Certificate/report access: ownership-checked (doctor must have an appointment history with the
  patient) — cannot issue/view for the wrong patient.
- Consultation can no longer be finalized as `COMPLETED` with zero documentation on file.
- Multi-day leave approval now correctly blocks every date, not just day one.

## 5. Realtime enhancements (Step 9)

`prescription:created`, `schedule:updated`, `leave:updated` (+ a real notification to the doctor),
`document:verified` (+ notification), `certificate:created` — all via the existing Socket.IO
server/room manager, no new transport.

## 6. Deferred (backend genuinely lacks support — not faked)

- ICD-10 code suggestions (no ICD model/dataset in the project).
- Document version history (`Doctor.documents` overwrites in place; would need a new sub-schema —
  surfaced honestly as unsupported rather than invented).
- Monthly calendar view and external calendar synchronization (no such integration exists).
- True holiday-rule configuration (only per-date `blockedDates` exists today).
- Referral-note delivery/tracking to another provider (certificates capture the referral text; there's
  no external referral routing system to deliver it through).

## 7. Verification

- `npm run build` (frontend): clean.
- `npx eslint src`: 0 errors, 0 warnings across the full tree.
- `node --check` on every new/modified backend file: clean.
- Full `node --env-file=... server.js` boot: all routes/controllers/models load; only failure is
  `ECONNREFUSED` to MongoDB (no live DB in this sandbox) — flagged, not claimed as a full DB-backed pass.
- All 17 pre-existing plain-assert backend tests (`node tests/run-all.mjs`): passing, unchanged.
- The pre-existing Vitest suite (`api.test.js`) still cannot run in this sandbox
  (`mongodb-memory-server` can't reach `fastdl.mongodb.org`) — flagged as unverified, not claimed passing.
- Caught and fixed three real field-name bugs (`MedicalReport`/`Insurance`/`Payment` all use `userId`,
  not `patientId`) and one real logic bug (schedule optimization's day-of-week type) during this
  verification pass, before they shipped.

## 8. Stop condition

Clinical, Schedule, and Documents are now one connected Clinical Intelligence Workspace, sharing the
same patient-context data, the same certificate/report access layer, and the same AI/safety pipeline.
Per the mission's stop condition, this phase does not touch Reviews, Analytics, Earnings, or Billing.
