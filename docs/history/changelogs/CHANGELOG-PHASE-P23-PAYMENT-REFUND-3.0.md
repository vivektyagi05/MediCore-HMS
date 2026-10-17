# PHASE P23 — Payment + Refund 3.0

Status: **BLOCKED (partial close)** — the highest-severity financial-correctness
and boot-integrity defects found in audit are fixed and verified. Full closure
against the 66-section continuation brief is NOT claimed. See "Remaining
blockers" below.

## Prior P23 work (kept, not discarded)

A previous pass already delivered and is retained as-is: canonical gateway
adapter + isolated deterministic test gateway, `PaymentAttempt` persistence,
explicit payment workflow state + transition history, integer-paise
monetary helpers, server-authoritative amount/currency verification,
idempotent payment post-processing + webhook convergence, idempotent wallet
debit/credit guards, refund lifecycle metadata/attempts/gateway-reference
persistence, refund concurrency + duplicate-active-request protection,
refund webhook deduplication, reconciliation checks, retry-order creation
for failed attempts, Brevo-only transactional email, the reusable
`FinancialWorkflow` UI primitive, and the test-gateway checkout path.
Explicitly still excluded, unchanged: doctor subscription/recurring billing,
a second booking/invoice/wallet architecture.

This continuation pass re-audited that implementation against the actual
codebase (not the changelog above) and closed real, verified gaps in it.

## 1. Deep financial audit — real findings

Confirmed already solid: `paymentStateMachine.js`/`refundStateMachine.js`
existed but were unused (see below), integer-paise arithmetic, the
per-payment refund lock, the refund duplicate-request guard, webhook
signature verification + replay dedupe, and wallet/gateway funding-split
*tracking* at payment-creation time (`Payment.walletAmount`/`gatewayAmount`).

Found and fixed, in severity order:

1. **Double-payout bug (critical).** `processRefund()` sent the *full*
   refund amount to the payment gateway **and** credited the wallet the
   *full* amount again, even though the payment's real wallet/gateway
   funding split was already tracked on the document. A ₹1,000 refund on a
   payment funded ₹300 wallet / ₹700 gateway would have moved ₹1,700.
   Matches the brief's Scenario 1 and Section 27 exactly.
2. **State machines existed but were never wired in.** `refundController.js`
   imported neither `paymentStateMachine.js` nor `refundStateMachine.js` —
   every `payment.status` / `refundRequest.refundState` mutation was a bare,
   unvalidated field assignment (Sections 15/16's explicit prohibition). The
   `refund.processed` webhook branch had the same defect.
3. **No refund policy engine anywhere.** Eligibility was implicit ("any
   captured payment, any amount up to the balance") — a patient could
   instantly refund a payment on an already-completed consultation,
   directly violating the brief's "MOST IMPORTANT RULE" and Scenario 3.
4. **No reason-category validation.** `reason` was unvalidated free text —
   "test", "refund", "abc" all passed.
5. **No doctor-payout/refund interaction at all.** A refund never touched
   `DoctorPayout` — no cancellation of a pending payout, no visibility into
   an already-settled one (Section 14, Scenario 11).
6. **Severe, unrelated boot-breaking bug** found only by actually running
   the app: `paymentRoutes.js` referenced `completeTestPayment` without
   importing it — a `ReferenceError` at import time that crashed route
   registration for the entire backend, not just payments.
7. Five genuinely dead imports/bindings (`razorpayService`, `fromPaise` in
   `paymentController.js`; `emailService`/`invoiceService`/`couponService`/
   `paymentEmitter` in `webhookHandler.js`; an unused `catch (error)`
   binding) — pre-existing eslint violations in files this phase already
   had open, cleaned up.

## 2. New — canonical Refund Policy Engine

`backend/payments/refundPolicyEngine.js` (new file), the one authoritative
source every caller must go through (Section 4):

- `evaluateRefundEligibility()` — separates **financial capacity** (how much
  *could* be pulled back) from **business eligibility** (whether the
  patient may ask right now). Returns the brief's exact structured shape
  (`eligible`, `reasonCode`, `action`, `maximumRefundAmount`,
  `approvalRequired`). A completed/consultation-completed/review-eligible
  appointment is ineligible for a direct patient refund and routes to
  `REPORT_PROBLEM`; an admin actor is a deliberate, authorized override
  (Section 7).
- `REFUND_REASON_CATEGORIES` — 9 canonical categories; `validateRefundReason()`
  rejects a missing/invalid category, a category not legal for the calling
  entry point, and (for `OTHER`) an obviously meaningless free-text
  description ("test", "abc", "refund", "give money", etc.) — pattern-level
  only, never a keyword-based business/medical decision.
- `computeFundingAllocation()` — the real fix for the double-payout bug.
  Splits a refund amount across the wallet-funded and gateway-funded
  *remaining* capacity of the payment, proportionally, with an exact
  paise-level rounding correction so `walletShare + gatewayShare` always
  equals the requested amount and neither bucket is ever asked to refund
  more than it actually holds.
- `computeRefundableAmount()` — server-authoritative capacity.

## 3. `refundController.js` — rewritten around the policy engine + state machines

- `processRefund()`: computes the funding allocation once; calls the
  gateway **only** for `gatewayRefundAmount` (skipped entirely for a
  wallet-only refund); credits the wallet **only** for `walletRefundAmount`;
  posts **two independent, independently-idempotent** ledger entries when
  both buckets are involved (`refund:gateway:<id>` / `refund:wallet:<id>`)
  instead of one entry pretending to cover both. `Payment.walletRefundedAmount`
  / `gatewayRefundedAmount` are the new authoritative per-bucket counters.
  Every `payment.status` change now goes through `appendPaymentTransition()`;
  every `refundRequest.refundState` change goes through the new
  `appendRefundTransition()` (added to `refundStateMachine.js`, mirroring
  the existing `appendPaymentTransition` pattern).
- `createRefundRequest()` (cancellation entry point) and new
  `reportPaymentProblem()` (post-consultation entry point) share one
  `buildRefundRequestForEntryPoint()` helper — separated per Section 7
  rather than one generic endpoint for every scenario. A completed
  appointment hit through `createRefundRequest` is rejected with a message
  pointing at the new endpoint instead of silently proceeding.
- `initiateRefund()` (admin direct refund) now also runs through the state
  machine and carries `entryPoint: "admin"` on the created `RefundRequest`.
- `adjustDoctorPayoutForRefund()` (new): a **pending** payout is cancelled
  outright (money never left); an already-**paid** payout gets an explicit,
  non-destructive liability marker (`liabilityStatus: "adjusted_pending"`,
  `refundAdjustmentAmount`, `refundReference`) — `grossAmount`/`doctorAmount`
  /`platformFee` are never mutated (financial history preserved, Section 55).
  No automated recovery-from-future-payouts engine exists in this codebase;
  this is disclosed honestly as a manual-follow-up state, not fabricated as
  automatic.

## 4. `webhookHandler.js` — refund webhook convergence

`refund.processed` now updates `gatewayRefundedAmount` alongside the
existing `refundedAmount` counter and routes the resulting status change
through `appendPaymentTransition()` instead of a bare assignment; an
out-of-order/illegal transition falls back to `reconciliation_required`
rather than forcing an invalid state (Section 26). The existing
gateway-refund-id dedupe guard (`processedGatewayRefundIds: {$ne: entity.id}`)
is unchanged and is still what prevents this path from double-posting a
refund this app's own `processRefund()` already recorded (Section 24/25).

## 5. Model changes (additive only)

- `Payment`: `walletRefundedAmount`, `gatewayRefundedAmount`.
- `RefundRequest`: `reasonCode`, `description`, `entryPoint`
  (`cancellation`/`report_problem`/`admin`/`system`), `walletRefundAmount`,
  `gatewayRefundAmount` (processing-time snapshot).
- `DoctorPayout`: `refundReference`, `refundAdjustmentAmount`,
  `liabilityStatus` (`none`/`adjusted_pending`/`adjusted_settled`),
  `adjustedAt`.

No existing field was renamed, removed, or reinterpreted; no migration is
required for existing documents (defaults are `0`/`none`, backward
compatible with pre-P23 records — see "Remaining blockers" for the one
disclosed reconciliation gap this implies).

## 6. Admin refund detail — real data surfaced, none fabricated

`admin/refundAdminController.js`'s `getRefundDetail` now returns
`reasonCode`/`description`/`entryPoint` on the refund request, the real
wallet/gateway allocation split, and a `liability` block read from the
actual `DoctorPayout` document when one exists (never fabricated when none
does). This is a backend/API-level change only — no admin frontend page was
rebuilt to visualize it (see "Remaining blockers").

## 7. New route

`POST /api/refunds/report-problem/:paymentId` — the only refund-adjacent
action available to a patient once the consultation is complete. Same
ownership rule as the existing create-request route (patient can only act
on their own payment), always lands in admin review.

## 8. Tests

New `backend/tests/refundPolicyEngine.test.mjs` (9 assertions, pure-logic,
no live DB) directly reproducing the brief's Scenarios 1, 2, and 3, the
double-payout-is-now-impossible invariant, reason-category validation, and
a multi-partial-refund invariant sweep against mixed wallet/gateway
funding. Existing refund tests (`refundConcurrencyAndStateMachine.test.mjs`,
`refundAdminAttention.test.mjs`) pass unchanged.

**86/90** backend test files passing (was 85/90 before the
`completeTestPayment` boot fix recovered `errorMiddlewareWiring.test.mjs`).
Remaining 4 failures — `p12BookingAuthFlow`, `p12GeographicSearchConsistency`,
`p12Geography`, `servicePartialUpdate` — are confirmed pre-existing and
**out of P23's strict scope** (Doctor geography schema, Services admin
export mismatch; neither payment nor refund related). Not touched this
phase.

Repo-wide eslint: **0 errors** in every file this phase touched. 7
pre-existing errors remain in files outside P23's scope (finance dashboard,
i18n locale duplicate keys, a content-helper regex) — not touched,
disclosed rather than silently left.

Clean production build (`npm run build`). Clean backend boot
(ECONNREFUSED-only — no live MongoDB in this sandbox, consistent with every
prior phase). Fresh-extract gate passed: this exact deliverable zip was
extracted clean, `npm install` re-run from scratch, full suite + boot
re-verified with identical results.

## Remaining blockers — genuinely not done, not just undisclosed

- **Frontend untouched.** No patient step-workflow (Sections 31–33), no
  doctor/admin refund-workspace redesign (Sections 34–37), no
  Report-a-Problem UI wired to the new endpoint. The backend contract is
  ready for it; the UI work itself has not started.
- **Test/sandbox gateway scenario model (Section 41).** Still one global
  `TEST_PAYMENT_SCENARIO` env var, not per-`PaymentAttempt`. Not touched.
- **Payment-side (non-refund) webhook convergence audit (Sections 22/23)**
  and **payout-recovery automation** for the `adjusted_pending` liability
  state — both explicitly out of this pass; the latter has no existing
  engine to reuse and would be new functionality, not a repair.
- **Legacy data reconciliation.** Existing pre-P23 `Payment` documents with
  a non-zero `refundedAmount` but no wallet/gateway split recorded will
  read `walletRefundedAmount`/`gatewayRefundedAmount` as `0` — the new
  allocation logic still works correctly for any *new* refund against them
  (computed from remaining capacity), but a support user auditing
  *historical* splits on those specific records won't see them. No
  migration script was written for this — Section 55 says mark unclear
  legacy records `REQUIRES_RECONCILIATION` rather than guess, and guessing
  which bucket a historical refund came from would be exactly that.
- **Live E2E** (browser, real MongoDB) — unavailable in this sandbox,
  consistent with every prior phase.
- Sections 46 (dedicated concurrency test matrix beyond what's covered),
  48–51 (full enumerated test/E2E checklist), and the full 66-section Final
  Acceptance Matrix have not been run item-by-item.

## Exact changed files

- New: `backend/payments/refundPolicyEngine.js`,
  `backend/tests/refundPolicyEngine.test.mjs`
- Modified: `backend/controllers/refundController.js`,
  `backend/controllers/admin/refundAdminController.js`,
  `backend/controllers/paymentController.js` (lint only),
  `backend/payments/refundStateMachine.js`,
  `backend/payments/webhookHandler.js`,
  `backend/models/Payment.js`, `backend/models/RefundRequest.js`,
  `backend/models/DoctorPayout.js`,
  `backend/routes/refundRoutes.js`, `backend/routes/paymentRoutes.js`,
  `docs/CHANGELOG-PHASE-P23-PAYMENT-REFUND-3.0.md` (this file, rewritten)
