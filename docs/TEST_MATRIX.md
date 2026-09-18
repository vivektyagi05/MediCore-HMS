# MediCore HMS — Complete Test Matrix

## 1. Patient Flow

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| P-01 | Create appointment with valid doctor/slot | 201, appointment.status = pending | ✅ FIXED |
| P-02 | Create appointment for a past date | 400 — Past appointments are not allowed | ✅ FIXED |
| P-03 | Create duplicate appointment (same doctor/date/slot) | 409 — Doctor already booked | ✅ FIXED |
| P-04 | Create appointment when doctor on approved leave | 409 — Doctor is on approved leave | ✅ FIXED |
| P-05 | Cancel a pending appointment | 200, status = cancelled, refund request auto-created if paid | ✅ FIXED |
| P-06 | Cancel an already-cancelled appointment | 409 — Appointment is already cancelled | ✅ FIXED |
| P-07 | Cancel a completed appointment | 400 — Cannot cancel, current status is "completed" | ✅ FIXED |
| P-08 | Submit review for completed appointment | 200, review saved, doctor rating recalculated | ✅ FIXED |
| P-09 | Submit review for review_eligible appointment | 200, review accepted | ✅ FIXED |
| P-10 | Submit review for pending appointment | 400 — Only completed appointments can be reviewed | ✅ FIXED |
| P-11 | Update an existing review | 200, isEdited = true, editHistory appended | ✅ FIXED |
| P-12 | Submit review for another patient's appointment | 404 — Appointment not found for this patient | ✅ FIXED |
| P-13 | Submit review with rating outside 1–5 | 400 — Rating must be between 1 and 5 | ✅ FIXED |
| P-14 | Get appointment list — patient sees only own | 200, filtered by patientId | ✅ |
| P-15 | Cancel appointment of another patient | 403 — You can only cancel your own appointment | ✅ FIXED |

## 2. Doctor Flow

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| D-01 | Approve a pending appointment | 200, status = approved, payment_pending | ✅ FIXED |
| D-02 | Approve an already-approved appointment | 400 — Cannot transition from approved to approved | ✅ FIXED |
| D-03 | Move appointment: approved → cancelled | 200, status = cancelled | ✅ FIXED |
| D-04 | Move appointment: cancelled → approved | 400 — Illegal transition | ✅ FIXED |
| D-05 | Move appointment: pending → completed | 400 — Illegal transition | ✅ FIXED |
| D-06 | Start consultation (payment_completed → consultation_started) | 200, status updated | ✅ FIXED |
| D-07 | Complete consultation without payment | 400 — Payment must be completed | ✅ FIXED |
| D-08 | Create prescription after consultation_completed | 201, prescription saved | ✅ FIXED |
| D-09 | Create prescription after completed status | 201, allowed | ✅ FIXED |
| D-10 | Create prescription for pending appointment | 400 — Prescription requires completed consultation | ✅ FIXED |
| D-11 | Create duplicate prescription | 409 — Prescription already exists | ✅ FIXED |
| D-12 | Create medical note after consultation | 201 | ✅ FIXED |
| D-13 | upsertHistoryLink persists to DB | ConsultationHistory document created/updated | ✅ FIXED |
| D-14 | Reply to a patient review | 200, doctorReply saved, patient notified | ✅ FIXED |
| D-15 | Reply twice to the same review | 409 — Already replied | ✅ FIXED |
| D-16 | Reply to another doctor's review | 403 — Only your own profile | ✅ FIXED |
| D-17 | Get earnings — uses DoctorPayout as source | 200, totalEarnings/pendingEarnings/settledEarnings | ✅ FIXED |
| D-18 | Update appointment status for another doctor's patient | 403 — Can only update own appointments | ✅ FIXED |

## 3. Admin Flow

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| A-01 | Delete a review | 200, adminDeleted = true, doctor rating recalculated | ✅ FIXED |
| A-02 | Delete an already-deleted review | 409 — Review has already been deleted | ✅ FIXED |
| A-03 | List all reviews (includes deletedAt filter) | 200, adminDeleted=true excluded | ✅ FIXED |
| A-04 | Settle a pending doctor payout | 200, status = paid, doctor notified | ✅ FIXED |
| A-05 | Settle an already-settled payout | 409 — Payout has already been settled | ✅ FIXED |
| A-06 | Settle a cancelled payout | 400 — Payout is cancelled | ✅ FIXED |
| A-07 | List doctor payouts filtered by status | 200, pagination correct | ✅ FIXED |

## 4. Payment Flow

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| PY-01 | Create Razorpay order for approved appointment | 201, razorpay order returned | ✅ |
| PY-02 | Create order for non-approved appointment | 400 — Appointment must be approved | ✅ |
| PY-03 | Create order for cancelled appointment | 400 — Appointment is cancelled | ✅ |
| PY-04 | Verify payment with valid signature | 200, appointment → payment_completed, DoctorPayout created | ✅ FIXED |
| PY-05 | Verify payment with invalid signature | 400 — Invalid payment signature | ✅ |
| PY-06 | Verify already-paid appointment | 409 — Payment already processed | ✅ |
| PY-07 | DoctorPayout created with correct doctorId (_id not populated) | doctorId = ObjectId | ✅ FIXED |
| PY-08 | Verify payment twice (idempotency) | 409 on second call | ✅ |
| PY-09 | DoctorPayout: unique constraint prevents double payout | MongoDB E11000 on duplicate | ✅ FIXED |
| PY-10 | Email failure on payment receipt | 200 still returned, error logged only | ✅ FIXED |

## 5. Refund Flow

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| RF-01 | Request refund for paid appointment | 200, RefundRequest created | ✅ FIXED (Appointment import fixed) |
| RF-02 | Request refund for unpaid appointment | 400 | ✅ |
| RF-03 | Duplicate refund request | 409 | ✅ |
| RF-04 | Process refund — Razorpay refund created | 200, paymentStatus = refunded | ✅ |
| RF-05 | Auto-refund request on appointment cancel | RefundRequest auto-created | ✅ FIXED |
| RF-06 | Email failure on refund confirmation | 200 still returned | ✅ FIXED |

## 6. Review Flow

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| RV-01 | Submit review on completed appointment | 200 | ✅ FIXED |
| RV-02 | Submit review on review_eligible appointment | 200 | ✅ FIXED |
| RV-03 | Deleted reviews excluded from rating calculation | Doctor rating does not include adminDeleted reviews | ✅ FIXED |
| RV-04 | Edit review — editHistory populated | editHistory array appended | ✅ FIXED |
| RV-05 | Doctor reply sends notification | notificationEmitter called | ✅ FIXED |
| RV-06 | Admin delete sends patient notification | notificationEmitter called | ✅ FIXED |

## 7. Notification Flow

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| N-01 | Appointment cancelled — doctor notified | Notification emitted | ✅ FIXED |
| N-02 | Review submitted — doctor notified | Notification emitted | ✅ FIXED |
| N-03 | Doctor replies — patient notified | Notification emitted | ✅ FIXED |
| N-04 | Admin deletes review — patient notified | Notification emitted | ✅ FIXED |
| N-05 | Payout settled — doctor notified | Notification emitted | ✅ FIXED |
| N-06 | Notification failure — API still succeeds | try/catch wraps all emit calls | ✅ FIXED |

## 8. Security

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| S-01 | Patient accesses doctor-only endpoint | 403 | ✅ |
| S-02 | Doctor updates another doctor's appointment | 403 | ✅ FIXED |
| S-03 | Patient cancels another patient's appointment | 403 | ✅ FIXED |
| S-04 | Patient reviews another patient's appointment | 404 (ownership filter) | ✅ FIXED |
| S-05 | Admin deletes already-deleted review | 409 (not silent) | ✅ FIXED |
| S-06 | IDOR: patient fetches another patient's payment | 403 via ownership filter | ✅ |
| S-07 | JWT-less request to protected endpoint | 401 | ✅ |
| S-08 | Auth endpoints rate limited (20 req/15min) | 429 after threshold | ✅ FIXED |
| S-09 | Realtime endpoints not blocked during dashboard use | 120 req/min allowed | ✅ FIXED |

## 9. Rate Limiting

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| RL-01 | > 2500 req/15min on general API | 429 | ✅ |
| RL-02 | > 20 req/15min on /api/auth | 429 | ✅ FIXED |
| RL-03 | 60 req/min on /api/realtime (normal dashboard) | 200 — not blocked | ✅ FIXED |
| RL-04 | > 120 req/min on /api/realtime | 429 | ✅ FIXED |
