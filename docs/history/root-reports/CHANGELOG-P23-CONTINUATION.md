# MediCore HMS — P23 Payment + Refund 3.0 — CONTINUATION PASS

Continuation of the prior P23 backend-only pass. This pass closes the
biggest disclosed gap from that pass: zero frontend integration, plus a
completely missing withdrawal domain and a real balance-calculation bug
found during this pass's audit.

## Audit finding fixed
`buildDoctorRevenueIntelligence()` reported `withdrawableBalance` as equal
to **pending** (unsettled) payouts — money the platform has not yet
settled to the doctor at all. Replaced with a canonical
`computeDoctorWithdrawableBalance()` based on **settled ("paid")**
payouts minus outstanding refund liability minus already-withdrawn minus
currently-active withdrawal holds. This is the exact Section 18/19
mistake the brief warned against, caught by re-deriving the figure
independently rather than trusting the existing label.

## Backend — new/changed
- `paymentController.js`: `getPaymentStatus` (recovery-by-appointment,
  pure read) and `retryPayment` (new PaymentAttempt on the SAME Payment,
  never a duplicate Payment doc). Added the legal
  `failed/expired -> order_created` hop to `paymentStateMachine.js` so
  retry goes through the canonical transition function, not a raw
  assignment.
- `refundController.js`: `getRefundEligibility` (drives real Case
  A/B/C/D branching in the frontend instead of the frontend guessing from
  payment status) and `getRefundRequestDetail` (patient-facing tracker:
  safe-labeled timeline + funding split, internal state names never
  exposed).
- New withdrawal domain (Section 22 — did not exist at all before this
  pass): `models/Withdrawal.js`, `payments/withdrawalStateMachine.js`,
  `services/finance/withdrawalService.js` (canonical balance calc +
  atomic reserve-with-recheck concurrency guard — no Mongo
  transactions/replica set available in this sandbox, same documented
  constraint as PHASE P10's `claimFollowUpSlot`),
  `controllers/doctor/doctorWithdrawalController.js`,
  `controllers/admin/withdrawalAdminController.js`, routes mounted in
  `doctorRoutes.js` and `app.js` (`/api/admin/withdrawals`).
- Withdrawal min/max/daily limits are read from env config
  (`DOCTOR_WITHDRAWAL_MIN_AMOUNT` etc.) with a functional (not fabricated
  business) floor of 1, per Section 24's explicit instruction not to
  invent numbers.

## Frontend — new/changed
- `PaymentCheckout.jsx`: real recovery-on-load via `getPaymentStatus`
  (SUCCESS / PENDING / FAILED / REQUIRES_RECONCILIATION branches, each
  with an honest, distinct message — never "Payment failed" before the
  backend says so), real retry via the new endpoint, and a
  Total/Wallet/Gateway breakdown card (Section 8).
- `PatientPayments.jsx` + new `RefundActionModal.jsx`: replaced the real
  bug found in this pass's audit — a single hardcoded "Request refund"
  button shown for both an eligible cancellation AND a completed
  consultation (Case A and Case B were visually identical, contradicting
  Section 10's explicit requirement). The button now opens a modal that
  fetches the backend's eligibility decision first and renders exactly
  one of: eligible-refund form, report-a-problem wizard, existing-request
  tracker, or a plain "not eligible" explanation — never a client-side
  re-derivation of the eligibility rule.
- New `DoctorWithdrawalPanel.jsx`, wired into `DoctorEarnings.jsx`:
  available/pending/liability/already-withdrawn metrics, request →
  review → confirm flow, real withdrawal history, honest failure display
  (never a fake success state).
- New `AdminWithdrawals.jsx` admin workspace (Section 28): action buttons
  are gated per-row to only the transitions actually valid from that
  row's current status (mirrors `withdrawalStateMachine.js`'s transition
  table) — no arbitrary status dropdown. Wired into `AppRoutes.jsx` and
  the sidebar nav under Finance.
- New API clients: `withdrawalApi.js` (doctor + admin), extensions to
  `paymentApi.js` (`getStatus`, `retry`) and `refundApi.js`
  (`getEligibility`, `getDetail`, `reportProblem`).

## Verification (fresh-extract gate — clean unzip, full reinstall, rerun)
- `node --check` on every touched/new backend file: clean
- Backend boot: ECONNREFUSED-only (no live MongoDB in this sandbox,
  consistent with every prior phase)
- Backend suite: 86/90 passing — same 4 pre-existing failures as the
  prior pass's baseline (`p12BookingAuthFlow`, `p12GeographicSearchConsistency`,
  `p12Geography`, `servicePartialUpdate` — Doctor geography schema /
  Services admin export mismatch), no new failures introduced
- Repo-wide eslint: same 7 pre-existing errors in untouched files
  (`financeController.js`, `contentHelpers.js`, three i18n locale
  duplicate-key files) — zero new errors in any file this pass touched
- Frontend production build (`vite build`): clean

## Explicitly NOT done this pass (disclosed, not claimed complete)
- No live browser/Mongo E2E (unavailable in this sandbox, as every prior
  phase notes)
- Vitest suite (`api.test.js`) still unrunnable here
  (mongodb-memory-server can't download its binary — network-restricted)
- Reusable cross-workflow `FinancialTimeline` component (Section 36) —
  the refund tracker and payment breakdown were built as
  purpose-specific views, not yet unified into one shared component
- Admin "Recovery Center" dashboard (Section 35) surfacing all
  reconciliation-required records in one place — not built; the
  underlying reconciliation states exist and are queryable but have no
  dedicated admin screen yet
- Wallet recharge duplicate-webhook/duplicate-verification hardening
  (Section 9) — not audited this pass
- Payment webhook/frontend-verification convergence audit (Section 32) —
  not repeated this pass (was already flagged not-done in the prior
  pass's disclosure)
- No legacy-data reconciliation migration for pre-P23 payments/refunds
  missing a wallet/gateway split (same disclosure as the prior pass)
- Full 66-section Final Acceptance Matrix not run item-by-item — this
  pass targeted the highest-priority named gaps (frontend integration,
  withdrawal domain, Case A/B refund bug), not an exhaustive sweep of
  every section in the brief
