# Phase 02 — Wallet, Recharge, Split-Payment & Coupon Integrity

Status vocabulary: IMPLEMENTED · LOCALLY_VERIFIED (in-memory model layer, executed) · INTEGRATION_VERIFIED · PRODUCTION_VERIFIED · BLOCKED_EXTERNAL · NOT_FIXED.
**Superseded for evidence counts and final statuses by `docs/PHASE-02-FINAL-CLOSURE.md` (185/185 backend). Nothing here is INTEGRATION_VERIFIED**: no mongod and no Razorpay sandbox were available. `tests/mongo/phase02.mongo.test.mjs` is written, wired into `npm run test:mongo`, and **not run**.

## 1. Wallet model (contract)
* `Wallet.balance` (rupees, unchanged, backward compatible) = **posted** balance. Credits/debits keep their existing `transactions[]` markers.
* `Wallet.holds[]` = **active** holds only `{reservationId, paymentId, amountPaise}`. **available = posted − Σ holds** (integer paise via `$round(balance*100)`).
* A hold is placed, committed, and released each by **one single-document atomic update** (`holdFunds`, `commitHold`, `dropHold`) → no multi-document transaction is assumed. Commit = `$inc balance` + `$pull hold` + `$push transaction` in the same update, so the debit happens **iff** the hold is consumed.
* `WalletReservation` (unique `paymentId`) is the durable lifecycle/recovery record: `holding → reserved → committed | released`, `holding → rejected`, `reserved/holding → recovery_required`. Fenced recovery lease (`leaseOwner/leaseUntil`), bounded `recoveryAttempts`, `lastError`, `stateHistory`.
* Reservation is **not** a ledger row; only a commit posts the `wallet_debit` ledger row (key `wallet:debit:<paymentId>`, unchanged). The wallet effect is written **first**, the ledger row second (replay-safe).
* Refunds into the wallet: untouched (Phase 03).

## 2. Split / wallet-only flow
1. `createPaymentOrder` computes the split from **available** balance (never a client value) and persists the Payment (Phase 01 slot/claim).
2. `ensureReservationForPayment` reserves the wallet portion **before** any provider order (`openGatewayOrder` also calls it, so retry/orphan-recovery paths cannot create a chargeable order without a hold). Lost race → definitive 409 `WALLET_INSUFFICIENT`, payment cancelled, coupon released.
3. Capture → `completePaymentPostProcessing` → `debitWalletForPayment` **commits** the reservation (exactly once; replay = no-op). If a capture lands after the hold was released, the guarded direct debit (which also respects holds) is used; if funds are gone the payment stays `post_processing_failed`/reconciliation-required with the capture preserved.
4. Wallet-only: no gateway order (internal attempt). Only a *definitive* wallet refusal cancels; an ambiguous error returns 503 `WALLET_PAYMENT_PENDING` and `recoverWalletOnlyPayments` finishes it (commit → capture claim → post-process) or, if nothing was debited and the appointment is no longer payable, cancels and releases.
5. Release rule (`paymentAllowsRelease`): only `cancelled`/`expired`/retry-exhausted `failed`, and **never** with a provider payment id, `reconciliationState=required`, capture evidence, `authorized`, or `verification_pending`. A timer alone never releases. `sweepUnpayablePayments` + the appointment-expiry hook cancel/release unpaid payments of unpayable appointments (this closes the previous "hold forever" gap).

## 3. Recharge
One pipeline (`payments/walletRechargeService.js`) for browser verify, webhook (new — recharges previously had **no** webhook path), status polling and recovery: intent persisted **before** the provider order (deterministic receipt `wr_<id>`, placeholder order id); CAS → `captured` from any non-posted state (**late capture after a reported failure is credited**); wallet credit guarded by a per-recharge marker (single atomic update) → ledger row (unique key) → CAS `posted`. A crash at any step is healed by replay (`recoverStuckWalletRecharges`, bounded 8 attempts, backoff, `lastRecoveryError`). Missing/mismatched provider amount/currency/order → `reconciliation_required`, never fabricated. A second distinct provider payment is recorded as `duplicateCaptures` evidence, never credited. A stale `save()` can no longer downgrade state (failed path is CAS from open states).

## 4. Coupons
Existing atomic claim (global limit + per-user) preserved. Added: `recoverOrphanCouponReservations` (claim exists, Payment row never created, after 15 min grace → released once, idempotent); release is now gated by the same provider-evidence rule as wallet holds. **Known limit:** `usedBy[]` still serves as both reservation and redemption record (no separate redeemed state) — documented, not rewritten.

## 5. Duplicate-capture resolution
`GET /api/admin/payments/capture-cases`, `POST /api/admin/payments/:id/capture-cases/resolve` (UI: `/admin/capture-cases`, SUPER_ADMIN nav group Finance); reservations needing review: `GET /api/admin/payments/wallet-reservations`, `POST /api/admin/payments/:id/wallet-reservations/resolve` (API only) (SUPER_ADMIN, reason 10–500 chars, audited via `writeAdminLog`). States per evidence entry: `open → insufficient_evidence | verified_no_action | refund_required`; terminal states CAS-protected; provider evidence re-verified (cannot mark harmless while still captured/unrefunded). **Moves no money**; `refund_required` points to the existing refund-request flow. The workspace page `src/pages/admin/AdminCaptureCases.jsx` was added in the closure (lists open/resolved cases, reason-required dialog, stale/conflict/error handling, refetch after resolve, never claims a refund happened). Not browser-verified.

## 6. Indexes / migration
New unique index `uniq_wallet_reservation_payment` is declared on the schema; migration **011 is model-derived and re-runs on every release** (`scripts/release.mjs`), so no new numbered migration is needed (a new collection has no pre-existing duplicates). Verified offline that the inventory contains it; real index creation BLOCKED_EXTERNAL.

## 7. Frontend / API contract
`GET /wallet` adds `availableBalance`/`heldBalance` (holds not exposed). Checkout shows available balance, blocks re-entry while preparing, handles `WALLET_INSUFFICIENT` (refetch wallet) and `WALLET_PAYMENT_PENDING` (show authoritative state, never starts a second payment). `POST /payments/orders` may now return 409 `WALLET_INSUFFICIENT` and 503 `WALLET_PAYMENT_PENDING`. The recharge modal was not changed (response shape unchanged).

## 8. Evidence
Backend suite 179/179 (was 175; +4 files: walletReservation 17 checks, walletRechargeIdempotency 10, phase02Recovery 12, captureResolution 7), ESLint clean, frontend build OK. In-memory only. **Not covered by an executed test:** full HTTP-level split-payment crash matrix through `createPaymentOrder` (gateway-order-then-DB-failure, capture→commit failure) — covered only by component tests (reservation, recovery, post-processing replay) and Phase 01 tests; coupon *concurrency* (needs `$expr`, real Mongo only).

## 9. Unresolved
Real MongoDB/Razorpay/browser E2E; no admin UI for capture cases; coupon reservation/redemption not separate states; legacy payments without a reservation still use the guarded direct debit; `Wallet.balance` remains a float in rupees (compared as integer paise); full accounting (refund finalization, balance↔ledger reconciliation report, durable financial events) is Phase 03.

## 10. Closure addendum
Three further defects were found by the application-path matrix and fixed (N-P2-08 stale recharge saves, N-P2-09 duplicate provider orders on concurrent submit — 409 `PAYMENT_CREATION_IN_PROGRESS`, N-P2-10 recharge amount validation). See `docs/PHASE-02-FINAL-CLOSURE.md`.
