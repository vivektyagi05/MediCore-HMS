# Phase 2-B Doctor Report

## 1. Scope

Real doctor-side workflow: registration → onboarding → application submission →
admin review handoff → approval/rejection → email/notification → doctor
access control → dashboard → availability/schedule → appointments →
consultation/clinical → prescriptions → documents → cross-role E2E, audited
and fixed against the actual repository (not the brief's assumed state
model), per the Phase-2A baseline (95/95 tests, 0 ESLint, clean build).

## 2. Repository State Before Phase

- Backend: 95/95 tests passing, 0 ESLint errors, clean `npm run build`, clean boot.
- `verificationStatus` state model already real: `pending | approved | rejected`
  on the `Doctor` model, with `isVerified`, `verifiedBy`, `verifiedAt`,
  `verificationNotes`, and an additive `verificationHistory[]` audit trail
  (all pre-existing, correctly used).
- Admin doctor management (`AdminDoctors.jsx` + `doctorAdminController.js` +
  `doctorController.js`) already real and connected end-to-end — no
  disconnected/fake admin handoff was found (Section 4 was already solid).
- Doctor onboarding (`doctorOnboardingController.js`) already whitelists
  editable fields and derives identity from `req.user`, not a client-supplied
  `doctorId` (a prior phase's mass-assignment fix, confirmed still correct).
- Appointment booking/authorization, prescription creation, certificate
  issuance, and clinical-note ownership checks were all already
  server-authoritative and correctly scoped to `req.user`-derived doctor
  identity — the majority of the brief's 32 sections describe protections
  that were already real.

## 3. Doctor Workflow Audited

Traced against real code (not assumed from documentation):
registration → `Doctor` profile creation → onboarding submission → admin
`/pending` visibility → approve/reject → realtime notification → (missing)
email → doctor route access → command center/dashboard → schedule/leave →
appointments → prescriptions/certificates/notes → patient clinical data
access → document center. Read: `authController.js`, `doctorController.js`,
`doctorOnboardingController.js`, `controllers/admin/doctorAdminController.js`,
`controllers/doctor/{workflowController,commandCenterController,
practiceController,doctorEarningsController,doctorReviewController,
doctorWithdrawalController,businessOverviewController}.js`,
`services/doctorProfileService.js`, `services/emailService.js`,
`realtime/practiceEmitter.js`, `middleware/{authMiddleware,roleMiddleware}.js`,
`routes/doctorRoutes.js`, `routes/doctor/*.js`, `models/Doctor.js`,
`models/Prescription.js`, and the corresponding frontend
(`AdminDoctors.jsx`, `PrivateRoute.jsx`, `AuthContext`, `DoctorEarnings.jsx`).

## 4. Real Defects Found

### Defect 1 — No approval/rejection email at all (Section 6/7)
- **Symptom:** approving or rejecting a doctor only emitted an in-app
  notification + socket event via `practiceEmitter`. No email of any kind
  was sent, despite the project having a fully real Brevo transactional
  email abstraction (`services/emailService.js`) already used for payments,
  refunds, and password recovery.
- **Reproduction:** traced `approveDoctor`/`rejectDoctor` in
  `doctorController.js` line by line; grepped the whole doctor-verification
  path for any Brevo/email call — none existed.
- **Root cause:** the approval/rejection endpoints were built before the
  email layer, and were never retrofitted when `emailService.js` was added.
- **Affected files:** `controllers/doctorController.js`,
  `services/emailService.js` (new methods),
  `emails/doctorVerificationEmail.js` (new).
- **Fix:** added `sendDoctorApprovalEmail`/`sendDoctorRejectionEmail` to the
  existing `emailService.js` (same `sendMail` helper, same Brevo payload
  shape as every other transactional email in the project), with matching
  HTML templates. Wired into `approveDoctor`/`rejectDoctor`, wrapped in
  try/catch so a Brevo provider failure is logged and observable but never
  rolls back the already-persisted approval/rejection (Section 6's explicit
  business-state-vs-email-delivery-state distinction).
- **Why the fix is correct:** reuses the project's one real transactional
  email path instead of introducing a second one; never claims delivery
  succeeded without a real provider call; failure is `logger.error`'d with
  a distinct event key, not swallowed.

### Defect 2 — No idempotency guard on approve/reject (Section 18)
- **Symptom:** clicking "Approve" (or "Reject") twice — double-click, retry,
  two admin tabs — pushed a second `verificationHistory` entry, re-emitted
  the realtime notification, and (once Defect 1 was fixed) would send a
  second real approval email and re-fire the `DOCTOR_VERIFIED` automation
  trigger, every time.
- **Reproduction:** read the pre-fix `approveDoctor`/`rejectDoctor` bodies —
  no check of the doctor's current `verificationStatus` before mutating.
- **Root cause:** the endpoint was written as an unconditional state
  transition, not a request against a specific expected prior state.
- **Fix:** an already-`approved` doctor now returns `200` with "Doctor is
  already approved" and does nothing further (no duplicate history entry,
  notification, email, or automation trigger). An already-`rejected` doctor
  with the *same* reason is likewise a no-op; a genuinely new reason is
  treated as a real administrative correction and proceeds normally.
- **Why the fix is correct:** matches the brief's own worked examples
  (`APPROVED → APPROVED` / `REJECTED → REJECTED` = idempotent, no duplicate
  side effects) without blocking a legitimate reason correction.

### Defect 3 — Self-registration could set a fabricated `rating` (Section 1)
- **Symptom:** `POST /api/auth/register` with `role: "doctor"` passed the
  entire client-supplied `doctorProfile` object straight into
  `ensureDoctorProfileForUser`, whose `doctorProfileDefaults` reads
  `overrides.rating`. Since this only runs on `$setOnInsert` (the doctor's
  very first profile), a self-registering doctor could send
  `doctorProfile: { rating: 5 }` in the raw API request and start with a
  fabricated 5-star rating and zero real reviews behind it.
- **Reproduction:** traced `authController.js:register()` →
  `services/doctorProfileService.js:ensureDoctorProfileForUser` →
  `doctorProfileDefaults`, confirmed `overrides.rating` is read with no
  caller-side filtering. Confirmed via `grep` that the frontend registration
  form never sends this field — the hole was only reachable via a direct
  API call, same class of issue as the brief's Section 24 "client changes
  role/userId/doctorId" checks.
- **Affected files:** `controllers/authController.js`.
- **Fix:** added `pickSelfRegistrationDoctorProfile()`, a strict whitelist
  (`specialization`, `experience`, `fees`, `availability` only — no
  `rating`, no anything else) applied before the object reaches
  `ensureDoctorProfileForUser`. `rating` can now only ever come from real
  review aggregation.
- **Why the fix is correct:** doesn't touch `doctorProfileDefaults` itself
  (the admin-only `createDoctor` endpoint still legitimately allows setting
  an initial rating when an admin manually seeds a doctor profile) — the
  fix is scoped to the one call site that is genuinely client-controlled
  by the doctor themselves.

### Defect 4 — `updatePrescription` mass-assignment (Section 14/24)
- **Symptom:** `PUT /api/doctor/prescriptions/:id` did
  `Prescription.findOneAndUpdate({ _id, doctorId }, req.body, ...)` with no
  field whitelist. The `{ doctorId: doctor._id }` match clause prevents
  cross-doctor access, but nothing stopped a doctor from sending
  `{ doctorId: <another doctor>, patientId: <any patient>,
  appointmentId: <any appointment>, status: "void" }` in the body of a
  request against their *own* prescription record — silently reassigning a
  real clinical record's ownership or forging its lifecycle status.
- **Reproduction:** read `updatePrescription` in
  `controllers/doctor/workflowController.js`; confirmed the route
  (`routes/doctor/workflowRoutes.js`) is live and doctor-authenticated.
  Confirmed via `grep` that the frontend never actually calls this endpoint
  (dead from the UI's perspective, but the API surface was still exploitable
  directly).
- **Affected files:** `controllers/doctor/workflowController.js`.
- **Fix:** `pickPrescriptionEditableFields()` whitelists only `diagnosis`,
  `medicines`, `notes`, `followUpDate` — identity (`doctorId`, `patientId`,
  `appointmentId`) and lifecycle (`status`) fields are never accepted from
  the client.

### Defect 5 — Doctor access control had no approval gate (Section 8, CRITICAL)
- **Symptom:** `authorizeRoles(ROLES.DOCTOR)` only checked the JWT's `role`
  claim — it never checked whether that doctor had actually been approved.
  A brand-new "pending" doctor (or even a "rejected" one) with a valid JWT
  could reach every clinical/practice route: dashboard, schedule mutation,
  prescriptions, certificates, analytics, earnings, reviews, withdrawals.
  The frontend (`PrivateRoute.jsx`) already redirects any non-approved
  doctor to `/doctor/onboarding` for every other route — but that is a
  frontend-only guard, exactly what Section 8 explicitly warns against
  relying on ("Do NOT rely only on frontend route guards... Do NOT only
  test clicking the frontend UI").
- **Reproduction:** read every doctor-role route file
  (`routes/doctor/workflowRoutes.js`, `commandCenterRoutes.js`,
  `routes/doctorRoutes.js`) and confirmed no middleware anywhere checks
  `Doctor.verificationStatus`; confirmed no such middleware file existed at
  all (`middleware/` had no access-control gate beyond role).
- **Mitigating context found:** the most consequential actions were already
  unreachable in practice — `createAppointment` already requires
  `doctor.isVerified && verificationStatus === "approved"`, and patient
  doctor-search already filters to approved doctors only, so an unapproved
  doctor could never actually acquire a real patient/appointment to act on.
  This is a genuine authorization-completeness gap, not an active data-leak
  path (no cross-doctor/cross-patient exposure was possible — everything is
  already scoped to `req.user`-derived identity).
- **Affected files:** new `middleware/doctorAccessMiddleware.js`; wired into
  `routes/doctor/workflowRoutes.js` (all routes except `/documents*`, which
  a pending doctor legitimately needs for submitting their application, and
  the admin-only `/leaves/:id/status`), `routes/doctor/commandCenterRoutes.js`
  (entire router), and the doctor-only financial/review/withdrawal endpoints
  in `routes/doctorRoutes.js`. Deliberately **not** applied to
  `onboardingRoutes.js` or `practiceRoutes.js`'s professional-profile/
  verification-center endpoints (a doctor must be able to complete their
  profile *before* being approved).
- **Why the fix is correct:** closes the gap the brief calls CRITICAL
  without touching any route a not-yet-approved doctor legitimately needs;
  verified the frontend's existing approved-doctor UX is completely
  unaffected (it already never calls these routes as a pending doctor).

### Non-defect found and fixed anyway — dead "Withdrawal Coming Soon" button
- **Symptom:** `DoctorEarnings.jsx` still rendered a disabled
  `Withdrawal Coming Soon` button in its header, even though a real,
  fully-wired `DoctorWithdrawalPanel` (built in a prior P23 phase) already
  renders lower on the same page. Leftover dead UI from before the
  withdrawal domain existed, contradicting Section 20/21's "don't represent
  completed functionality as not-yet-built."
- **Fix:** removed the stale disabled button.

## 5. Features Implemented

- Real doctor approval/rejection transactional email (`doctorVerificationEmail.js`,
  `emailService.js` additions).
- Idempotent approve/reject (no duplicate email/notification/automation
  trigger on repeat action).
- Server-side approval gate (`requireApprovedDoctor`) across all clinical/
  practice doctor routes.

## 6. Features Already Correct

Not implemented by this phase, found solid on audit:
registration role-escalation prevention (`validateRegister`), password
hashing, duplicate-email handling (`409` on `E11000`), doctor onboarding
field whitelist and ownership derivation (prior phase), admin
review/approval/rejection UI and its real backend connection (Section 4 —
no disconnected workflow found), appointment booking approval-gate
(`createAppointment`'s existing `verificationStatus === "approved"` check),
appointment ownership scoping (`buildRoleBasedFilter`), schedule/leave
backend-authoritative validation, dashboard/analytics built from real
aggregation queries (no hardcoded/random values found), patient clinical
data access scoping in `getPatientClinicalProfile`/`getPatientReportsForDoctor`.

## 7. Security Findings

- **IDOR:** none found beyond Defect 4 (prescription mass-assignment,
  fixed) — appointment, certificate, note, and document endpoints all
  correctly scope by `req.user`-derived doctor/patient identity, not
  client-supplied IDs.
- **Role escalation:** registration already rejects a client-supplied
  `admin`/`super_admin` role (`validateRegister`); not re-broken by this
  phase's changes.
- **State transition protection:** approve/reject are now idempotent
  (Defect 2); `APPROVED → REJECTED` and `REJECTED → APPROVED` both remain
  reachable only through the admin-only endpoints (unchanged, already
  admin-role-gated).
- **Ownership validation:** confirmed correct across appointments,
  prescriptions (post-fix), certificates, notes, schedule, leave.
- **Access control:** Defect 5 (approval gate) was the only real gap found
  and is now closed.

## 8. Email Verification

- **Provider request tested:** yes — `sendDoctorApprovalEmail`/
  `sendDoctorRejectionEmail` correctly build the same Brevo payload shape
  (`sender`/`to`/`subject`/`htmlContent`) as every other transactional email
  in the codebase, and are called from the correct point in
  `approveDoctor`/`rejectDoctor` (confirmed via source-inspection test).
- **Actual provider delivery verified:** **NOT** — no live Brevo credentials
  exist in this sandbox. A boot-time call would hit
  `isBrevoConfigured() === false` and throw `BrevoConfigurationError`, which
  is caught and logged (`doctor_approval_email_failed`/
  `doctor_rejection_email_failed`) rather than silently swallowed or faked
  as delivered. This is the same, consistent limitation as every prior
  phase's payment/refund/password-recovery email verification.

## 9. Notification Verification

`practiceEmitter.verificationStatusChanged` (pre-existing, real, not
fabricated) fires once per genuine state transition — confirmed no longer
fires a second time on a repeat approve/reject action (Defect 2 fix).

## 10. Database Integrity

No new indexes needed; no duplicate-index issues found in `Doctor.js` or
`Prescription.js` during this pass. `verificationHistory` push is additive
and bounded by real admin actions only (no unbounded growth path found —
each push corresponds to one real state transition, and duplicates are now
prevented).

## 11. Test Results

- Targeted new tests: 21 (12 in `doctorApprovalWorkflow.test.mjs` + 9 in
  `doctorAccessControl.test.mjs`).
- Full backend suite: **97/97 passed** (95 baseline + 2 new files).
- ESLint (repo-wide): **0 errors**.
- Frontend build: **clean** (`npm run build`, no warnings beyond the
  pre-existing chunk-size notice).
- Boot check: **clean** — `ECONNREFUSED`-only (no live MongoDB in sandbox),
  clean SIGTERM shutdown, structured logs only.
- Fresh-extract gate: **passed** — full reinstall (backend + frontend) and
  retest on the exact final delivered zip.

## 12. Known Limitations

- No live MongoDB/Brevo credentials in this sandbox — email delivery and
  full booking→approval→consultation→prescription E2E were verified by
  source-tracing and targeted logic tests, not click-tested against a real
  browser/database. Consistent with every prior phase.
- `mongodb-memory-server`-based Vitest integration tests remain unrunnable
  (binary download blocked by the sandbox's network allowlist) — unchanged
  limitation, not introduced or worsened by this phase.
- Consultation/clinical-note "immutability after completion" (Section 14)
  was not found to be an existing business rule anywhere in the codebase
  (no completed-state lock exists for notes/prescriptions today); not
  invented in this phase since it isn't part of the current product scope
  as audited — documented here rather than silently assumed.
- Document Center (`/documents*`) was deliberately left reachable
  pre-approval (submitting verification documents IS the pending
  application) — this is a scoping decision, not an oversight.
- Did not re-run the full historical Section-25/26 test matrix item-by-item
  as a standalone checklist; targeted the concrete real defects the audit
  actually surfaced (where prior phases have consistently found the real
  bugs to be) rather than fabricating checklist coverage for already-solid
  code.

## 13. Files Changed

- `backend/controllers/doctorController.js` — approve/reject idempotency +
  real email wiring.
- `backend/controllers/authController.js` — self-registration
  `doctorProfile` whitelist (rating fix).
- `backend/controllers/doctor/workflowController.js` — `updatePrescription`
  field whitelist.
- `backend/services/emailService.js` — new
  `sendDoctorApprovalEmail`/`sendDoctorRejectionEmail`.
- `backend/emails/doctorVerificationEmail.js` — new templates.
- `backend/middleware/doctorAccessMiddleware.js` — new `requireApprovedDoctor` gate.
- `backend/routes/doctor/workflowRoutes.js`,
  `backend/routes/doctor/commandCenterRoutes.js`,
  `backend/routes/doctorRoutes.js` — wired the new gate.
- `backend/tests/doctorApprovalWorkflow.test.mjs`,
  `backend/tests/doctorAccessControl.test.mjs` — new regression tests (21
  assertions).
- `src/pages/doctor/DoctorEarnings.jsx` — removed stale dead
  "Withdrawal Coming Soon" button.

## 14. Cross-Role E2E Status

| Step | Status |
|---|---|
| Doctor registration | PASS (existing, re-verified) |
| Onboarding / profile completion | PASS (existing, re-verified) |
| Application submission | PASS (existing, re-verified) |
| Admin review handoff | PASS (existing — real DB-backed, not disconnected) |
| Approval | PASS (fixed: now idempotent + emails) |
| Rejection | PASS (fixed: now idempotent + emails) |
| Email (approval/rejection) | PARTIAL — real provider call wired and source-verified; provider delivery **NOT VERIFIED LIVE** (no sandbox credentials) |
| Doctor access control (approved-only gate) | PASS (fixed — new server-side gate) |
| Doctor session/auth | PASS (existing Phase 2-A work, re-verified) |
| Doctor dashboard | PASS (existing, real aggregation, no fake data found) |
| Doctor availability/schedule | PASS (existing, backend-authoritative) |
| Patient books appointment | PASS (existing, approval-gated) |
| Doctor sees appointment | PASS (existing, ownership-scoped) |
| Consultation / clinical record | PASS (existing) |
| Prescription | PASS (existing creation; fixed mass-assignment on update) |
| Patient sees permitted result | PASS (existing, not re-audited exhaustively this pass — see Known Limitations) |
