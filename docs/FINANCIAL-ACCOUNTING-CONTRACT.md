# Financial Accounting Contract (Phase A)

Scope: contract plus the parts already enforced in code in this slice. Parts not yet enforced are marked **(not yet enforced)**.

## Decisions
1. **Ledger model:** `TransactionLedger` stays a **single-entry, append-only transaction history** (not double-entry). Rationale: the existing code, reports and idempotency keys all assume it; a double-entry rewrite would be a parallel financial system, which the brief forbids. Balance-bearing entities (Wallet, doctor available balance) are materialized views that must be reconcilable against it. Entry types now include `doctor_earning`, `platform_fee`, `recharge`, `subscription_payment`, `withdrawal_reservation|release|settlement|reversal`, `adjustment` (enum extended; withdrawal postings **not yet written**).
2. **Atomicity:** production Mongo transaction support is **unverified**, so no multi-document operation is assumed atomic. Financial flows are idempotent sagas: one conditional-update "claim" per state change, idempotency-keyed ledger/wallet writes, explicit recoverable state on failure.
3. **Money unit:** integer paise for all comparisons/arithmetic (`payments/money.js`).

## Ownership
| Entity | Authoritative for | Mutable? |
|---|---|---|
| Payment / PaymentAttempt | provider order/payment ids, captured amount, state | state only via state machine; attempts append-only |
| Wallet | materialized spendable balance | `$inc` only, keyed by transaction reference |
| WalletRecharge | recharge intent and posting state | state machine |
| TransactionLedger | immutable history | never updated; reversals are new rows |
| RefundRequest | refund lifecycle | state machine |
| DoctorPayout | per-consultation earning/fee allocation | adjusted only by refund reversal |
| Withdrawal | doctor request to move money out | **manual settlement only; `manual_completed` means an admin recorded an out-of-band settlement with reference + reason, never a verified bank transfer** |
| Subscription | plan entitlement and its paid periods | only via `subscriptionService` |
| Invoice | tax document | immutable; one per payment (unique index) |
| Coupon | usage counter and per-payment reservations | atomic claim/release only |

## Classification
- **Creates money (provider-confirmed):** captured Payment, captured WalletRecharge, captured subscription order.
- **Consumes:** wallet debit at payment, coupon discount.
- **Reverses:** refund (gateway portion to provider, wallet portion to wallet), doctor-earning and platform-fee reversal.
- **Informational only:** frontend amounts, Socket.IO payloads.
- **Manual settlement:** admin-marked withdrawal completion. It is **not** a provider-confirmed transfer and must never be labelled "paid/transferred" **(UI/model change not yet made)**.

## Invariants and enforcement status
| Invariant | Status |
|---|---|
| a coupon cannot exceed its usage limit | enforced: atomic claim (Mongo-gated test written, not run) |
| a recharge cannot credit the wallet twice | enforced in code: recharge-keyed wallet credit (not run against Mongo) |
| an invoice cannot be duplicated for a payment | enforced: partial unique index, needs migration 009 on existing data |
| a subscription cannot become paid-active without successful payment | enforced in code: only `activateFromCapture` activates |
| a refund cannot reverse the same earning twice / out-of-band refund converges | enforced via single finalizer and provider-id dedupe |
| one worker per payment retry | enforced: atomic `claimRetry` |
| wallet balance == ledger-derived balance | detected, not enforced: `walletReconciliationService` records drift in `ReconciliationRecord`; never auto-corrects |
| withdrawal cannot reserve the same balance twice | enforced in code via atomic gate (concurrency test unrun) |
| doctor available balance cannot go negative | **not yet enforced/verified** |
| every financial side effect has an idempotency key | partial: new paths yes; legacy paths not audited |
