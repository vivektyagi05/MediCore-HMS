# PAYMENT BUSINESS LOGIC SPEC (implemented behaviour, slice 1)

Gateway abstraction: payments/paymentGateway.js selects razorpayService or the
in-memory testGateway (PAYMENT_GATEWAY_MODE=test, never in production).

Capture convergence: browser verify, payment.captured webhook and reconciliation all
call claimPaymentCapture (atomic conditional update on Payment.status). One caller wins;
others are idempotent replays and continue into completePaymentPostProcessing, which
short-circuits when paymentState=completed and postProcessingState=complete.

Verify contract: body {razorpayOrderId,paymentId,signature} (snake_case accepted).
Server re-fetches the gateway payment and checks order, amount (paise) and currency.

Appointment coupling: a replay for an appointment already PAYMENT_COMPLETED by the same
payment is success. A genuinely cancelled/expired appointment still yields an auto
RefundRequest (once).

Allocation: allocatePayout(total, PLATFORM_FEE_PERCENT||10) — integer paise.
Expiry race: appointment expiry is a conditional write; payment-first and expiry-first
both resolve safely (see paymentWindowExpiry tests).


## Refunds (slice 2)
Gateway outcome is interpreted, not assumed: processed -> finalize; pending -> wait for webhook/reconcile; failed -> failed/retry_required; unknown or ambiguous error -> reconciliation_required (no blind retry).
Finalize (lock held, idempotent): payment counters (once per gateway refund id), partial vs full status, appointment marked refunded only when fully refunded, wallet credit, ledger, doctor earning + platform reversal keyed per refund, request processed, notifications.
Earning reversal: proportional per refund, exact remainder on the final refund; pending payout shrinks (cancelled only when fully reversed); paid payout becomes a liability deducted from withdrawable balance. Net doctor earning = doctorAmount - refundAdjustmentAmount.


---

## Phase 01 — payment lifecycle contract (2026-10-14)

**Authoritative fields.** `Payment.status` is the legacy financial status (reports, capture claim); `Payment.paymentState` is the workflow state. Effective state = `paymentState || status`. A payment is *capture-confirmed* if EITHER field is one of `captured, post_processing, post_processing_failed, completed, partially_refunded, refunded`. A capture-confirmed payment can never move to `failed/cancelled/expired/pending/...`; refunds follow their own lifecycle.

**One mutation path.** `transitionPayment` (compare-and-set pinned to the status+paymentState read; real previous state in history; a lost race re-reads and re-validates). Legal moves are `PAYMENT_TRANSITIONS`; capture is additionally legal from every pre-capture state including `failed`.

**Attempts.** Every provider order belongs to exactly one `PaymentAttempt` (unique `paymentId+attemptNumber`, unique `gateway+gatewayOrderId`). Order creation is attempt-first with a deterministic receipt `pay_<paymentId>_<n>`; ambiguous provider errors leave a placeholder that recovery resolves by receipt lookup. `Payment.razorpayOrderId`/`gatewayOrderId` point at the CURRENT order only.

**Failure.** Applied only to the exact attempt named by the event, only if still open, and to the payment only if that attempt is the current order and the payment is pre-capture. Retry is scheduled only after the transition applied, only via the fenced retry claim, bounded by `MAX_RETRIES` (3). When retries are exhausted the appointment slot is released.

**Capture.** Order -> attempt -> payment; strict amount/currency/order (never substituted) against the ATTEMPT's allocation, which must equal the payment's authoritative allocation. First verified capture wins (`claimPaymentCapture`, attempt recorded); other open attempts become `superseded`; a later capture of a DIFFERENT provider payment is stored in `captureEvidence` and flagged `reconciliationState=required` (no second fulfilment, no silent discard); capture on cancelled/expired payments is preserved the same way (expired -> `reconciliation_required`). Replays converge; automation/realtime fire only when the CAS completion applied.

**One active payment per appointment.** `activeAppointmentSlot=true` (partial unique index) is held from creation until cancelled/expired/refunded/retries-exhausted. A new request with a different idempotency key gets 409 `ACTIVE_PAYMENT_EXISTS`; the same key by the same user replays the stored order; failed/expired payments are resumed through retry (same Payment, new attempt).

**Webhook events.** `received -> processing(lease 2 min) -> processed | failed(retryable, nextAttemptAt, backoff 30s..1h, max 8)`. Completion is fenced by lease owner. Dedupe = unique `eventId` (`rzp:<x-razorpay-event-id>`, else composite, else body hash). Only minimised payload and a 16-char signature digest are stored.

**Browser.** The callback is a hint. `verify`: ownership -> signature -> provider re-fetch -> strict fields -> status (`captured` claim; `failed` fail current attempt; anything else 202 pending) . `/payments/status` returns `SUCCESS | PENDING | FAILED | REQUIRES_RECONCILIATION | NONE` from backend evidence; the UI shows success only for `SUCCESS`.
