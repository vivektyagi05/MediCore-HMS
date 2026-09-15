# MediCore HMS — P23 Concurrency Hardening Pass

Continuation of Phase P23 (Payments/Refunds/Wallet/Withdrawal). Audit-first,
additive-only. No new endpoints, models, or UI were needed for this pass —
two real, previously-undetected concurrency bugs were found by re-reading
the money-moving code paths against Section 22 ("Wallet Recharge" —
duplicate verification/concurrent recharge/double-credit) and Section 9/20
("no duplicate ledger entry"/"duplicate payout adjustments") of the P23
brief, and fixed in place.

## Real bugs found and fixed

### 1. Wallet recharge double-credit race (`financeController.js` — `verifyWalletRecharge`)

**Before:** the endpoint did `TransactionLedger.findOne({status:"pending"})`,
then credited the wallet with `$inc`, and only *afterwards* flipped the
ledger row to `status:"posted"`. Two concurrent calls for the same
`razorpayOrderId` (double-click, browser retry, a replayed request with the
same order id/payment id/signature) could both read the same `"pending"`
row before either one wrote back — both would then run the wallet `$inc`,
crediting the wallet twice for one real payment. This is exactly the
"concurrent recharge requests... balance double-credit" risk the brief
calls out.

**Fix:** the pending→posted transition on the ledger row is now a single
atomic `findOneAndUpdate` filtered on `status:"pending"`. Only one
concurrent request can ever win that update. A request that loses the race
(or is a genuine retry of an already-completed recharge) no longer proceeds
to credit the wallet a second time — it looks up the already-posted ledger
row by the same `paymentId` and returns that real, already-completed state
idempotently (`"Wallet recharge already completed"`), rather than either
double-crediting or throwing a confusing error for a legitimate retry.

### 2. Duplicate `DoctorPayout` creation race (`paymentController.js` — `completePaymentPostProcessing`)

**Before:** payout creation was `const existingPayout = await
DoctorPayout.findOne(...); if (!existingPayout) await
DoctorPayout.create(...)`. `completePaymentPostProcessing` can legitimately
run twice for the same payment concurrently (the synchronous `verifyPayment`
request and an async `payment.captured` webhook can both reach this line
before either has inserted). Both calls could pass the `!existingPayout`
check before either write landed.

`DoctorPayout.paymentId` already has a real unique index (added in the
original P23 pass specifically to "prevent double payout per payment"), so
the losing call's `create()` was never going to actually create a second
payout row — but the resulting `E11000` duplicate-key error was unhandled,
so the *losing* call's payment got flagged `post_processing_failed` /
`reconciliation_required` for what is actually a benign, already-resolved
race, not a real failure.

**Fix:** the `create()` call is now wrapped in a `try/catch` that treats a
duplicate-key error (`error.code === 11000`) as the expected idempotent
outcome of the race — a no-op — and re-throws anything else. No new model,
no new locking mechanism; the existing unique index is now actually
load-bearing instead of silently discarded.

## What was audited and found already correct (not touched)

- The Razorpay webhook handler (`webhookHandler.js`) already has real
  idempotency: `WebhookEvent` dedupe by `eventId` before processing, and
  `refund.processed` dedupes by `processedGatewayRefundIds` before posting
  any financial effect. No changes needed there.
- `completePaymentPostProcessing`'s wallet-debit step was already correctly
  atomic (single `findOneAndUpdate` with the debit-guard baked into the
  query filter, not a separate check-then-act) — this was the model the two
  fixes above were brought in line with.
- Mongoose's array-versioning (`stateHistory.push` + `save()`) already
  provides a real, if easy-to-miss, layer of optimistic-concurrency
  protection on payment/refund state transitions.

## Verification performed

- `node --check` on both edited files
- Full backend plain-assert suite: **88/90 passing** (same 2 pre-existing,
  unrelated failures as the prior session's baseline — `p12Geography.test.mjs`
  and `servicePartialUpdate.test.mjs`, both disclosed before and untouched by
  this pass)
- Repo-wide ESLint: same 7 pre-existing errors in untouched files (2 finance/
  content files, 3 i18n locale files) — 0 new errors in the 2 files this pass
  touched
- Clean `npm run build` (Vite production build)
- Clean backend boot (`ECONNREFUSED`-only against a placeholder Mongo URI —
  no live MongoDB in this sandbox, same limitation as every prior phase)
- **Fresh-extract gate**: this exact zip was extracted to a clean directory,
  `npm install` run fresh (root + `backend/`), and the full test
  suite/build/boot re-run against that clean extraction — same results as
  above

## Explicitly NOT done in this pass (disclosed, not claimed complete)

Carried over from the prior P23 continuation session's disclosed gaps —
none of these were in scope for a concurrency-hardening pass and none were
touched:

- Admin Recovery Center dashboard (Section 32/35 of the original brief)
- Reusable cross-workflow `FinancialTimeline` component (Section 33/36)
- Payment webhook/synchronous-verification convergence — a full re-audit of
  every possible interleaving beyond the two races fixed here
- Legacy-data reconciliation migration for pre-P23 refunds missing a wallet/
  gateway split
- Live browser/MongoDB E2E testing (mongodb-memory-server's binary still
  cannot be downloaded in this sandbox; no live Mongo/browser available)
- The full 55-section Final Acceptance Matrix run item-by-item

Doctor Subscription remains out of scope per the original brief's own STOP
instruction.
