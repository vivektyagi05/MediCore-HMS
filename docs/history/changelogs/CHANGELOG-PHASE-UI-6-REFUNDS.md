# PHASE UI-6 — Refunds Management Workspace

Real end-to-end hardening of the existing refund system (database →
payment → refund request → validation → approval/rejection → gateway →
ledger/wallet → audit → notification → admin UI), plus a rebuilt admin
workspace. Nothing pre-existing was rebuilt; only genuine gaps found by
audit were fixed.

## 1. Audit findings (before any code was written)

Full trace of the existing refund system: `RefundRequest` model,
`refundController.js`, `refundRoutes.js`, `Payment`/`Invoice`/
`TransactionLedger`/`Wallet` models, `razorpayService.js`,
`notificationEmitter.js`, `paymentEmitter.js`, `adminAudit.js`
(`writeAdminLog`), `automationEventBus.js`/`triggerRegistry.js`,
`AdminRefunds.jsx`, `PaymentDetailWorkspace.jsx`'s existing Refunds tab,
`refundApi.js`, `adminApi.js`.

**Real architecture confirmed (reused, not rebuilt):**
- `RefundRequest` lifecycle is `pending → approved → processed`, or
  `pending → rejected`, with `failed` already declared in the schema.
  Approval and gateway processing happen in a single synchronous request
  in this codebase — there is no separately-persisted "processing" state,
  and none was invented.
- `TransactionLedger` already enforces refund idempotency via a unique
  `idempotencyKey` (`refund:<gatewayRefundId>`) — reused as-is.
- `Wallet`, `Invoice` (real PDF download), and the dead-letter payment
  retry/resolve action (Monitoring Platform's
  `POST /admin/monitoring/retry-queue/:paymentId/resolve`) were already
  complete and are unchanged.
- The Payments Workspace (Phase UI-5) already surfaces a Refunds tab on
  every payment — reused and upgraded, not duplicated.

**Real gaps found (fixed in this phase):**
1. **No concurrency protection.** `approveRefundRequest` read
   `RefundRequest.status` then saved it — two concurrent approvals could
   both pass the "pending" check before either persisted. There was also
   no lock at the `Payment` level, so two refund requests against the
   same payment could both reach the Razorpay refund call before either
   updated `refundedAmount` — a genuine double-refund risk.
2. **`initiateRefund` (admin direct refund) had no duplicate-request
   guard at all**, unlike `createRefundRequest`. Two concurrent
   direct-refund clicks could create two separate "approved"
   `RefundRequest` documents against the same payment.
3. **`failed` was declared in the schema but never set anywhere.** A
   gateway failure rolled back `payment.refundStatus` but left the
   `RefundRequest` stuck at `approved` forever, with no reason recorded
   and no way to retry — a refund could vanish into a permanent limbo
   state with no visibility.
4. **Refund-mutating admin routes were gated by role only**
   (`admin`/`super_admin`), not by the `manage_payments` permission the
   rest of the financial admin surface (Payments Workspace, and the
   read-only refund registry added in this phase) already uses.
5. **`AdminRefunds.jsx`** was a 349-line, fully client-side-filtered page
   with no pagination, `window.confirm`-free but also
   confirmation-free approve/reject, no failure/retry UI, no attention
   rules, and no cross-links to Payment/Patient/Appointment workspaces.
6. **Admins had no notification when a patient requested a refund** — the
   only signal was the request appearing in the registry on next page
   load.
7. **`Invoice.status` has no "refunded"/"partially_refunded" state**
   (only `issued`/`void`) — confirmed credit-note capability genuinely
   does not exist in this schema. Not fabricated; stated honestly in the
   UI instead (see §8).

## 2. Refund state machine (unchanged states, hardened transitions)

States are exactly what the schema already declared:
`pending → approved → processed`, `pending → rejected`,
`approved/retry → failed`, `failed → approved` (retry, new).
No states were invented.

- **Per-payment pessimistic lock** (`Payment.refundLockedAt`, new field):
  an atomic `findOneAndUpdate({refundLockedAt: {$exists:false}})`
  acquired *before* the Razorpay call, released in a `finally` block.
  This is the real fix for double-refund risk — a second concurrent
  caller (whether a second approval, `initiateRefund`, or a retry) is
  rejected with a 409 *before it ever reaches the gateway*, not just
  before the DB write.
- **Atomic `RefundRequest` transitions**: approve, reject, and retry all
  use conditional `findOneAndUpdate({status: 'pending'|'failed'}, ...)`
  instead of read-then-save, so only one caller can ever win a given
  transition.
- **Server-side amount validation**: refundable amount is always
  `payment.totalAmount - payment.refundedAmount`, recomputed from a
  fresh `Payment` read taken *after* the lock is acquired — never
  trusted from the request body, never from a stale in-memory snapshot.
- **Duplicate-request guard** (`assertNoConflictingRefundRequest`) is now
  shared by both `createRefundRequest` and `initiateRefund` — a payment
  with any pending or approved `RefundRequest` cannot get a second one.

## 3. Genuine failure handling + retry (new)

- `RefundRequest.failureReason` (new field) persists the real gateway/
  system error message the moment a refund fails — never fabricated,
  cleared again on a successful retry.
- New `retryRefundRequest` action (`PATCH /api/refunds/requests/:id/retry`,
  `manage_payments`-gated): only refunds genuinely in `failed` status are
  eligible; reuses the exact same locked `processRefund` core, so a
  retry is exactly as safe as the original attempt.
- On failure, the patient is notified (`notificationEmitter`, existing
  system) and the failure is written to the admin audit log
  (`writeAdminLog`, existing system).

## 4. Notifications, automation, audit — all reused, not duplicated

- New refund request → `notificationEmitter.emitToAdmins` (existing
  `"refund"` notification type, already in `NotificationDelivery`'s
  enum — no new notification system).
- Rejection / gateway failure → `notificationEmitter.emitToUser`.
- Every mutation (approve, reject, process, retry, process-failed) →
  `writeAdminLog` (existing admin audit system).
- `REFUND_REQUESTED` / `REFUND_APPROVED` automation triggers (existing,
  from Phase A6.2.3) are still emitted at the same points; no new
  trigger types were added — not required by this phase's scope.

## 5. Permissions

`approve` / `reject` / `retry` / `initiate` on `/api/refunds/*` now
require `manage_payments` (via `requirePermission`), matching the
Payments Workspace precedent, instead of a bare admin-role check. List/
create remain role-based since patients need them for their own refund
requests — ownership is enforced inside the controllers, not by the
route gate.

## 6. New admin read surface — `/api/admin/refunds`

Mirrors `paymentAdminController.js`'s established pattern exactly.
Approve/reject/retry/initiate stay on the existing `/api/refunds`
routes; this surface only reads.

- `GET /admin/refunds` — server-side search/filter (status, date range,
  amount range, patient, payment, doctor, appointment, attention) +
  pagination. No client-side collection loaded.
- `GET /admin/refunds/summary` — real aggregates only: total requests,
  pending/approved/completed/rejected/failed counts and amounts, amount
  awaiting processing, and a `needsAttentionCount` computed by running
  the exact same `computeRefundAttention` rule the list uses (never a
  separately-invented count).
- `GET /admin/refunds/:id` — full detail aggregate: refund request,
  payment, patient, doctor, appointment, invoice (with an honest
  `creditNoteAvailable: false` rather than a fabricated download
  button), other refund requests on the same payment, financial impact
  (before/after remaining refundable amount), and a timeline built
  *only* from `RefundRequest.timeline`'s real stored timestamps.

**Attention rule** (`computeRefundAttention`, pure function, unit
tested): a refund needs attention if — (1) it genuinely failed at the
gateway (real reason surfaced, or an honest generic message if none was
recorded); (2) it has been pending admin review for more than 2 hours
(the same threshold already established for Payments' "stuck order"
rule — reused, not reinvented); (3) it has failed more than once. All
three read fields that actually exist; nothing is a fabricated score.

Gated behind `manage_payments` — same permission key as the Payments
Workspace and the mutating refund routes, no new key introduced.

## 7. Frontend

- **`RefundActionDialog.jsx`** (new, shared): the one confirmation UI for
  approve/reject/retry across the whole app — used by
  `PaymentDetailWorkspace`'s Refunds tab, `RefundDetailWorkspace`, and
  reachable from the registry. Approve shows the real amount and the
  real remaining-refundable-after-approval figure (brief §13); reject
  requires a real reason (brief §14); retry surfaces the real previous
  failure reason and states plainly that no refund has been confirmed
  yet (brief §16).
- **`RefundDetailWorkspace.jsx`** (new): Overview / Payment / Patient /
  Appointment / Financial Impact / Timeline tabs, following
  `AppointmentDetailWorkspace.jsx` / `PaymentDetailWorkspace.jsx` as
  direct templates. Links out to the existing Payment/Patient/
  Appointment workspaces rather than re-rendering their internals.
- **`AdminRefunds.jsx`** — full rewrite on `SectionHeader` / `MetricCard`
  / `FilterBar` / `AdminTable` / `AdminModal` primitives (no new UI
  primitives introduced), server-side pagination/filtering, a real KPI
  strip, attention badges, and `dashboardSyncTick` realtime refresh —
  replacing the old fully-client-side-filtered page.
- **`PaymentDetailWorkspace.jsx`** — Refunds tab upgraded in place to use
  the shared `RefundActionDialog` (previously called `approve`/`reject`
  directly with no confirmation), added a Retry action and a visible
  failure-reason banner for `failed` refunds. No structural changes to
  the other tabs.
- **`paymentTransactionStatusDisplay.js`** — added
  `REFUND_REQUEST_STATUS_LABELS` / `refundRequestStatusLabel` (a label
  map was missing; only a tone map existed, so raw status strings had
  been rendered directly in the old `AdminRefunds.jsx`).
- `refundApi.js` — added `retryRequest`. `adminApi.js` — added
  `getRefundsAdmin` / `getRefundSummaryAdmin` / `getRefundDetailAdmin`.

## 8. Invoice / credit-note honesty

`Invoice.status` genuinely has no refunded/partially-refunded state in
this schema. Rather than fabricate one or add a dead "credit note"
button, the Financial Impact tab states plainly that the payment record
(`refundedAmount`/`refundStatus`) is the authoritative source of the
refund's financial state, and that credit-note capability is not
available.

## 9. Deliberately deferred (documented, not faked)

- **Admin "initiate a new refund" UI** — the `initiateRefund` API
  existed already and is now hardened, but no button was added to
  trigger it from the registry or Payment workspace; today refund
  requests originate from patients or the raw API. Adding this UI was
  out of this phase's audit-driven scope and would need its own
  confirmation/authorization design.
- **Separate reviewer/approver roles** — the `Permission` model is
  role-level only (no reviewer/approver granularity), same constraint
  documented in the A6.3.5 process-governance phase. Segregation of
  duties, where it matters, is enforced by actor identity, not by
  inventing new roles.
- **New automation trigger types** for rejected/processed/failed — the
  existing `REFUND_REQUESTED`/`REFUND_APPROVED` triggers are reused;
  adding more trigger types was not required by this phase's brief.
- **Credit note generation** — genuinely does not exist (see §8);
  not fabricated.

## 10. Testing

New tests, both dependency-free (no live Mongo needed):
- `refundAdminAttention.test.mjs` (7 assertions) — locks in
  `computeRefundAttention`'s real, documented rule: failed refunds
  flagged with their real reason (or an honest generic one), stuck
  pending-approval after 2h, repeated failures, and that healthy/
  approved refunds are never flagged.
- `refundConcurrencyAndStateMachine.test.mjs` — reproduces the exact
  guards shipped in `refundController.js` (per-payment lock, atomic
  status transition, over-refund bound, duplicate-request guard)
  against a tiny in-memory fake store, following the same
  isolation-testing pattern as the pre-existing
  `couponIdempotency.test.mjs`.

**36/36 backend tests passing** (34 pre-existing, unchanged + 2 new).

## 11. Verification

- `node --check` clean on every backend file.
- Clean server boot: `ECONNREFUSED`-only (no live MongoDB in this
  sandbox — same as every prior phase), full route/import graph
  (including the new admin refund controller/routes) loads without
  error.
- `node tests/run-all.mjs` — 36/36 passing.
- `npx eslint .` (whole repo, frontend + backend) — 0 errors, 0
  warnings.
- `npm run build` — clean production build, `AdminRefunds` chunk
  confirmed (13.59 kB / 4.24 kB gzip), full route tree intact.
- Heuristic nested-interactive-element scan on all new/edited frontend
  files — clean.
- Duplication scan — exactly one refund controller
  (`refundController.js`) and one route file (`refundRoutes.js`) for
  mutations; the new `refundAdminController.js`/`refundAdminRoutes.js`
  is read-only and additive, matching the existing
  `paymentAdminController.js`/`paymentAdminRoutes.js` split. No
  `RefundEngine2`/`RefundServiceV2`-style duplicates anywhere.
- Hardcoded-localhost scan — clean (only the pre-existing dev-fallback
  in `src/api/axios.js`).
- Regression: full pre-existing test suite passes unchanged; Payments,
  Appointments, Patients, Invoice, and Finance surfaces were not
  touched except the one in-place upgrade to `PaymentDetailWorkspace`'s
  Refunds tab described in §7.

**Explicitly NOT verified** (sandbox has neither): a real browser
session, a live MongoDB instance, or a live Razorpay sandbox refund
call. No refund was claimed as genuinely processed against Razorpay —
only the code paths, state machine, and locking logic were verified.

## 12. Files touched

**Backend (new):** `controllers/admin/refundAdminController.js`,
`routes/admin/refundAdminRoutes.js`,
`tests/refundAdminAttention.test.mjs`,
`tests/refundConcurrencyAndStateMachine.test.mjs`.
**Backend (edited):** `controllers/refundController.js` (full
rewrite — hardened state machine), `routes/refundRoutes.js`
(permission gating + retry route), `models/RefundRequest.js`
(+`failureReason`), `models/Payment.js` (+`refundLockedAt`),
`app.js` (mount new route).
**Frontend (new):** `components/admin/RefundActionDialog.jsx`,
`components/admin/RefundDetailWorkspace.jsx`.
**Frontend (edited):** `pages/admin/AdminRefunds.jsx` (full rewrite),
`components/admin/PaymentDetailWorkspace.jsx` (Refunds tab upgrade),
`utils/paymentTransactionStatusDisplay.js` (+label map),
`api/refundApi.js` (+`retryRequest`), `api/adminApi.js`
(+3 read methods).
