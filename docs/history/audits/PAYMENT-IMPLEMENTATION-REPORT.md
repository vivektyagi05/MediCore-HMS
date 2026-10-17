# PAYMENT IMPLEMENTATION REPORT — 2026-10-07 (slices 1-2)

Scope of this pass: forensic audit of the payment path, reproduction and fix of the
test-gateway failure, and hardening of the capture/replay/webhook convergence.
This is NOT the complete financial lifecycle in the master prompt; see "Not done".

## 1. Test-mode root cause (reproduced)
`POST /payments/test/complete` returns Razorpay-style snake_case
(`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, `amount`, `currency`).
`PaymentCheckout.jsx` forwarded that object unchanged to `POST /payments/verify`,
whose handler destructures camelCase (`razorpayOrderId`, `paymentId`, `signature`).
All three were `undefined`, so every test payment ended in HTTP 400
"Razorpay order id, payment id, and signature are required" before any signature
check, and the appointment stayed `payment_pending`. Reproduced with a script
against the real gateway module (see tests/paymentTestGatewayLifecycle.test.mjs).
Contributing: `.env.example` did not document PAYMENT_GATEWAY_MODE at all.

## 2. Fix (no verification bypass)
- payments/gatewayCallback.js (new): `normalizeGatewayCallback` accepts both shapes, coerces to trimmed strings only.
- controllers/paymentController.js `verifyPayment`: uses it; signature, gateway re-fetch, amount, currency and order checks unchanged.
- src/api/paymentApi.js `verifyPayment`: explicit field mapping; client amount/currency never sent.
- `completeTestPayment`: now refuses captured / non-payable orders (same lifecycle as real).
- Production guard (config/productionGuards.js, paymentGateway.js lazy import) untouched and re-tested.

## 3. Other defects fixed
1. Replay fabricated refunds: post-processing re-run on an already `payment_completed` appointment was judged an illegal transition and created a bogus auto `RefundRequest`. Now recognised as idempotent success.
2. Payout never healed: payout creation was gated on winning the flip, so a crash between flip and payout was permanent. Now also runs on idempotent replay (DoctorPayout.paymentId unique).
3. Capture was read-mutate-save in both verify and webhook. New payments/paymentCapture.js `claimPaymentCapture` is an atomic conditional update shared by both.
4. verify on an already captured payment threw 409 (double click = error). Now returns authoritative state (409 only for a different gateway payment id).
5. Webhook dedupe was find-then-create; now the unique `eventId` index is the gate (E11000 => 200 duplicate).
6. Webhook mismatch branch recorded `from === to` in stateHistory (overwrote state first).
7. verify's "gateway not captured" branch could overwrite a concurrently captured payment; now conditional.
8. Replay regressed `completed` -> `post_processing` and re-sent the receipt email; post-processing now short-circuits when complete.
9. Payout split used float math (`total*0.1`, `total*0.9`); now `allocatePayout` in integer paise, parts sum exactly, `PLATFORM_FEE_PERCENT` configurable (default 10 = previous behaviour).
10. Outbox cron existed but was absent from the deployment schedule; added to docs/SCHEDULER-ARCHITECTURE.md.

## 4. Audited and preserved (already correct)
Payment-expiry vs payment race (expireStalePaymentWindows uses a conditional write with extraFilter), webhook raw-body HMAC with timingSafeEqual, test gateway production guard, refund.processed dedupe by gateway refund id.

## 5. Verification
- Backend suite: 160/160 (158 baseline + 2 new files). ESLint clean. Vite build OK.
- NOT REAL-MONGO VERIFIED: no reachable MongoDB in this sandbox. New idempotency tests are source-contract tests, not concurrency proofs.
- LIVE RAZORPAY: NOT VERIFIED. BREVO DELIVERY: NOT VERIFIED.
- Browser E2E of the checkout page: NOT VERIFIED.

## 6. Not done in this pass (found or required, untouched)
- Platform fee is applied to tax-inclusive total (business decision needed).
- Payment receipt email is still direct send with a PDF attachment path; outbox has no attachment support, so it is not migrated.
- Expiry can cancel an appointment whose payment is captured but not yet post-processed (post-processing then auto-refunds; correct but not ideal).
- Not audited/implemented: refund eligibility reasons, partial-refund counters, refund failure states, doctor earning reversal, ledger compensation, direct/offline payment workflow, withdrawal reservation, immutable invoice snapshots, notification/realtime event matrix, admin control center, full concurrency matrix, final forensic re-audit.


---
# SLICE 2 — Refund engine + doctor earning reversal

## Audit findings (refundController.processRefund) and fixes
1. Gateway status ignored: a refund call that did not throw was recorded as processed. Now classified (payments/refundGatewayOutcome.js): PROCESSED / PENDING / FAILED / UNKNOWN.
   - PENDING: request stays gateway_processing; NO counters, wallet credit, ledger or earning reversal until the provider confirms (refund.processed webhook or reconciliation).
   - FAILED: definitive; payment not left looking refunded; request failed -> retry_required.
   - UNKNOWN / timeout / 5xx: AMBIGUOUS; request goes to reconciliation_required and stays "approved" so the partial-unique index blocks a second request. No blind retry.
2. Failure path threw: gateway_processing -> retry_required is illegal in the state machine, so every gateway failure raised 409 inside the catch, masked the real 502 and left the request stuck. Now failed -> retry_required (two legal hops).
3. Partial refund marked the whole appointment refunded; now only a full refund does.
4. Payout adjustment (old adjustDoctorPayoutForRefund): partial refund cancelled the entire pending payout, was not idempotent (a retry doubled the liability), used float math, wrote no ledger. Replaced by payments/refundEarningAdjustment.js:
   - exact paise math (BigInt proportion); final refund takes the exact remainder so doctor + platform adjustments sum to gross;
   - one immutable refundAdjustments[] entry per refund, keyed (gw:<refundId> or rr:<requestId>:<attempt>); same key never applies twice;
   - optimistic conditional update (status + adjustment total + key not present) retried on conflict (e.g. settlement racing);
   - pending payout: stays pending with a smaller NET amount, cancelled only when the whole doctor share is reversed;
   - paid payout: reversal is a recoverable liability subtracted from the withdrawable balance (no money from nowhere);
   - compensating ledger postings doctor_earning_reversal / platform_fee_reversal with unique idempotency keys; original gross/doctor/platform amounts never mutated; doctor notified (idempotent event key).
5. Doctor dashboard and withdrawable balance now net of refundAdjustmentAmount for every payout (previously only "adjusted_pending" paid payouts were subtracted, so a partially refunded payout that was later settled over-stated the balance).
6. Shared finalize: finalizeRefundMovement is the single money-moved step for the immediate path, the refund.processed webhook (settlePendingGatewayRefund) and reconcileRefundRequest. A gateway refund id already counted is never counted twice.
7. Webhook: refund webhooks for refunds this app initiated converge on that step; the out-of-band branch refuses to run while a refund lock is held (no double count race); redelivery of a previously FAILED webhook event is now actually retried (dedupe used to swallow it).
8. New: POST /refunds/requests/:id/reconcile (manage_payments), scheduler pass reconcilePendingRefunds in reconciliationCron (bounded, idle >= 2 min), admin "Check With Provider" action. Razorpay refund amount now uses toPaise. Gateway adapters gained fetchRefund / listPaymentRefunds; the test gateway gained refund_pending, refund_unknown, refund_failure (4xx), refund_timeout scenarios.

## Verification (slice 2)
- 163/163 backend tests; ESLint clean; Vite build OK.
- NOT REAL-MONGO VERIFIED: refundEarningApply.test.mjs is a SIMULATION (in-memory model stubs honouring the exact operators used) covering partial/final/replay/3-way concurrent duplicate/settled-payout/settlement race. processRefund / settle / reconcile orchestration is verified only by contract tests plus the pure pieces; it has not run against MongoDB or a provider.
- LIVE RAZORPAY: NOT VERIFIED (fetchMultipleRefund / refunds.fetch call shapes follow the SDK but are unexercised).

## Still not done (slice 2)
- Refund eligibility matrix not re-audited against the full actor/reason table in the brief; refund receipt PDF; refund realtime event names (refund:processing etc.) not added; refund emails still direct-send (not outbox).
- Wallet refund credit and counters are separate writes (no transaction): a crash between them is healed only by replay idempotency, not automatically.
- Withdrawal/payout reservation, direct payment, immutable invoice snapshots, admin control center, full concurrency matrix: untouched.
