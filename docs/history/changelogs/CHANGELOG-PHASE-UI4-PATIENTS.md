# PHASE UI-4 — Patients Management Workspace

## 1. Implemented

- **Patient Registry rebuild** (`AdminPatients.jsx`): server-side search (name/email/exact ID), status, gender, and four DB-level advanced filters (upcoming appointment, insurance on file, outstanding balance, linked family), with pagination and a "showing X of Y" line (same convention as the Appointment Operations Workspace — no bespoke pager invented).
- **Real KPI strip**: Total Patients, Active Patients, New This Month, Patients With Upcoming Appointment, Patients Needing Attention, Patients With Missing Critical Info, and (permission-gated) Outstanding Balance Total — every number is a genuine count/sum from `/api/admin/patients/stats`. No invented percentages or trends.
- **Patient 360 Workspace** (`PatientWorkspace.jsx`, mounted in the existing `AdminModal`): Overview / Health / Appointments / Records / Prescriptions / Payments / Insurance / Family / Timeline tabs, following the established `DoctorDetailWorkspace.jsx` tab pattern.
- **Attention Intelligence**: a deterministic, sourced, severity-tagged attention list (allergy on file, unreviewed critical/urgent report, failed payment, outstanding balance, expiring/expired insurance, high pain level at last visit, overdue follow-up, missing prescription after a completed consultation, incomplete profile, upcoming appointment). Every item states what happened, why it matters, its data source, and (where applicable) a suggested operational next action. Nothing is AI-generated or invented.
- **Real patient timeline**: built only from actual stored timestamps (appointment `createdAt`/`paidAt`, report `createdAt`/`reviewedAt`, prescription `createdAt`, insurance `claimHistory` entries) — no fabricated events, no invented intermediate transition timestamps (documented limitation, same as the Appointment Operations Workspace).
- **AI Operational Summary**: new `patientOperationalSummary` capability through the existing pipeline (promptLibrary → templateProvider → generativeAssistant → controller → route → `AIDraftPanel`), returning explicit `facts[]` and `recommendations[]` arrays built only from the same real aggregate the workspace displays. Never a diagnosis, never an invented medication/appointment/payment/date.
- **Downloads**: admin-authorized report and prescription PDF downloads, reusing the exact `downloadFile()` core the patient's own ownership-scoped download uses.
- **Quick actions**: Open Workspace, View Appointments (deep-links into the existing Appointment Operations Workspace via its already-supported `?patientId=` filter — no second appointment UI built), Edit, Activate/Deactivate, Delete — every button performs a real, working action. No "Coming Soon" placeholders.
- **Destructive-action confirmation**: `ConfirmDialog` now wired into AdminPatients for deactivate/activate and delete, replacing the old bare `window.confirm("Delete patient?")`.

## 2. Existing functionality reused (not duplicated)

- Edit / Delete / Activate-Deactivate stay on the existing `PUT /DELETE /PATCH /api/admin/users/:id` endpoints (`userAdminController.js`) — only the admin-only read surface (registry, stats, workspace) and the two genuinely-missing download actions were added.
- Appointment lifecycle, cancellation, and refunds are untouched; "View Appointments" reuses `AdminAppointments.jsx`'s existing patient filter rather than a new page.
- `downloadFile()` extracted once from `patientWorkflowController.js` into `utils/fileDownload.js` and reused by the new admin download endpoints — same byte-serving logic, zero behavior change for the existing patient-side download.
- AI pipeline (promptLibrary/templateProvider/generativeAssistant) reused exactly as-is; only one new prompt key added.
- `AdminTable` / `FilterBar` / `MetricCard` / `StatusBadge` / `SectionHeader` / `Tabs` / `ConfirmDialog` / `ErrorState` / `AdminModal` / `AIDraftPanel` — all reused unmodified from the existing design system, following the Appointment Operations Workspace as the direct template.
- `dashboardSyncTick` (existing `RealtimeContext`) reused for registry/stats refresh — no new Socket.IO channel, no polling added.

## 3. Bugs fixed

- **Patient hard-delete had zero referential-integrity safety.** Unlike Service (audited in a prior phase as having zero FK references anywhere), a patient `User` document is referenced by `Appointment.patientId` everywhere — clinical history, payments, reports, and prescriptions all hang off that appointment trail. The old "Delete" button called a blind `deleteUser()` with only a `window.confirm("Delete patient?")` guard. Deleting a patient with real appointment history would have silently orphaned every appointment, payment, report, and prescription tied to them. Added `assertPatientDeletable()` — a pure, unit-tested guard (same style as the existing `assertDoctorDeletable()`) that blocks hard delete when the patient has any appointment on record, with a clear message pointing to deactivation instead.

## 4. New backend APIs/services

- `GET /api/admin/patients` — registry list (search/filter/sort/paginate).
- `GET /api/admin/patients/stats` — KPI strip.
- `GET /api/admin/patients/:id` — Patient 360 workspace aggregate.
- `GET /api/admin/patients/reports/:reportId/download` — admin report download.
- `GET /api/admin/patients/prescriptions/:prescriptionId/download` — admin prescription download.
- `GET /api/ai/assist/admin/patients/:patientId/operational-summary` — AI operational summary.
- `backend/services/patientAdminAggregationService.js` — shared aggregation core (`buildPatientAggregates`, `computeAttentionItems`, `computePatientRiskLevel`, `calculateAge`), a genuinely different query shape from `doctorController.getDoctorPatients` (platform-wide across all doctors vs. one doctor's own appointment-embedded refs), not a duplicate of it.
- `backend/utils/fileDownload.js` — extracted shared download helper.

## 5. New frontend functionality

- `src/pages/admin/AdminPatients.jsx` — full rewrite (Registry).
- `src/components/admin/PatientWorkspace.jsx` — new Patient 360 Workspace component.
- `adminApi.js` / `aiAssistApi.js` — new method wrappers for all endpoints above.

## 6. Security/permissions

- Financial data (outstanding balance, payment list) is stripped **server-side** for any admin without `manage_payments` — not just hidden client-side — identical rule to the Appointment Operations Workspace. No new permission keys invented (none exist for patient records/insurance specifically in the current `Permission` model, so clinical/insurance detail follows the same admin-role-only precedent as the existing Appointment Detail Workspace).
- Report/prescription downloads are admin-role-gated (via `requireAdmin`) but have no ownership check, by design — any admin may view any patient's file, matching the existing doctor-document-download precedent.

## 7. Error handling

- Registry, stats, and workspace loads each have distinct loading/empty/error states using the existing `Loader` / `ErrorState` / `AdminTable` empty-state primitives — real backend error messages via `getApiErrorMessage`, never raw Axios/Mongo dumps.
- Deactivate, delete, edit-save, and downloads use toast success/failure messages ("Patient profile updated successfully.", "Report could not be loaded.", etc.) rather than silent failure or generic messages, and the delete guard's 409 message surfaces verbatim in the confirm dialog rather than a raw error.

## 8. Tests performed

- `backend/tests/patientAdminDeleteGuard.test.mjs` (new, 4 assertions) — regression-locks the delete-guard fix.
- `backend/tests/patientAdminAttentionRules.test.mjs` (new, 10 assertions) — locks in the deterministic risk/attention/age rules, including that nothing is ever fabricated (e.g. no allergy item fires when none is on file).
- Full existing suite: **33/33 backend tests passing** (31 pre-existing + 2 new).
- `node --check` clean on every new/edited backend file.
- Clean server boot (ECONNREFUSED-only — no live MongoDB in this sandbox, same as every prior phase).
- `npx eslint .` — 0 errors/0 warnings across the whole frontend repo.
- Clean `npm run build` — `AdminPatients` chunk confirmed present in the output.
- Custom nested-interactive-element scan on both new/rewritten frontend files — 0 violations.
- Route/API duplication check — single `/api/admin/patients` mount, correct `/stats` route ordering before `/:id`.
- Hardcoded-localhost scan — clean (only a pre-existing unrelated comment matched).

## 9. Verified limitations

- **Live browser / live-MongoDB end-to-end runs were NOT performed** — this sandbox has neither a browser nor a reachable MongoDB instance. Everything above was statically verified (syntax, lint, build) and test-verified (unit tests against pure/dependency-injected functions); nothing here is claimed as "fully tested" in the live sense.
- The "needs attention" **quick filter** on the registry list covers the subset of attention rules expressible as a direct database query (failed payment, unreviewed critical/urgent report, expiring/expired insurance, open outstanding balance) — documented in code. The **complete** rule set (also including overdue follow-up, missing post-consultation prescription, high pain level, incomplete profile) is computed and shown per-patient inside the Patient 360 Workspace, which can afford the full cross-collection join for one patient at a time.

## 10. Explicitly deferred work (not fabricated)

- **Insurance document download** — no secure download endpoint exists anywhere in this backend for insurance documents, not even for the patient's own upload. The workspace shows the on-file document's filename as read-only metadata with an explicit note, rather than a decorative download button.
- **Admin-initiated appointment booking/reschedule** for a patient — no such admin workflow exists anywhere in this backend. "View Appointments" deep-links into the existing Appointment Operations Workspace instead of a fabricated booking flow.
- **Phone-number search** — the `User`/`patientProfile` schema has no direct patient phone field (only `emergencyContact.phone`), so search covers name/email/exact ID only rather than claiming a field that doesn't exist.
- **Distinct reviewer/approver permission keys for patient financial/clinical data** — the `Permission` model only has generic keys; per the mission's "do not invent new roles," financial gating reuses the existing `manage_payments` key and clinical/insurance detail follows the same admin-role-only precedent already established by the Appointment Detail Workspace.
