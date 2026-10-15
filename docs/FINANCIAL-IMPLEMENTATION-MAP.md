# MediCore-HMS Financial Implementation Map

Baseline: upload `MediCore-HMS-PAYMENT-SLICE2-2026-10-07.zip`, 163/163 backend tests passing before any change.

**Source-of-truth note.** The forensic audit document (F-001..F-024) was NOT included in the upload. Finding
descriptions below come from the task brief. Each row is tagged:
- `CODE-CONFIRMED` — root cause reproduced by reading the actual source (file/line cited).
- `BRIEF-ONLY` — taken from the brief; code not yet inspected in depth. Must be confirmed before it is marked FIXED.

Environment facts: no reachable MongoDB in the sandbox, so Mongo-backed concurrency/transaction tests cannot run here.
The only existing `startSession/withTransaction` use is `privacyController.js`. Production Mongo capability is unknown
(NOT VERIFIED), so every multi-document financial flow is designed as an idempotent saga, not as a transaction.

| ID | Sev | Subsystem | Status | Root cause (evidence) | Files | Required change | Tests |
|----|-----|-----------|--------|-----------------------|-------|-----------------|-------|
| F-001 | P0 | Subscription | CODE-CONFIRMED | `subscriptionService.createSubscription` writes `status:"active"` with no payment; `financeController.createSubscription` (l.131-162) then invoices it. Model has no payment/order fields and no `pending_payment` state. | payments/subscriptionService.js, controllers/financeController.js, models/Subscription.js, FE subscription pages | Intent -> server price -> payment order -> verify -> capture -> activate -> invoice -> ledger. New states, payment linkage, plan/pricing snapshot. | state machine, activation-only-after-capture, idempotent activation |
| F-002 | P0 | Withdrawal | CODE-CONFIRMED | `withdrawalAdminController.applyTransition` sets `completed` + `completedAt` with no provider call; destination is free text `destinationLabel`. | controllers/admin/withdrawalAdminController.js, payments/withdrawalStateMachine.js, models/Withdrawal.js, FE AdminWithdrawals / DoctorWithdrawalPanel | No payout provider exists -> keep explicit MANUAL_SETTLEMENT: `manual_pending`/`manual_completed`, actor/ref/reason, UI never says "paid/transferred". | state machine, truthful labels |
| F-003 | P0 | Refund | CODE-CONFIRMED | `webhookHandler.js` l.~125-160: out-of-band `refund.processed` does `$inc refundedAmount` (as `entity.amount/100` float) directly; no ledger reversal, wallet credit, doctor-earning or platform-fee reversal. A second finalization path exists beside `settlePendingGatewayRefund`. | payments/webhookHandler.js, controllers/refundController.js, payments/refundEarningAdjustment.js | Route the out-of-band branch through the canonical finalizer; integer paise only. | out-of-band refund finalizes exactly once |
| F-004 | P0 | Wallet recharge | BRIEF-ONLY (partially seen) | WalletRecharge + TransactionLedger + Wallet.balance are separate writes; guarded by idempotency keys but no posting-state record to tell nothing/partial/full. | payments/walletRechargeStateMachine.js, controllers/paymentController.js, models/WalletRecharge.js | Posting-step state on WalletRecharge, recovery job, walletReconciliationService. | crash-after-each-write recovery |
| F-005 | P0 | Coupon | CODE-CONFIRMED | `couponService.validateAndCalculate` reads `usedCount`, `markUsed` does read-modify-`save()` -> two concurrent users can exceed `usageLimit`. | payments/couponService.js, models/Coupon.js | Atomic conditional `findOneAndUpdate` claim with `usedCount < usageLimit` and per-user guard; release on failure/cancel. | concurrent claim test (Mongo-gated) + pure rule tests |
| F-006 | P1 | Retry race | CODE-CONFIRMED | `paymentRetryService.scheduleFailedPayment` does findById + checks + `save()`; `retryDuePayments` uses `Promise.all`; no atomic claim shared by admin and cron. | payments/paymentRetryService.js, cron/retryFailedPayments.js, admin retry route | `claimRetry(paymentId)` via conditional update on status+retryCount; admin and cron both call it. | double-claim returns one winner |
| F-007 | P1 | Reconciliation | CODE-CONFIRMED | `reconciliationService` uses `Payment.find().limit(500)` (twice). Records past 500 are never reconciled. | payments/reconciliationService.js, cron/reconciliationCron.js | `_id` cursor batches with persisted continuation, resumable, bounded memory. | cursor covers all records |
| F-008 | P1 | Invoice | CODE-CONFIRMED | `invoiceService` does `findOne({paymentId})` then create; `Invoice.paymentId` has index but no unique constraint (only the invoice number is unique). | services/invoiceService.js, models/Invoice.js | Partial unique index on `paymentId`; duplicate-detection migration that reports and never deletes. | migration dry-run test, E11000 handled |
| F-009 | P1 | Ledger | CODE-CONFIRMED | `TransactionLedger.type` enum has no withdrawal, doctor-earning, platform-fee, recharge or adjustment entries. | models/TransactionLedger.js | Extend enum additively; single-entry with `accountingContract` rules (see contract doc). | enum/invariant test |
| F-010 | P1 | Email outbox | CODE-CONFIRMED (partial) | Outbox exists (`emailOutboxService`, `EmailDelivery`) but `entityType` defaults to appointment and payment/refund/subscription/withdrawal mails are not routed through it; `cron/processEmailOutbox.js` is not registered anywhere. | services/emailOutboxService.js, cron/processEmailOutbox.js | Enqueue financial mails with deterministic eventKeys; register the job. | enqueue idempotency |
| F-011 | P1 | Realtime | BRIEF-ONLY | Lifecycle events incomplete; FE must treat events as invalidation only. | realtime/*, FE hooks | Event catalogue + FE refetch. | contract test |
| F-012 | P1 | Wallet authority | BRIEF-ONLY | Wallet.balance is materialized with no comparison against ledger. | models/Wallet.js, controllers/walletController.js | `calculateExpectedWalletBalance` + discrepancy record, never auto-fix. | pure derivation test |
| F-013 | P1 | Capture allocation | BRIEF-ONLY | Capture touches Payment, wallet, ledger, invoice, payout, outbox in separate writes. | payments/paymentCapture.js, controllers/paymentController.js | Saga step status on Payment + recovery. | crash-at-each-step |
| F-014 | P0/P1 | Withdrawal reservation | BRIEF-ONLY | Create-then-recheck balance. | controllers/doctor withdrawal, models/Withdrawal.js | Atomic reservation against a per-doctor balance document. | concurrent withdrawals (Mongo-gated) |
| F-015 | P1 | Schedulers | CODE-CONFIRMED | No `render.yaml`, no `setInterval`/`node-cron` in `server.js`; the six `cron/*.js` scripts are not registered by any deploy artifact in the repo. Only `automation/cronJobs.js` runs on demand via API. | cron/*.js, server.js, deploy config | Decide topology and document exact registration; in-process worker guarded by `CronRunLog` lock. | health/last-run test; runtime NOT VERIFIED |
| F-016 | P2 | Refund receipt | BRIEF-ONLY | No refund document found in grep. | invoices/, FE | Immutable refund receipt from stored refund snapshot. | snapshot test |
| F-017 | P1 | FE callback | BRIEF-ONLY | `src/components/payment/` handler error path to be inspected. | src/components/payment | State machine confirming/success/failed/unknown with refetch. | FE harness |
| F-018 | P1 | Wallet-only pay | CODE-CONFIRMED | `paymentController.js` l.417 throws when `gatewayAmount < 1`. | controllers/paymentController.js | Backend-derived split; wallet-covered total captures internally with no gateway order. | split math tests |
| F-019 | P1 | Testing | CODE-CONFIRMED | Suite is pure-logic/source-contract; no Mongo. | tests/ | Add gated real-Mongo + concurrency layers. | n/a |
| F-020 | P1 | Prod evidence | CODE-CONFIRMED | No runtime evidence obtainable offline. | docs | PRODUCTION-FINANCIAL-VERIFICATION.md with explicit NOT VERIFIED rows. | n/a |
| F-021 | P1 | Ledger/withdrawal | CODE-CONFIRMED | `Withdrawal.ledgerReference` is a bare string; no withdrawal ledger types exist. | models/Withdrawal.js, TransactionLedger.js | Withdrawal reservation/release/settlement entries. | invariant test |
| F-022 | P1 | Invoice storage | CODE-CONFIRMED (partial) | `storageService` has local and S3 drivers; local is non-durable on ephemeral hosts. | storage/storageService.js, config/env.js | Require S3 in production for documents (verify existing guard). | NOT VERIFIED at runtime |
| F-023 | P0/P1 | Renewal | CODE-CONFIRMED | `cron/subscriptionRenewals.js` increments `failedRenewalCount` on every due sub with no payment attempt and cancels after 3 runs; `markCharged` only fires from a Razorpay subscription webhook that no code creates. | cron/subscriptionRenewals.js | Renewal creates a payment attempt; entitlement extends only on capture. | renewal state tests |
| F-024 | P1 | FE UX recovery | BRIEF-ONLY | See F-011/F-017. | src/ | Shared refetch-on-reconnect hook. | FE harness |

## Additional bugs found while mapping
- A1 (CODE-CONFIRMED): `cron/subscriptionRenewals.js` counts a missed renewal even when no charge was ever attempted, so healthy subscriptions drift to `past_due` then `cancelled`.
- A2 (CODE-CONFIRMED): out-of-band refund webhook converts amounts with float division (`entity.amount / 100`) instead of integer paise.
- A3 (CODE-CONFIRMED): `retryDuePayments` creates gateway orders inside `Promise.all` with no per-payment claim, so one failure rejects the batch.


---

## Phase 01 additions (2026-10-14) — where payment state is now mutated

| Path | Entry | Mechanism |
|---|---|---|
| Create order | `createPaymentOrder` | `Payment.create` (slot) -> `reserveAttempt` -> `openGatewayOrder` -> `transitionPayment(created->order_created)` -> `atomicTransition` (appointment) -> `transitionPayment(->pending)` |
| Browser verify | `verifyPayment` | `resolveGatewayOrder` -> `claimPaymentCapture` -> `markAttemptCaptured`/`supersedeOpenAttempts` -> `completePaymentPostProcessing` (CAS transitions) |
| Webhook captured/failed | `razorpayWebhookHandler` -> `processWebhookEventRecord` -> `processEvent` | `handleCaptured` / `applyGatewayFailure` |
| Patient/admin/cron/webhook retry | `paymentRetryService.createRetryAttempt` | fenced claim -> attempt-first order -> fenced `transitionPayment` |
| Stuck events / orphan orders | `cron/recoverPaymentEvents.js` | `recoverWebhookEvents`, `recoverOrphanAttempts` |
| Reconciliation of `post_processing_failed` | `reconciliationService` | `completePaymentPostProcessing` (unchanged call, now CAS) |
| Self-healing | `retryWebhookEvent` | `processWebhookEventRecord(force)` |

Not changed (later phases): wallet recharge, refunds, withdrawals, subscription activation (still `save()`-based), coupon claim semantics.
