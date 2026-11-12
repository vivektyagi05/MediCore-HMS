> **Historical record.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# CHANGELOG — Phase 03 Financial Operations Hub (partial)
See `docs/history/phase-reports/PHASE-03-REFUND-LEDGER-OUTBOX.md` for status, evidence and the explicit NOT_FIXED list.

## Backend
- `payments/refundLock.js` (new): leased, token-fenced refund lock; `controllers/refundController.js` rewired; `models/Payment.js` + `refundLockToken`.
- `controllers/refundController.js`: refund receipt enqueued before terminal save; out-of-band replay re-enqueues idempotently.
- `models/EmailDelivery.js` + `claimToken`, `lastErrorAt`, `requeuedAt`, `requeueCount`; `services/emailOutboxService.js`: fenced claims/outcomes, `decideFailureOutcome`, `getOutboxHealth`, `requeueFailedEmail`.
- `services/finance/walletReconciliationService.js`: read-only paginated discrepancy report (6 classes) + pure classifiers.
- `payments/couponRules.js` (new), `payments/couponService.js` (redeem/release lifecycle), `models/Coupon.js` (state + counters), `controllers/financeController.js` (validated, audited coupon admin; usage endpoint).
- `controllers/admin/financeAdminController.js` + `routes/admin/financeAdminRoutes.js`: discrepancies, outbox, requeue. `routes/financeRoutes.js`: coupon usage.

## Frontend
- `FinanceOperations.jsx`: tabs; new `src/pages/finance/ops/{WalletReservationReview,DiscrepancyReport,OutboxMonitor,CouponManager}.jsx`; `api/adminApi.js`, `api/financeApi.js` wrappers.
- `WalletDashboard.jsx`: available / posted / held. `DoctorEarnings.jsx`: refund adjustment on payout rows; stale placeholder removed.

## Tests
- New: refundLockLease, emailOutboxLease, walletLedgerDiscrepancyReport, couponLifecycleRules, phase03RouteGating (+ `tests/mongo/phase03.mongo.test.mjs`, not executed).
- `tests/helpers/memoryModels.mjs`: `$pull` evaluates query conditions.
- Backend 185 → 190, all passing.

## Completion pass (2026-10-17)
### Backend
- `refundController.js`: wallet-only replay marker (`Payment.processedRefundKeys`), correct `refundedBefore` on replay, ledger posted on wallet-credit replay, collision-free receipt key, wallet-only recovery in `reconcileRefundRequest`, durable doctor earning notice.
- `refundEarningAdjustment.js`: replay returns the data needed to re-notify.
- `walletReconciliationService.js`: 11 new classes, certainty states, `certainty`/`paymentId` filters, resolved counts.
- `payments/reconciliationRepair.js` + `POST …/backfill-ledger`: the single audited, idempotent repair.
- `couponService.js`, `unpaidPaymentCleanup.js`: release only `reserved`; leaked-reservation recovery.
- `financialEmails.js`: `rechargeCredited`, `doctorEarningAdjusted`; `walletRechargeService.js` enqueues before the terminal write.
- `services/finance/paymentEvidence.js` → `evidence` on admin payment detail.
- `models/RefundReview.js`, `services/finance/refundReviewService.js`, `controllers/refundReviewController.js`, doctor + admin routes.
- `scripts/audit-coupon-usage.mjs` (`npm run audit:coupon-usage`).
### Frontend (existing pages extended; no new route or sidebar entry)
- `DiscrepancyReport.jsx` rebuilt; `PaymentDetailWorkspace.jsx` + `PaymentEvidencePanel.jsx` (Evidence tab); `AdminRefunds.jsx` + `DoctorRefundReviews.jsx`; `DoctorEarnings.jsx` review-request dialog/status; `adminApi.js`, `doctorApi.js`.
### Tests (+9 files, 190 → 199)
`refundFailureMatrix`, `reconciliationClasses`, `reconciliationRepair`, `outboxDurability`, `couponLifecycleService`, `couponUsageAudit`, `phase03CompletionHttp`, `patientFinanceHttp`, `paymentEvidence`. Two Phase 02 coupon fixtures corrected to real reserved entries.
### Not verified (BLOCKED_EXTERNAL)
Real MongoDB, Razorpay sandbox, browser E2E. See `docs/history/phase-reports/PHASE-03-REFUND-LEDGER-OUTBOX.md` §F.
