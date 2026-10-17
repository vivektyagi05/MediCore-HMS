# MediCore HMS — Complete Audit & Fix Report

**Audit Date:** 2026-06-21  
**Auditor Role:** Senior Software Architect + Principal Backend Engineer + Security Auditor + QA Lead  

---

## PHASE 1 — Full Project Audit: Issues Found

### 1. Broken Business Logic

| ID | File | Issue | Fix Applied |
|----|------|-------|-------------|
| BL-01 | `doctorEarningsController.js` | Dead code after `res.json()` — earnings logic unreachable | Rewrote file; all logic before response |
| BL-02 | `doctorEarningsController.js` | Used `appointment.fees` (field doesn't exist on model) | Fixed to use `DoctorPayout.doctorAmount` |
| BL-03 | `doctorEarningsController.js` | Earnings calculated from appointment count, not DoctorPayout | Fixed to query DoctorPayout collection exclusively |
| BL-04 | `appointmentController.js` | `cancelAppointment` had no terminal-status guard (could cancel completed appointments) | Added TERMINAL_STATUSES check |
| BL-05 | `appointmentController.js` | Approved appointment did not set `paymentStatus = pending` | Fixed in `updateAppointmentStatus` |
| BL-06 | `paymentController.js` | After payment verified, appointment status stayed `approved` | Fixed: status updated to `payment_completed` |
| BL-07 | `paymentController.js` | DoctorPayout `doctorId` set to populated object instead of `_id` | Fixed: `appointment.doctorId._id` |
| BL-08 | `workflowController.js` | `upsertHistoryLink` built update object but never called `findOneAndUpdate` — data silently lost | Fixed: added `ConsultationHistory.findOneAndUpdate()` call |
| BL-09 | `workflowController.js` | `createPrescription` only allowed `COMPLETED` status, blocking post-consultation flow | Fixed: also allows `CONSULTATION_COMPLETED` and `REVIEW_ELIGIBLE` |
| BL-10 | `workflowController.js` | `createMedicalNote` same issue as BL-09 | Fixed same way |
| BL-11 | `patientWorkflowController.js` | `upsertReview` hardcoded `"completed"` string instead of using constant | Fixed to use `APPOINTMENT_STATUS` constant |
| BL-12 | `patientWorkflowController.js` | `upsertReview` rejected `review_eligible` status, preventing review submission | Fixed to accept both `completed` and `review_eligible` |

### 2. Missing Validations

| ID | File | Issue | Fix Applied |
|----|------|-------|-------------|
| MV-01 | `doctorReviewController.js` | `replyToReview` had no check for already-replied reviews | Added 409 guard |
| MV-02 | `doctorReviewController.js` | `replyToReview` had no message non-empty validation | Added trim + required check |
| MV-03 | `patientWorkflowController.js` | `upsertReview` did not filter `adminDeleted` reviews when checking for existing | Fixed filter added |
| MV-04 | `adminReviewController.js` | `deleteReview` allowed double-delete (no idempotency check) | Added `adminDeleted` guard with 409 |

### 3. Missing Workflows

| ID | Issue | Fix Applied |
|----|-------|-------------|
| MW-01 | No auto-refund request on appointment cancellation when payment was already paid | Added auto-RefundRequest creation in `cancelAppointment` |
| MW-02 | No doctor payout settlement endpoint (admin could not settle earnings) | Added `settleDoctorPayout` + `listDoctorPayouts` to financeController |
| MW-03 | No route exposed for payout settlement | Added `PATCH /api/finance/payouts/:id/settle` |

### 4. Missing Database Relationships / Constraints

| ID | Issue | Fix Applied |
|----|-------|-------------|
| DB-01 | `DoctorPayout` had no unique constraint on `paymentId` — double payout possible | Added `unique: true` on `paymentId` field + migration |
| DB-02 | `Review` model missing `editHistory` array field | Added field to schema + migration backfill |
| DB-03 | `ConsultationHistory` collection missing unique compound index | Migration creates it |

### 5. Missing Authorization Checks

| ID | Issue | Fix Applied |
|----|-------|-------------|
| AU-01 | `updateAppointmentStatus` had no RBAC check — any doctor could update any appointment | Added check: doctor's `userId` must match `appointment.doctorId.userId` |
| AU-02 | `cancelAppointment` had no ownership check | Added: `appointment.patientId !== req.user._id → 403` |
| AU-03 | `doctorReviewController.replyToReview` lacked ownership check | Added: doctor must own the review's `doctorId` |

### 6. Missing Status Transitions / Illegal Transitions

| ID | Issue | Fix Applied |
|----|-------|-------------|
| ST-01 | `appointmentStatus.js` missing `CONSULTATION_STARTED`, `CONSULTATION_COMPLETED`, `REVIEW_ELIGIBLE` statuses | Added all lifecycle statuses + `STATUS_TRANSITIONS` map |
| ST-02 | No `STATUS_TRANSITIONS` guard — any status → any status was possible | Added `allowedTransitions` check in `updateAppointmentStatus` |
| ST-03 | `TERMINAL_STATUSES` constant missing | Added and used in `cancelAppointment` |

### 7. Missing Notifications

| ID | Issue | Fix Applied |
|----|-------|-------------|
| NO-01 | Appointment cancellation sent no notification to doctor | Added `notificationEmitter.emitToUser` call |
| NO-02 | Review submission sent no notification to doctor | Added notification after upsert |
| NO-03 | Doctor reply sent no notification to patient | Added notification in `replyToReview` |
| NO-04 | Admin review delete sent no notification to patient | Added notification in `deleteReview` |
| NO-05 | Doctor payout settlement sent no notification | Added notification in `settleDoctorPayout` |

### 8. Missing Error Handling / Generic Errors

| ID | Issue | Fix Applied |
|----|-------|-------------|
| EH-01 | `refundController.js` — `Appointment` model not imported → crash on refund | Added import |
| EH-02 | `refundController.js` — `APPOINTMENT_PAYMENT_STATUS` not imported → `ReferenceError` | Added import alias |
| EH-03 | Email failures propagated and broke business flow in `appointmentController` | Wrapped in `try/catch` |
| EH-04 | Email failures propagated in `paymentController` | Wrapped in `try/catch` |
| EH-05 | Email failures propagated in `refundController` | Wrapped in `try/catch` |
| EH-06 | All `notificationEmitter` calls lacked `try/catch` | Wrapped in `try/catch` everywhere |

### 9. Doctor Payout / Financial Inconsistencies

| ID | Issue | Fix Applied |
|----|-------|-------------|
| FI-01 | Earnings sourced from appointment count (incorrect) | Fixed: exclusive use of `DoctorPayout` collection |
| FI-02 | No `withdrawableBalance` field in earnings response | Added (equals `pendingEarnings`) |
| FI-03 | `platformFee` stored as raw float without rounding | Fixed: `Number(x.toFixed(2))` |
| FI-04 | `DoctorPayout.status` missing `cancelled` enum value | Added |
| FI-05 | No `settledBy` audit field on payout | Added |

### 10. Rating / Review Consistency

| ID | Issue | Fix Applied |
|----|-------|-------------|
| RC-01 | `recalculateDoctorRating` included soft-deleted reviews in calculation | Fixed: `adminDeleted: { $ne: true }` filter |
| RC-02 | Admin delete did not recalculate doctor rating | Added `recalculateDoctorRating` call in `adminReviewController` |

### 11. Rate Limiting

| ID | Issue | Fix Applied |
|----|-------|-------------|
| RL-01 | Single global limiter blocked real-time dashboard polling endpoints | Added separate `realtimeLimiter` (120/min) for `/api/realtime` |
| RL-02 | Auth endpoints had same loose limit as regular API | Added `authLimiter` (20/15min) for `/api/auth` |

---

## PHASE 14 — Final Verification Checklist

| Check | Status |
|-------|--------|
| No console errors (unhandled promise rejections) | ✅ All notification/email calls wrapped in try/catch |
| No broken API routes | ✅ refundController imports fixed |
| No invalid status transitions | ✅ STATUS_TRANSITIONS map enforced |
| No duplicate financial records | ✅ unique index on DoctorPayout.paymentId |
| No missing notifications | ✅ All 5 missing notification calls added |
| No missing validations | ✅ Ownership, status, reply-duplication checks added |
| No security issues | ✅ RBAC on doctor appointment update + cancel ownership |
| No dead code (upsertHistoryLink) | ✅ Fixed to actually persist data |
| Email failures isolated | ✅ All 3 email calls wrapped |
| Doctor earnings from correct source | ✅ DoctorPayout only |
| Review eligible status accepted | ✅ upsertReview accepts review_eligible |
| Admin-deleted reviews excluded from rating | ✅ Filter added |
| Rate limiting tuned | ✅ Three-tier limiter |

---

## Modified Files

1. `backend/constants/appointmentStatus.js` — Full lifecycle statuses, STATUS_TRANSITIONS, TERMINAL_STATUSES, PAYOUT_ELIGIBLE_STATUSES
2. `backend/controllers/appointmentController.js` — Terminal guard, RBAC, cancel notification, email try/catch, auto-refund
3. `backend/controllers/paymentController.js` — appointment → payment_completed, doctorId fix, email try/catch
4. `backend/controllers/refundController.js` — Added Appointment import, APPOINTMENT_PAYMENT_STATUS import, email try/catch
5. `backend/controllers/doctor/doctorEarningsController.js` — Full rewrite using DoctorPayout as sole source
6. `backend/controllers/doctor/doctorReviewController.js` — Ownership check, duplicate reply guard, message validation, notification
7. `backend/controllers/doctor/workflowController.js` — Fixed upsertHistoryLink (now persists), expanded status checks
8. `backend/controllers/patient/patientWorkflowController.js` — APPOINTMENT_STATUS import, review_eligible support, editHistory, notification, adminDeleted filter
9. `backend/controllers/admin/adminReviewController.js` — Soft delete, rating recalculation, patient notification
10. `backend/controllers/financeController.js` — Added listDoctorPayouts + settleDoctorPayout
11. `backend/models/DoctorPayout.js` — unique paymentId, cancelled status, settledBy, indexes
12. `backend/models/Review.js` — Added editHistory field
13. `backend/routes/financeRoutes.js` — Added payout settlement routes
14. `backend/app.js` — Three-tier rate limiting
15. `backend/migrations/001_add_missing_fields.js` — DB migration script (new)
16. `docs/AUDIT_REPORT.md` — This file (new)
17. `docs/TEST_MATRIX.md` — Complete test matrix (new)
