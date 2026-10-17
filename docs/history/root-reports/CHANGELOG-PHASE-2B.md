# CHANGELOG — Phase 2-B: Real Doctor Workflow

See docs/PHASE-2B-DOCTOR-REPORT.md for the full audit trail.

## Fixed
1. Doctor approval/rejection sent NO email at all — wired real Brevo
   transactional email (new emails/doctorVerificationEmail.js +
   emailService.sendDoctorApprovalEmail/sendDoctorRejectionEmail).
2. Doctor approval/rejection was not idempotent — double-click no longer
   duplicates verificationHistory entries, notifications, emails, or the
   DOCTOR_VERIFIED automation trigger.
3. Self-registration could set a fabricated doctorProfile.rating via the
   raw API — now whitelisted to specialization/experience/fees/availability.
4. updatePrescription mass-assigned the entire request body (doctorId/
   patientId/appointmentId/status all client-overridable) — now field-
   whitelisted to diagnosis/medicines/notes/followUpDate.
5. No server-side approval gate on doctor routes (Section 8, CRITICAL) —
   new middleware/doctorAccessMiddleware.js (requireApprovedDoctor), wired
   into workflowRoutes.js (except /documents*), commandCenterRoutes.js, and
   the doctor-only routes in doctorRoutes.js. Onboarding/professional-
   profile routes deliberately left open pre-approval.
6. Stale disabled "Withdrawal Coming Soon" button left in DoctorEarnings.jsx
   even though a real DoctorWithdrawalPanel already existed on the same
   page — removed.

## Added
- backend/tests/doctorApprovalWorkflow.test.mjs (12 assertions)
- backend/tests/doctorAccessControl.test.mjs (9 assertions)

## Verification
- 97/97 backend tests passing (95 baseline + 2 new files)
- 0 ESLint errors repo-wide
- Clean frontend build
- Clean boot (ECONNREFUSED-only, no live MongoDB in sandbox)
- Fresh-extract gate passed (reinstall + retest on the final zip)
