# PHASE 03 — Financial Operations Hub (partial delivery, honest status)

Baseline: `MediCore-HMS-PHASE-02-FINAL-CLOSURE-2026-10-16.zip` — verified here: backend **185/185** (exit 0), ESLint exit 0, Vite build exit 0.
Final: backend **190/190** (exit 0), ESLint exit 0, Vite build exit 0. `npm run test:mongo` **not run** (no mongod, no provider sandbox, no browser).

**This is NOT the full Phase 03 scope.** It is the part that was implemented, tested and verified in this session. Everything else is listed under *NOT_FIXED / not started* so nothing is implied.

## Status vocabulary
IMPLEMENTED · LOCALLY_VERIFIED · INTEGRATION_VERIFIED · PRODUCTION_VERIFIED · BLOCKED_EXTERNAL · NOT_FIXED

## Real defects found by reading the code, and fixed

| # | Defect (evidence) | Fix | Status |
|---|---|---|---|
| P3-01 | `Payment.refundLockedAt` never expired. A crash between acquire and release left the payment un-refundable forever (every approve/retry/webhook/reconcile got 409). | `backend/payments/refundLock.js`: lease (5 min) + fencing token (`refundLockToken`); release only by the acquiring token; all 4 call sites in `refundController.js` rewired. Taking over a stale lease never re-issues a refund — ambiguous gateway outcomes still go through `reconcileRefundRequest`. | LOCALLY_VERIFIED (pure lease filter); real conditional-update semantics BLOCKED_EXTERNAL |
| P3-02 | Refund receipt was enqueued *after* the request was marked `processed`; a crash in between lost the receipt (replay short-circuits). Out-of-band replay also skipped it. | Enqueue moved *before* the terminal save (outbox row is deduped by `eventKey`); OOB `skip_duplicate` path re-enqueues idempotently. | IMPLEMENTED (no crash-injection test written) |
| P3-03 | Email outbox workers had no fencing: a worker whose lease was reclaimed could overwrite the newer worker's outcome; exhausted rows had no visibility or recovery. | `claimToken` minted per claim, every outcome write conditional on it; stale-reclaim clears the token; `getOutboxHealth` + `requeueFailedEmail` (conditional on `failed`, audited, reason required). | LOCALLY_VERIFIED (policy + schema); fencing semantics BLOCKED_EXTERNAL |
| P3-04 | Wallet reconciliation only recomputed per-wallet drift (and wrote records). No category report, no pagination, no read-only mode. | `buildWalletLedgerDiscrepancyReport` in the existing `walletReconciliationService.js`: 6 classes, deterministic ids, `confirmed` vs `missing_evidence`, date filter, skip/limit paging (max 100), no 500 ceiling, writes nothing, access audited. | LOCALLY_VERIFIED (pure classifiers); aggregation pipelines BLOCKED_EXTERNAL |
| P3-05 | `Coupon.usedBy[]` conflated reservation and redemption; a captured payment's coupon could be released by the generic release path. | Per-entry `state` (`reserved`/`redeemed`/legacy-unclassified), `redeemedCount`/`releasedCount`/`rejectedCount`; `markUsed` = claim + idempotent `redeem`; `release` can never match a redeemed entry. `usedCount` meaning unchanged (existing limit checks intact). Historical entries are **not** reclassified or counted. | LOCALLY_VERIFIED (in-memory fake, extended); `$elemMatch`/`$pull` atomicity BLOCKED_EXTERNAL |
| P3-06 | Coupon admin API had no validation (percentage >100, past expiry, usageLimit below current usage), no audit trail, and **no UI at all**. | `couponRules.js` (server-authoritative validation + paise discount maths), audited create/update, `GET /api/finance/coupons/:id/usage`, list returns server-computed usage summary. | LOCALLY_VERIFIED |
| P3-07 | `WalletDashboard` labelled the *posted* balance "Available balance", wrong whenever funds are held. | Shows server `availableBalance`, posted and held. | IMPLEMENTED (no browser check) |
| P3-08 | `DoctorEarnings` still showed a "withdrawals coming in the next update" card although a real `DoctorWithdrawalPanel` is on the same page. | Placeholder removed. | IMPLEMENTED |
| P3-09 | Doctor payout rows showed the pre-refund share while totals were net of refunds. | Row shows refund adjustment, net share and a plain explanation (amounts only, no patient data). | IMPLEMENTED (no browser check) |

Test-infrastructure change: `tests/helpers/memoryModels.mjs` `$pull` now evaluates condition objects as a query on each element, as Mongo does (it previously compared fields by equality). This is what let the two existing Phase 02 coupon tests keep exercising the real production filter.

## New routes (all behind `protect` + `requireAdmin` + `manage_payments`, except coupons = SUPER_ADMIN)
- `GET  /api/admin/finance/reconciliation/discrepancies` — read-only report, audited
- `GET  /api/admin/finance/outbox` — health counts + exhausted rows (no email bodies)
- `POST /api/admin/finance/outbox/:id/requeue` — reason 5–300 chars, conditional on `failed`, audited
- `GET  /api/finance/coupons/:id/usage` — usage entries + admin audit history

## Frontend (existing page reused: `src/pages/finance/FinanceOperations.jsx`, now tabbed; no new route or sidebar entry)
Tabs: Collections & reconciliation (unchanged) · **Wallet reservations** (new, uses the existing Phase 02 endpoints; reason + explicit confirm; refetch after every attempt, including 409) · **Ledger discrepancies** (read-only, paged) · **Delivery health** (outbox) · **Coupons** (list/create/edit/activate/deactivate/usage/audit). New components live in `src/pages/finance/ops/`. Justification for new components: the wallet-reservation UI and coupon admin UI did not exist anywhere in `src/`.

## Wallet precision decision
`Wallet.balance` stays a rupee float. `backend/scripts/audit-wallet-precision.mjs` was **not run** (needs a copy of real data). Converting needs a dual-read/write migration validated on real balances. Production conversion: **BLOCKED_EXTERNAL**. New code in this phase computes in integer paise (`toPaise`) throughout.

## Role-based coverage matrix (what is true today)

| Feature | Backend | Existing UI | Connection | Change | Authorization test | UI/build test | Status |
|---|---|---|---|---|---|---|---|
| Wallet reservation recovery (admin) | existed (Ph02) | none | new tab → existing endpoints | UI added | route gating test (wiring only) | build/lint | IMPLEMENTED |
| Discrepancy report (admin) | added | none | new tab | service+route+UI | route gating test | build/lint | LOCALLY_VERIFIED (logic) |
| Outbox health/requeue (admin) | added | none | new tab | service+route+UI | route gating test | build/lint | LOCALLY_VERIFIED (policy) |
| Coupon admin | existed, unvalidated | none | new tab | validation, audit, usage, UI | route gating test | build/lint | LOCALLY_VERIFIED |
| Refund lock (all refund paths) | existed, defective | n/a | n/a | lease+fence | pure test | — | LOCALLY_VERIFIED |
| Patient wallet balances | existed | WalletDashboard | fixed label | held/available shown | unchanged | build/lint | IMPLEMENTED |
| Doctor earnings refund impact | existed | DoctorEarnings | payout row | adjustment shown | unchanged | build/lint | IMPLEMENTED |
| Patient refund request/tracking | existed (Ph P23) | PatientPayments + RefundActionModal | existing | **audited only, not changed** | — | — | NOT re-verified |
| Admin refund queue | existed | AdminRefunds | existing | **not audited this session** | — | — | NOT re-verified |

"Route gating test" inspects the real Express router stacks (real `protect`/`requireAdmin` identities and handler counts). It is **not** an HTTP role test; behavioural 401/403/IDOR tests need a running app + Mongo.

## NOT_FIXED / not started (explicit)
1. **Refund pipeline test matrix** (§2): only the lock lease was added. Duplicate webhook, browser/admin/recovery races, ambiguous timeout, retry-after-crash, wallet-credit/ledger/earning-reversal/notification failure and concurrent over-refund cases were **not** written or re-verified here. Existing P23/Phase 01/02 tests still pass.
2. **Reconciliation classes not implemented:** recharge without ledger, payment capture/allocation vs ledger, doctor-earning adjustments, duplicate capture evidence, exhausted pending operations. `reconcileWallet` (the write-capable recorder) was left untouched; the new report is the read-only path. No repair action with before/after evidence was built.
3. **Outbox:** not extended to payment receipt / recharge confirmation / earning adjustment events beyond what already used `enqueueEmail`; no crash-after-send test; at-least-once duplicate window after "provider accepted, not yet marked sent" is inherent and documented, not eliminated.
4. **Coupon:** no migration/backfill (new fields are additive; legacy entries stay unclassified by design); reservation-expiry sweep unchanged from Phase 02.
5. **Admin hub (§7):** unified overview metrics (§7.1), payment-detail drill-down links (§7.2), refund-queue completion (§7.3) not done.
6. **Doctor refund-review request workflow** (§9): not implemented.
7. **Patient:** receipt download / eligibility copy / duplicate-submit audit of existing pages not re-done.
8. **Migrations/indexes:** none added. A `status + updatedAt` index for exhausted outbox rows would help at scale (not created).
9. **Frontend tests:** the project has no frontend test runner; none added.

## Evidence NOT obtained (BLOCKED_EXTERNAL)
- Real MongoDB: `tests/mongo/phase03.mongo.test.mjs` is **authored but never executed** (script skips without `MONGODB_TEST_URI`; refuses a database name without "test"; drops the database). Run: `MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase03_test npm run test:mongo`.
- Razorpay sandbox, browser E2E, visual/responsive check: not run. A green build is not browser verification.

## Commands and exit codes (this session)
- `cd backend && npm ci` → 0; `npm ci` (root) → 0
- baseline `cd backend && npm test` → 185/185, exit 0; `npx eslint .` → 0; `npx vite build` → 0
- final `cd backend && npm test` → **190/190**, exit 0; `npx eslint .` → 0; `npx vite build` → 0
- New tests: `refundLockLease`, `emailOutboxLease`, `walletLedgerDiscrepancyReport`, `couponLifecycleRules`, `phase03RouteGating`.
