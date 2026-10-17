# PHASE UI-7 — Finance / Finance Operations / Invoices
## Finance Executive Command Center

## 0. Audit performed before writing code

Read and mapped, before touching anything:
- Models: `Payment`, `RefundRequest`, `Invoice`, `TransactionLedger`, `DoctorPayout`, `Wallet`, `Subscription`, `Coupon`.
- Controllers/routes: `paymentController.js` + `paymentAdminController.js` (Payments UI-5), `refundController.js` + `refundAdminController.js` (Refunds UI-6), `invoiceController.js`, `financeController.js` (coupons/subscriptions/ledger/wallet/reconciliation/payouts), `reconciliationService.js`, `paymentRetryService.js`.
- Frontend: `AdminPayments.jsx`, `AdminRefunds.jsx`, `AdminFinanceDashboard.jsx`, `FinanceHistory.jsx`, `InvoiceHistory.jsx`, `FinanceCharts.jsx`, design-system primitives (`MetricCard`, `SectionHeader`, `Tabs`, `AdminTable`, `FilterBar`, `StatusBadge`, `ErrorState`, `AdminModal`), `RealtimeContext`'s `dashboardSyncTick`.
- AI pipeline: `promptLibrary.js` / `templateProvider.js` / `generativeAssistant.js`, using the Process Governance capabilities (`governanceExplain` etc.) as the direct pattern to follow for a new, real, grounded Finance capability.
- Permissions: confirmed `manage_payments` is the correct, already-used key for all financial admin surfaces; no new permission key introduced.

### Key audit findings
1. **`AdminFinanceDashboard.jsx` duplicated Refunds UI-6 and Payments UI-5.** It called `paymentController.getFinancialSummary` (a separate, legacy aggregate: `totalEarnings`/`successRatio`/`walletBalances`/`recurringRevenue`) and re-implemented refund-approve and refund-initiate actions inline — with none of UI-6's concurrency lock, confirmation dialog, or failure-reason handling. **Fixed**: the page is now read-only executive intelligence with zero payment/refund mutation UI; every action deep-links into the workspace that actually owns it.
2. **`InvoiceHistory.jsx` was shared verbatim between `/patient/invoices` and `/admin/invoices`.** No admin-grade filtering (status/patient/doctor/amount), no drill-down, no deep links. **Fixed**: a new `AdminInvoices.jsx` + `InvoiceDetailWorkspace.jsx` for admin; the patient route and component are untouched.
3. **Self-correction during build**: an initial draft of `buildReconciliation()` reimplemented checks that already exist in `backend/payments/reconciliationService.js` (`generateReport()`, `findIncompletePayments()`, already wired to `/api/finance/reconciliation` and `/api/finance/reconciliation/repair`, and already used by the legacy `FinanceHistory.jsx`). **Fixed before shipping**: `buildReconciliation()` now composes the existing service and only adds genuinely new checks (invoice/payment amount mismatch, duplicate pending refund requests, payment status/refund amount mismatch) rather than re-deriving overlapping logic.
4. **`settleDoctorPayout` never wrote to `AdminActivityLog`**, unlike every other financial admin action (refund approve/reject/retry). Fixed additively so the Finance Activity Timeline has a real event for it.
5. **`repairIncompletePayments()` had a real backend action but no frontend wrapper.** Added to `financeApi.js`; Finance Operations' Reconciliation panel is the first real caller.
6. Confirmed `Invoice` has no due-date field and `Payment.gateway` is a constant `"razorpay"` for every record — so invoice-overdue aging and a "by payment method" breakdown are **not calculable** from this schema and were **not fabricated**. Collections aging is honestly labeled as "time since checkout started," not invoice due-date age. Revenue breakdown by collection method instead uses the real, distinct `Payment.gatewayAmount` vs `Payment.walletAmount` split.

## 1. Backend — single source of truth

**New**: `backend/services/finance/financeAggregates.js` — every Finance number traces to one of eight functions here:
- `buildFinanceOverview()` — Gross/Net Revenue, Gateway vs Wallet Collected, Refunds (amount + pending count), Outstanding, Failed, Invoice Value, Today's Collection. `gatewayAmount`/`walletAmount` are real, distinct Payment fields — not a relabeled duplicate of `totalAmount`.
- `buildFinancialHealth(overview, attentionCount)` — deterministic score: plain mean of 5 documented 0–100 factors (payment success rate, refund pressure inverted, outstanding receivables health, invoice coverage, operational attention load). Returns `score: null` (never a fabricated number) when there's no payment history yet. Every factor carries a human-readable description built from the real supplied numbers.
- `buildRevenueTrend({period, from, to})` — daily/weekly/monthly grouped from `Payment.paidAt`/`failedAt` and `RefundRequest.updatedAt`, real `$dateToString` bucketing, empty-state honest (`hasData: false`) rather than a flat fabricated line.
- `buildRevenueBreakdown()` — by doctor (top 10, real `$lookup` joins, no N+1) and by collection method (gateway vs wallet).
- `buildCollections()` — outstanding + aging buckets (0-24h/1-3d/3-7d/7d+, explicitly labeled as checkout-start age, not invoice due-date age, which this schema cannot support), failed-payment retry candidates and dead-letter count (reusing `Payment.retryCount`/`nextRetryAt`), high-value outstanding list.
- `buildReconciliation()` — reuses `reconciliationService.generateReport()`/`findIncompletePayments()` (see audit finding #3) plus three new checks. Detection only — nothing here writes to a financial record; the one real, narrowly-scoped repair action (`repairIncompletePayments`) is surfaced via a deep link/button, not duplicated.
- `buildFinanceAttentionQueue()` — imports and reuses `computePaymentAttention` (Payments UI-5) and `computeRefundAttention` (Refunds UI-6) directly rather than re-deriving "needs attention" rules, plus reconciliation issues as attention items. This is the *only* place Finance decides what needs attention.
- `buildFinanceActivityTimeline({limit})` — real `AdminActivityLog` entries (payment/refund/payout/coupon/subscription resource types) merged with real `Invoice.issuedAt` events, sorted by actual timestamp. No fabricated intermediate events.

**New**: `backend/controllers/admin/financeAdminController.js` + `backend/routes/admin/financeAdminRoutes.js`, mounted at `/api/admin/finance`, gated entirely behind `manage_payments` (existing key, no new role/permission introduced). Nine endpoints: `overview`, `health`, `revenue-trend`, `revenue-breakdown`, `collections`, `reconciliation`, `attention-queue`, `activity-timeline`, `ai/executive-summary`.

**Extended additively**: `invoiceController.js`'s `getInvoices` — added `status`/`userId` (admin/super_admin only)/`appointmentId`/`paymentId`/`minAmount`/`maxAmount`/`sortBy` query params. Every existing caller (patient `InvoiceHistory.jsx`) omits these and is unaffected; `ownershipFilter()` still hard-scopes a patient to their own `userId` regardless of what they pass.

**Fixed**: `financeController.js`'s `settleDoctorPayout` now writes a real `AdminActivityLog` entry (audit finding #4).

**AI**: new `financeExecutiveSummary` capability added through the existing pipeline — `promptLibrary.js` (instructions: FACT-then-RECOMMENDATION, never invent revenue/percentages/fraud), `templateProvider.js` (`renderFinanceExecutiveSummary`, restates only supplied real numbers), `generativeAssistant.js` (`financeExecutiveSummary(context)`, same `respond()`/`DISCLAIMERS.admin` pattern as every other admin AI capability). No new chatbot, no new provider.

## 2. Frontend

**Rewritten**: `src/pages/payment/AdminFinanceDashboard.jsx` — the Finance Executive Command Center. KPI layer (8 real metrics, each sourced from `buildFinanceOverview()`), clickable Financial Health card with a drill-down modal showing all 5 contributing factors and the documented formula, Revenue Intelligence chart (daily/weekly/monthly period selector, reuses the existing dependency-free `MiniBarChart`/`MiniDonut` from `FinanceCharts.jsx` — no charting library added), Revenue by Doctor + Collection Method breakdown, AI Executive Summary panel, and a Financial Operations Queue where every item deep-links into the Payments/Refunds/Finance-Operations workspace that owns it. Zero payment/refund mutation UI (removed per audit finding #1).

**New**: `src/pages/finance/FinanceOperations.jsx` (replaces the `/admin/finance/ops` route target, previously `FinanceHistory.jsx`) — Collections & Receivables (outstanding, aging buckets, high-value outstanding, retry-due action) and an itemized Reconciliation panel (one card per real issue type, with a "Repair Automatically" button only on the one issue type that has a real safe repair action). Reuses the existing ledger view and `retryDuePayments`/`getReconciliationReport` calls rather than dropping that functionality.

**New**: `src/pages/admin/AdminInvoices.jsx` + `src/components/admin/InvoiceDetailWorkspace.jsx` (replaces the `/admin/invoices` route target, previously the patient-shared `InvoiceHistory.jsx`) — server-side filtered/paginated invoice registry (status/billing type/search) with a tabbed detail workspace (Overview/Patient/Appointment/Payment/Timeline) that deep-links to Payment/Appointment/Patient workspaces and reuses the existing real PDF download endpoint. Patient-facing `/patient/invoices` still uses the original `InvoiceHistory.jsx`, untouched.

**Extended**: `src/api/adminApi.js` (9 new Finance methods), `src/api/financeApi.js` (added the missing `repairIncompletePayments()` wrapper for an endpoint that already existed backend-side).

**Routing**: `src/routes/AppRoutes.jsx` updated so `admin/finance/ops` → `FinanceOperations`, `admin/invoices` → `AdminInvoices`; the now-unused `FinanceHistory` lazy import was removed (component file itself left in place, no longer routed to).

**Realtime**: reused `RealtimeContext`'s existing `dashboardSyncTick` throughout — no new Socket.IO channel.

## 3. Explicitly deferred (documented, not fabricated)
- Invoice due-date-based aging — `Invoice` has no due-date field in this schema.
- A "by payment method" breakdown beyond gateway/wallet — `Payment.gateway` is a constant `"razorpay"` for every record; a real breakdown by that field would be a single trivial bucket.
- Numeric compliance/fraud scores beyond the documented 5-factor Financial Health score — Section 18 explicitly forbids labeling weak signals as "fraud."
- An admin "Create Invoice" button — no manual invoice-creation workflow exists anywhere in the backend; not fabricated.
- A second reconciliation repair mechanism — the one real, safe, idempotent repair action (`repairIncompletePayments`) is reused via a button, not duplicated or extended to auto-correct anything else.

## 4. Verification
- `node --check` clean on every new/edited backend file.
- Full backend test suite: **37/37 passing** (36 pre-existing + 1 new `financeAggregates.test.mjs`, 5 assertions covering the health-score formula's null case, perfect-100 case, a case that verifies the formula actually responds to refund/attention pressure, factor self-documentation, and the collections aging-bucket boundaries).
- `npx eslint .` (whole repo, frontend + backend): **0 errors / 0 warnings**.
- Clean server boot (`ECONNREFUSED`-only — no live MongoDB in this sandbox, same as every prior phase).
- Clean production build (`npm run build`) — `AdminFinanceDashboard`, `FinanceOperations`, and `AdminInvoices` chunks all confirmed present.
- Custom nested-interactive-button scan: **0 violations** across all 4 new/rewritten frontend files.
- Route/API duplication check: every `adminApi.js`/`financeApi.js` call verified 1:1 against a real mounted backend route; no duplicate `app.use()` mount paths found.
- Hardcoded-localhost scan: clean.
- **Explicitly NOT verified**: real browser/live-Mongo/live-Razorpay end-to-end runs (this sandbox has neither) — flagged honestly rather than claimed.
