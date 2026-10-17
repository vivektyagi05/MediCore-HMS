# CHANGELOG — Phase 03 Financial Operations Hub (partial)
See `docs/PHASE-03-REFUND-LEDGER-OUTBOX.md` for status, evidence and the explicit NOT_FIXED list.

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
