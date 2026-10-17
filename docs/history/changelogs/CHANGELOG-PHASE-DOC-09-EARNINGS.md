# PHASE DOC-09 — Doctor Earnings / Financial Control Center

## 1. Real problem
A doctor's Earnings page could only answer "what's my one revenue number?" —
it couldn't distinguish what was *earned* (payout attribution) from what was
*collected* (actual patient payment), had no attention/exception surface, no
reconciliation visibility, no real invoice access, and its payout list loaded
a doctor's **entire, unbounded** payout history into the browser on every
page load to do client-side search/filter — a genuine, worsening scale bug.

## 2. Audit findings (before writing any code)
Traced the full chain `Appointment → Payment → Invoice → RefundRequest →
DoctorPayout` and every consumer of `buildDoctorRevenueIntelligence()`
(Business Overview, the admin doctor-detail financial tab, and the AI
Revenue Insights prompt template) via source grep before changing anything.

| Area | Classification | Finding |
|---|---|---|
| `buildDoctorRevenueIntelligence()` totals | B (real but incomplete/unscaled) | Correct math, but built by loading full `DoctorPayout`/`Payment`/`Invoice` document sets into memory — unbounded growth. |
| Payout list (search/filter/pagination) | E (misleading at scale) | Reused the same unbounded array; all filtering happened in a React `useMemo` client-side. |
| "Total Earnings" label | E (misleading) | Presented payout attribution as if it were the only meaningful number — no separate "collected from patients" figure existed anywhere. |
| Financial Attention | D (missing) | No WHAT/WHY/ACTION surface existed for a doctor's own payment/refund/payout exceptions. |
| Reconciliation | D (missing) | No doctor-scoped health readout existed; the only reconciliation logic (`reconciliationService.js`) is admin-global and does an N+1 pass unsuitable to expose per-doctor. |
| Income forecast | E (misleading) | With <3 months of history it silently fell back to a single month's actual, presented with the same "forecast" label as a real projection. |
| Invoice access | D (missing) | Doctors had **no** real invoice endpoint at all — `invoiceRoutes.js` only permitted ADMIN/SUPER_ADMIN/PATIENT, so the old page instead hand-rolled an unbounded `Invoice.find({ doctorId }).limit(200)` inline. |
| Custom date range / period comparison | D (missing) | Only fixed quick-select periods existed (correctly, server-computed) — no custom range, no period-over-period comparison. |

## 3. Genuine gaps found (scope actually implemented)
1. **Payout scale bug** — the reported, root-cause issue.
2. **Earned vs. Collected conflation** — no real data existed to tell them apart to a doctor.
3. **No Financial Attention surface.**
4. **No doctor-scoped Reconciliation surface.**
5. **Forecast dishonesty** with sparse history.
6. **No real invoice access for doctors.**
7. **No custom date range / period comparison.**

## 4. Implemented

### Backend
- **`backend/services/finance/doctorFinanceHelpers.js`** (new, pure,
  dependency-free): `resolvePageFromIndex()` (payout deep-link page math)
  and `computeIncomeForecast()` (honest forecast basis — returns `null`
  rather than a fabricated number under 2 complete months of history).
- **`backend/controllers/doctor/doctorEarningsController.js`** (rewritten):
  - `buildDoctorRevenueIntelligence()` now uses **MongoDB aggregation**
    (`$facet`, `$group`, `$dateToString`) instead of loading full
    `DoctorPayout`/`Payment`/`Invoice` document sets — fixes the scale bug
    at its root, the shared source every consumer reads from. Every
    previously-returned field (`totalEarnings`, `settledEarnings`,
    `pendingEarnings`, `monthlyEarnings`, `upcomingPayout`,
    `incomeForecast`, `monthlyTrend`, `platformFees`, `totalTax`,
    `totalRefunded`, `totalPayouts`, `withdrawableBalance`, and the
    today/weekly/quarterly/yearly variants) is unchanged in name and
    meaning — verified via grep that Business Overview, the admin
    doctor-detail tab, and the AI template all still get exactly what they
    read before. Dropped the unused `payouts` / `settlementHistory` /
    `invoices` array fields (grep-confirmed zero consumers besides the old
    frontend, which this phase rewrites) and added `collectedAmount` (real
    `Payment` capture total, doctor-scoped) plus honest
    `incomeForecastBasisMonths`.
  - `getDoctorPayouts` (new endpoint, `GET /doctors/payouts`): real
    server-side pagination/search/status-filter, doctorId resolved from
    the authenticated user (never trusted from the client). Preserves
    Smart Inbox's existing `/doctor/earnings?payoutId=...` deep link — when
    `payoutId` is supplied, the target payout's page is resolved with a
    single bounded `countDocuments()` call (never a full scan), then that
    exact page is returned with filters cleared, matching the old
    frontend's own "clear filters once found" behavior.
  - `buildDoctorFinancialAttention` / `getDoctorFinancialAttention` (new):
    WHAT/WHY/ACTION items, **reusing** the existing admin
    `computePaymentAttention` and `computeRefundAttention` pure functions
    (not reimplemented), scoped to one doctor's own `Payment`/`RefundRequest`
    records via `doctorId`, plus a bounded (not N+1) doctor-scoped
    "captured payment missing its payout" check.
  - `getDoctorReconciliation` (new): Healthy / "N records need review",
    built by filtering the *same* attention data above rather than a
    second reconciliation engine.
  - `getDoctorFinancialPosition` (new): custom `from`/`to` range with an
    automatically equal-length "previous period" comparison (e.g. Aug 1–29
    vs. Jul 1–29, never a partial-vs-full-month mismatch), computed via
    bounded, date-scoped aggregation.
- **`backend/routes/doctorRoutes.js`**: wired the four new endpoints, all
  `protect` + `authorizeRoles(ROLES.DOCTOR)`.
- **`backend/controllers/invoiceController.js` / `backend/routes/invoiceRoutes.js`**:
  extended the *existing* invoice engine's `ownershipFilter()` to also
  recognize a `DOCTOR` caller (scoped to their own `doctorId`, resolved
  server-side) instead of building a second invoice listing anywhere.
  Added `ROLES.DOCTOR` to all four invoice routes. **Security fix made
  necessary by this change**: `getInvoices` previously let *any* caller
  override the query's `doctorId` via `?doctorId=`; that was harmless when
  only patients (scoped by `userId`) and admins could call it, but would
  have let a doctor widen their own new doctor-scoped view to any other
  doctor's invoices — now gated to admin-only, mirroring the existing
  `userId` override's admin-only gate right next to it.
- **`backend/ai/providers/templateProvider.js`**: `renderRevenueInsights()`
  additively mentions the real `collectedAmount` (when present) alongside
  earned/pending/refunded, and states "not enough settled-payout history
  yet" instead of a forecast number when `incomeForecast` is `null` — same
  grounded-only, non-fabricating discipline, just reading two more real
  fields off the same builder's output.

### Frontend
- **`src/pages/doctor/DoctorEarnings.jsx`** (rewritten) — IA per the
  brief's hierarchy: Header → Period Control (quick-select + new Custom
  Range with previous-period comparison) → Financial Position (Earned /
  Collected / Pending / Refunded / Settled, each precisely labeled and
  sourced) → Financial Attention (WHAT/WHY/ACTION cards, independent
  loading/error/empty state) → Revenue Trend (relabeled "Doctor Payout
  Earnings — Monthly Trend (settled)", not "Revenue") → tax/fee/upcoming-
  payout/forecast breakdown (forecast card shows "not enough settlement
  history yet" instead of ₹0 or a fake number) → Reconciliation
  (Healthy / Needs Review, drill-down) → AI Revenue Insights → real
  server-paginated Payout History (search + status filter; highlighted row
  + auto-scroll for the resolved deep-linked payout) → Invoices (now real
  data via the existing `invoiceApi`, bounded to 10, instead of the old
  inline unbounded fetch).
- **`src/api/doctorApi.js`**: added `getPayouts`, `getFinancialAttention`,
  `getReconciliation`, `getFinancialPosition` wrappers.

## 5. Existing systems reused (not rebuilt)
- `computePaymentAttention` / `computeRefundAttention` (admin attention
  rules) — imported directly, not duplicated.
- The existing invoice engine (`invoiceController.js`'s pagination/search/
  sort, `Invoice` model, `invoiceApi.js`) — extended with one more
  ownership scope, not replaced.
- `Doctor`/`Payment`/`DoctorPayout`/`RefundRequest` models — unchanged.
- `clampPagination` / `buildPaginationMeta` (shared pagination utility) —
  reused for the new payout list endpoint instead of the ad-hoc
  `getPagination` some admin controllers redefine locally.
- `Card` / `MetricCard` / `EmptyState` / `ErrorState` / `Skeleton` / `Badge`
  / `Button` / `MiniBarChart` / `BusinessIntelligenceNav` / `AIDraftPanel` —
  all reused as-is, zero new visual primitives.
- The doctor Appointments page's existing `?highlight=` deep-link consumer
  (built in phase P3) — Financial Attention items that concern a specific
  appointment link there rather than to any admin-only page the doctor
  cannot open.

## 6. Business rules preserved
- Payout/payment/refund state machines, capture/refund/settlement logic —
  untouched; this phase only reads them.
- Smart Inbox's `/doctor/earnings?payoutId=...` deep link contract.
- `buildDoctorRevenueIntelligence()`'s field names/semantics for every
  existing consumer (Business Overview, admin doctor-detail tab, AI
  template).
- Doctor identity is always resolved server-side from `req.user._id` via
  `Doctor.findOne({ userId })` — never trusted from the client, on every
  new endpoint.

## 7. Files changed
- `backend/services/finance/doctorFinanceHelpers.js` (new)
- `backend/controllers/doctor/doctorEarningsController.js` (rewritten)
- `backend/routes/doctorRoutes.js`
- `backend/controllers/invoiceController.js`
- `backend/routes/invoiceRoutes.js`
- `backend/ai/providers/templateProvider.js`
- `backend/tests/doctorFinanceHelpers.test.mjs` (new)
- `src/pages/doctor/DoctorEarnings.jsx` (rewritten)
- `src/api/doctorApi.js`
- `docs/CHANGELOG-PHASE-DOC-09-EARNINGS.md` (new, this file)

## 8. Not implemented + why
- **Full week/day-bucketed custom range charting** — the new Financial
  Position custom-range comparison returns totals + % change, not a
  re-bucketed trend chart for arbitrary ranges; the existing 6-month
  `monthlyTrend` chart was judged sufficient and building a second,
  range-aware charting path wasn't justified by the audit.
- **Withdrawal system** (bank transfer/UPI payout requests) — no backend
  withdrawal engine exists anywhere in the codebase; the card explicitly
  discloses "Coming Soon" rather than fabricating a flow.
- **Admin-page deep-links from Financial Attention items** — a doctor has
  no route access to `/admin/payments` or `/admin/refunds`, so items whose
  underlying record needs an admin action are surfaced with an
  informational (non-clickable) action rather than a dead or unauthorized
  link.
- **Live MongoDB/browser E2E** — unavailable in this sandbox, consistent
  with every prior phase; verified via the full non-DB test suite, a clean
  boot-to-ECONNREFUSED check, and structural/source review instead.

## 9. Security check
- Every new endpoint resolves `doctorId` from the authenticated session,
  never from client input.
- Fixed a real IDOR risk introduced by naive extension of `ownershipFilter`
  (client-suppliable `?doctorId=` on `GET /invoices`) before it could ship —
  gated to admin-only.
- Financial Attention/Reconciliation queries are `doctorId`-scoped end to
  end (Payment → RefundRequest via a `paymentId` `$in` derived from that
  doctor's own payments only; DoctorPayout coverage check the same way).

## 10. Performance check
- `buildDoctorRevenueIntelligence()`: was `O(all payouts + all payments +
  200 invoices)` documents loaded into Node memory; now `O(1)` bounded
  aggregation queries (indexes already exist on `doctorId`/`createdAt`/
  `status`) plus one `.limit(30)` timeline query.
- Payout list: was the entire history downloaded to the browser; now
  `.skip().limit()` server-side, default page size 20 (via
  `clampPagination`), max 100.
- Financial Attention's payout/payment mismatch check: bounded to one
  doctor's own captured payments (`.limit(200)`) with a single `distinct()`
  set comparison — not the admin-global reconciliation service's N+1 loop.

## 11. Test results
`node backend/tests/run-all.mjs` → **67 passed, 0 failed** (66 pre-existing
+ 1 new: `doctorFinanceHelpers.test.mjs`, 9 assertions covering payout
page-resolution math and income-forecast-basis honesty).

## 12. Build / Lint / Boot
- `node --check` on every backend `.js` file: clean.
- ESLint (repo-wide): **0 errors, 0 warnings**.
- `npm run build` (frontend production build): clean, `DoctorEarnings`
  chunk built successfully.
- Backend boot check: clean startup, `ECONNREFUSED` only (no live MongoDB
  in this sandbox — same as every prior phase, not claimed as live
  verification).

## 13. Fresh-extract result
Full project zip created, extracted into a brand-new directory, both
`backend` and root `npm` dependencies reinstalled from that clean
extraction, and the full test suite / ESLint / production build / boot
check re-run against it — all passed identically to the pre-extract run.

## 14. Known limitations
- No live MongoDB/browser E2E (sandbox constraint, disclosed above).
- Custom date-range comparison is a summary (current vs. previous period +
  % change), not a re-bucketed chart.
- Withdrawal system remains a disclosed placeholder — no backend exists to
  build a real one against in this phase's scope.

## 15. Final full ZIP path
`/mnt/user-data/outputs/MediCore-HMS-PHASE-DOC-09-EARNINGS.zip`
