# Financial Architecture

This is the canonical reference for how money moves through MediCore HMS:
`Payment`, `PaymentAttempt`, `Wallet`, `WalletRecharge`, `RefundRequest`,
`DoctorPayout`, `Withdrawal`, and `TransactionLedger`. It is aimed at a
backend engineer who needs to change or extend this area safely.

## The core distinctions (read this section first)

A recurring source of real bugs in this area (see
`CHANGELOG-P23-FAKE-SUCCESS-ELIMINATION.md` at the repo root) has been
treating two related-but-different things as the same thing. They are not:

- **Payment is not the ledger.** `Payment` (and `PaymentAttempt`) record
  the appointment-payment lifecycle. `TransactionLedger` is the append-only
  record of every credit/debit across payments, refunds, wallet, and
  subscriptions — a payment can exist without yet having produced a
  ledger entry (e.g. while still pending).
- **Wallet balance is not the ledger.** `Wallet.balance` is a current,
  mutable number. `TransactionLedger` is the history that explains how it
  got there. The balance is derived from ledger entries, not the other way
  around.
- **Doctor earnings are not the same as settled payout.** A completed
  appointment payment creates payout *eligibility*; `DoctorPayout.status`
  (`pending` / `paid` / `cancelled`) tracks whether that eligible amount
  has actually been settled to the doctor.
- **Withdrawable balance is not pending earnings.** A doctor's payout can
  be `pending` (earned, not yet paid out) while a separate `Withdrawal`
  record tracks the doctor actually pulling funds out, with its own
  lifecycle (`requested → reserved → processing → completed`, or one of
  several failure/retry branches — see below).
- **Refund is not simply "negative payment."** A refund has its own
  eligibility rules, its own approval workflow, and its own funding
  source (gateway, wallet, or a mix) — it is not a `Payment` row with a
  negative amount.
- **Gateway confirmation is not the same as local financial posting.** A
  valid webhook signature or a valid checkout signature proves the
  *payload* wasn't tampered with. It does not by itself prove the gateway
  actually **captured** the money. Every flow below only posts a credit
  after an authoritative fetch of the payment's status from the gateway
  (Razorpay's `fetchPayment`, in this codebase) confirms a captured/
  processed state — never on signature verification alone. This exact
  distinction was the root cause of a real bug (wallet recharges being
  credited on signature check alone) fixed in the P23 phase.

## Payment lifecycle

States (`backend/payments/paymentStateMachine.js`):

```
created → order_created → checkout_started → pending / authorized
        → captured → post_processing → completed
```

with explicit failure/side branches at nearly every step: `failed`,
`cancelled`, `expired`, `verification_pending`, and a catch-all
`reconciliation_required` that most states can transition into and out of.
`captured` can also move to `partially_refunded` / `refunded`.
Transitions are enforced by `assertPaymentTransition(from, to)` — there is
no code path that writes a new payment status without going through this
check (a bug where three admin actions bypassed it and hardcoded a fake
predecessor state was found and fixed in the P23 phase).

A `PaymentAttempt` is created per checkout attempt against a `Payment`,
so a payment that failed twice before succeeding has three attempt
records, each independently reflecting what actually happened on that try
— nothing about a payment's history is inferred or collapsed.

## Wallet recharge lifecycle

`WalletRecharge` is a **separate model and state machine** from `Payment`
(`backend/models/WalletRecharge.js`,
`backend/payments/walletRechargeStateMachine.js`) — not a repurposed
`Payment` row — because a wallet top-up has no `appointmentId`/`doctorId`
and a genuinely different lifecycle:

```
created → order_created → checkout_started
    → pending → verification_pending → captured → posted
```

with `failed`, `cancelled` (checkout dismissed — the order is preserved,
never credited), `expired`, and `reconciliation_required` branches.
Verification runs the same sequence appointment payments use: signature
check → authoritative `fetchPayment` call → order/amount/currency match
→ provider-status check. The wallet is only ever credited on an
authoritative captured/processed gateway state.

`postWalletRechargeCapture` performs the actual credit as a single atomic,
idempotent step: a `findOneAndUpdate` mutex condition on the recharge
document plus a unique `idempotencyKey` on the resulting ledger row, so a
concurrent duplicate verify call or a duplicate webhook delivery cannot
double-credit the wallet. `getWalletRechargeStatus` lets the client
recover after a refresh or dropped network call by re-fetching the
authoritative provider state rather than guessing from local state alone.

`getWalletAnalytics` filters ledger rows to `status: "posted"` — an
earlier bug summed pending/failed rows into analytics as if they were
completed activity; this was fixed in the P23 phase.

## Refund lifecycle

```
Eligibility check → reason derivation → RefundRequest created
    → policy evaluation → approval / rejection
    → funding allocation (gateway / wallet / mixed)
    → gateway or wallet execution → TransactionLedger entry
    → doctor liability adjustment → reconciliation
```

The refund's stored `reason` is derived server-side by
`deriveCanonicalReason({ reasonCode, description })` in
`refundPolicyEngine.js` — a single label map keyed by an already-validated
`reasonCode`. The client never controls the canonical financial-meaning
text directly; it sends a validated `reasonCode` (plus a `description`
only where the specific entry point requires one, e.g. "report a
problem"). This exists because an earlier contract mismatch between the
frontend (`RefundActionModal.jsx`, sending `{amount, reasonCode,
description}`) and the backend (which additionally required a raw
`req.body.reason`) caused every cancellation-style refund request to fail
with a 400.

Refund state transitions go through `refundStateMachine.js` /
`assertRefundTransition` — including admin approve/reject actions, after a
prior bug where three admin `findOneAndUpdate` calls bypassed this check
and recorded a fabricated predecessor state in `stateHistory`.

A refund can be **gateway-funded** (refunded back through Razorpay),
**wallet-funded** (credited to the patient's wallet instead), or **mixed**
— and if the doctor had already been paid out for the affected
appointment, a **doctor liability** adjustment is recorded
(`DoctorPayout.refundAdjustmentAmount` /
`refundAdjustmentStatus: none | adjusted_pending | adjusted_settled`)
rather than silently leaving the payout as if nothing changed.

## Doctor payout and withdrawal

`DoctorPayout` tracks what a doctor has *earned and is owed* for settled
appointments: `grossAmount`, `platformFee`, `doctorAmount`, and a status
of `pending` / `paid` / `cancelled`. This is payout *eligibility and
settlement bookkeeping* — it is not the same thing as the doctor actually
withdrawing cash.

`Withdrawal` is the doctor-initiated action of pulling funds out, with its
own state machine (`backend/payments/withdrawalStateMachine.js`):

```
requested → reserved → processing → completed
```

with `failed`, `retry_required`, `cancelled`, and
`reconciliation_required` branches reachable from multiple states — a
failed withdrawal attempt is not a dead end; it can move to
`retry_required` and back into `reserved`/`processing` rather than losing
the doctor's request.

## The transaction ledger

`TransactionLedger` is the append-only source of truth. Each row records:
`type` (`payment` / `refund` / `wallet_credit` / `wallet_debit` /
`subscription` / `coupon`), `direction` (`credit` / `debit`), `amount`,
`currency`, `status` (`pending` / `posted` / `failed` / `reversed`), a
`referenceId`, and a unique-but-optional `idempotencyKey` used specifically
to make credit-posting operations safe to retry. Analytics, balances, and
reconciliation reports are expected to filter on `status: "posted"` —
treating `pending` or `failed` rows as completed activity is exactly the
class of bug fixed in the wallet-analytics case above.

## Payment gateway adapter

`backend/payments/paymentGateway.js` selects between the real Razorpay
adapter and an in-repo `testGateway.js` based on
`PAYMENT_GATEWAY_MODE=test|<anything else>`. Local development and this
repository's automated tests run against the test gateway
(`TEST_PAYMENT_GATEWAY_SECRET`, `TEST_PAYMENT_SCENARIO`). The real
Razorpay path (`razorpayService.js`) has not been exercised against a live
Razorpay sandbox account in this environment — see
`docs/REMAINING_RISKS.md`. Webhook handling
(`backend/payments/webhookHandler.js`) includes deduplication via
`WebhookEvent` records, so a redelivered webhook cannot re-process the
same event twice.

## Security / consistency guarantees actually in place

- Server-side amount, currency, and ownership validation on every
  financial write (never trusting client-reported amounts).
- Idempotency keys on ledger-posting operations that could otherwise be
  double-applied by a retry or a duplicate webhook.
- Webhook deduplication via `WebhookEvent`.
- State-machine-enforced transitions on `Payment`, `WalletRecharge`,
  `RefundRequest`, and `Withdrawal` — no code path writes a new financial
  state without an explicit transition check.
- Atomic (`findOneAndUpdate`-mutex) posting for wallet credits.

Not claimed: PCI-DSS certification, a formal SOC 2 or HIPAA compliance
audit, or any third-party security certification. None of these has been
obtained or independently verified — see `SECURITY.md` and
`docs/REMAINING_RISKS.md`.
