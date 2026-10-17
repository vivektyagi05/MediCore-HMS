# PHASE UI-5 — Payments Management Workspace

## Audit findings (before writing any code)

- **Payment model** (`backend/models/Payment.js`) already has a real state
  machine: `created → pending → captured → failed → refunded /
  partially_refunded`, plus `refundStatus` (`none/pending/partial/full/failed`),
  retry fields (`retryCount`, `nextRetryAt`, `failedAt`), and the A6.2.4
  dead-letter fields (`retryResolvedAt`, `retryResolvedBy`). **There is no
  failure-reason / gateway-error-code field anywhere in this schema** — so
  the UI states "Failure reason unavailable from gateway response" rather
  than inventing one (Section 9 of the brief).
- **Refund engine** (`refundController.js` + `refundRoutes.js`) is complete:
  request → approve/reject → gateway refund → wallet credit → timeline.
  **Not rebuilt.** The new workspace's Refunds tab reads real
  `RefundRequest` documents and its Approve/Reject buttons call the exact
  same `refundApi.approveRequest` / `rejectRequest` the standalone Refund
  Operations page (`AdminRefunds.jsx`) already uses.
- **Invoice engine** (`invoiceController.js`) already has a real PDF
  download (`res.download`). **Not rebuilt.** The workspace's Invoice tab
  calls the existing `invoiceApi.downloadInvoice`.
- **Retry / dead-letter intelligence already exists** in the Enterprise
  Monitoring Platform (`backend/monitoring/monitoringAggregates.js`'s
  `buildPaymentRetryQueue()`, and
  `POST /api/admin/monitoring/retry-queue/:paymentId/resolve`, already
  wrapped by `monitoringApi.resolveDeadLetterPayment()` on the frontend).
  **Not rebuilt.** The new Payment Detail Workspace's "Mark Reviewed"
  action calls this exact same endpoint — no second retry/resolve system.
- **No admin-only Payments endpoint existed.** `getPayments` /
  `getFinancialSummary` / `getPaymentAnalytics` (`paymentController.js`)
  are shared patient/admin endpoints not built for a filterable registry +
  detail workspace + real KPI strip. This was the genuine gap.
- **Legacy `AdminPayments.jsx`** loaded a flat `limit: 100` list and
  filtered/searched entirely in the browser, had no pagination, and its
  "Top Doctors Revenue" widget silently truncated to whatever fit in one
  page load — replaced.
- Confirmed `manage_payments` already exists as a Permission key and is
  used the same way by `doctorAdminController.js` (earnings),
  `patientAdminController.js`, and `appointmentAdminController.js` — no new
  permission key introduced.
- Confirmed `/admin/payments` route and sidebar nav entry already exist
  (`src/config/navigation.js`) — rebuilt `AdminPayments.jsx` in place,
  added no new route.
- Found a **pre-existing, out-of-scope duplication** not introduced by
  this phase: `paymentApi.js` already had its own `approveRefund` /
  `rejectRefund` methods duplicating `refundApi.js`, and a separate legacy
  page (`AdminFinanceDashboard.jsx` at `/admin/finance`) already
  overlapped with `AdminPayments.jsx`/`AdminRefunds.jsx`. Left both
  untouched — out of this phase's scope and a regression risk to touch
  without being asked; noted here per the "don't hide incomplete work"
  rule.

## Backend — additive only

- **New `backend/controllers/admin/paymentAdminController.js`**:
  - `listPaymentsAdmin` — server-side filter/search/sort/pagination
    (status, refundStatus, doctorId, patientId, appointmentId, date range,
    amount range, free-text search resolved against patient/doctor names
    and gateway order/payment IDs) + per-row `needsAttention`/
    `attentionReasons`. No in-browser filtering of a full collection.
  - `getPaymentSummaryAdmin` — Executive Payment Overview: one aggregation
    pipeline per metric group (status-bucket counts/amounts, today's
    payments/collection, refunds awaiting review, dead-letter count,
    refunded-today, and a deduplicated `needsAttentionCount` that reuses
    the exact same match condition as the list filter — never a separate
    invented number).
  - `getPaymentDetailAdmin` — Payment Detail Workspace aggregate: real
    patient/doctor/appointment/invoice/refund-request data, plus a
    timeline built **only** from real stored timestamps
    (`createdAt`/`paidAt`/`failedAt`/`retryResolvedAt`/refund-request
    timeline entries/invoice `issuedAt`).
  - `computePaymentAttention` — the real, documented "needs attention"
    rule, exported as a pure function so it has a dependency-free test and
    so the list/summary/detail endpoints all compute attention identically
    (one source of truth, not three).
- **New `backend/routes/admin/paymentAdminRoutes.js`** — `GET /summary`,
  `GET /`, `GET /:id`, all gated behind `requirePermission("manage_payments")`
  for the whole surface (unlike Appointments/Patients, financial
  transaction data *is* the entire subject of this workspace — there's no
  meaningful non-financial partial view to build). No lifecycle-mutating
  routes were added here; refund/invoice mutations stay on their existing
  routers.
- **`backend/app.js`** — one new import + one new `app.use("/api/admin/payments", ...)` mount line. Nothing else touched.

## Frontend — additive + one page rewrite

- **`src/api/adminApi.js`** — added `getPaymentsAdmin` /
  `getPaymentSummaryAdmin` / `getPaymentDetailAdmin`. Order
  creation/verification stays on `paymentApi`; refund actions stay on
  `refundApi`; invoice download stays on `invoiceApi` — all reused as-is
  from the new components.
- **New `src/utils/paymentTransactionStatusDisplay.js`** — single source
  for `Payment.status`/`refundStatus` label+tone maps (a different,
  more granular vocabulary than `Appointment.paymentStatus`, which
  `appointmentStatusDisplay.js` already owns — kept separate rather than
  conflating the two enums).
- **New `src/components/admin/PaymentDetailWorkspace.jsx`** — Overview /
  Patient / Appointment / Transaction / Refunds / Invoice / Timeline tabs,
  following the exact `AppointmentDetailWorkspace.jsx` template (`Tabs` +
  `MetricCard` + `StatusBadge` primitives). Cross-links to the Patient
  Workspace (`/admin/patients?search=<patientId>` — the existing patient
  search filter already resolves a valid ObjectId directly) and the
  Appointment Operations Workspace (`/admin/appointments?patientId=<id>`,
  the existing filter). No `PaymentPatient.jsx`/`PaymentAppointment.jsx`
  duplicate pages were created. Real actions only: refund
  approve/reject (existing engine), invoice download (existing engine),
  dead-letter "Mark Reviewed" (existing Monitoring Platform endpoint) —
  gated with a `ConfirmDialog`. No fake "Retry Payment" button: retryable
  failed payments show the real scheduled `nextRetryAt` from
  `paymentRetryService.js` with an honest note that no manual retry path
  exists.
- **Rewrote `src/pages/admin/AdminPayments.jsx`** on the established
  workspace pattern (`SectionHeader` + clickable `MetricCard` KPI strip +
  `FilterBar`/`Select` + `AdminTable` + `AdminModal` housing
  `PaymentDetailWorkspace`), following `AdminAppointments.jsx` as the
  direct template, including `useRealtime()`'s `dashboardSyncTick` for
  live refresh and `useSearchParams` for filter state. Replaces the old
  version's full-collection browser-side filtering and its unexplained
  "Top Doctors Revenue" widget (which was silently capped by the flat
  100-record load — removed rather than carried forward broken).

## Permissions

- Entire `/api/admin/payments/*` surface requires `manage_payments`
  (existing key, existing pattern). An admin without it sees a real
  `ErrorState` explaining exactly what's missing — never a silently empty
  or partially-faked page.
- The dead-letter "Mark Reviewed" action reuses the Monitoring Platform's
  existing gate (`manage_settings`, not `manage_payments`) — if an admin
  has payments access but not settings access, the action call fails with
  the real 403 from that endpoint and a toast surfaces it; no new
  permission key was invented to paper over the mismatch.

## Error handling / realtime

- Every load path (list, summary, detail) uses `getApiErrorMessage()` and
  renders a real `ErrorState`/toast with the backend's actual message —
  no raw Axios/Mongo errors, no silent hangs.
- List and summary both refresh on `dashboardSyncTick` (existing
  `RealtimeContext` pattern) — no new socket/polling system.

## Tests / verification

- **34/34 backend tests passing** (33 pre-existing + 1 new:
  `paymentAdminAttention.test.mjs`, 9 assertions covering: retryable vs
  dead-letter wording, already-reviewed payments not re-flagged, pending
  refund requests flagging an otherwise-healthy payment, stuck-checkout
  threshold behavior at both sides of the 2h boundary, and a healthy
  payment never being flagged).
- `node --check` clean on every backend `.js` file in the repository.
- Clean server boot (`node server.js` with dummy env vars) — only error is
  the expected `ECONNREFUSED` from no live MongoDB in this sandbox, same
  as every prior phase.
- `npx eslint .` (whole repo, frontend + backend) — 0 errors, 0 warnings.
- Clean `npm run build` — `AdminPayments` chunk confirmed present
  (18.91 kB), no build errors.
- Custom nested-interactive-element scan (button-in-button /
  Link-in-button, etc.) on both new/rewritten frontend files — 0
  violations.
- Route-mount duplication check (`app.js`) — one mount only.
- Hardcoded-`localhost` scan on all new/changed files — clean.

## Explicitly deferred / NOT IMPLEMENTED (not fabricated)

- **Per-payment failure reason / gateway error code** — `Payment` model
  has no such field. The UI states this honestly rather than inventing a
  reason.
- **Manual "Retry Payment" button** — `paymentRetryService.js` only
  exposes an automatic cron-scheduled retry
  (`backend/cron/retryFailedPayments.js`); there is no on-demand
  gateway-retry endpoint anywhere in this backend. The workspace shows the
  real scheduled `nextRetryAt` instead of a dead button.
- **Payment method breakdown (card/UPI/netbanking, etc.)** — Razorpay
  order/payment metadata for this is not persisted on the `Payment`
  document (only `gateway: "razorpay"` and IDs are stored), so no
  method-level filter or column was added.
- **A second, payments-specific "attention" number set apart from the
  Monitoring Platform's dead-letter count** — `needsAttentionCount` on the
  summary and the dead-letter count are reported as two distinct, honestly
  labeled real numbers rather than merged into one potentially-confusing
  total.

## Regression check

- Services / Doctors / Patients / Appointment Operations workspaces: not
  touched.
- Existing Refund Operations page (`AdminRefunds.jsx`), Invoice Center,
  Finance dashboard (`/admin/finance`), and Monitoring Platform: not
  touched (read-only reuse of their APIs only).
- Existing `/api/payments`, `/api/refunds`, `/api/invoices` routers:
  untouched.
- `Payment`, `RefundRequest`, `Invoice` schemas: untouched (read-only).
