> **Historical record.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# PHASE 03 — Financial Operations Hub (completion pass, honest status)

Baseline (this session, uploaded `MediCore-HMS-PHASE-03-PARTIAL-2026-10-16.zip`): backend **190/190** exit 0, ESLint exit 0, Vite build exit 0.
Final (Phase 03 scope): backend **199/199** exit 0, ESLint exit 0, Vite build exit 0 (the 9 new test files are the +9). After the later frontend hardening pass (`docs/history/engineering-reports/FRONTEND-HARDENING-2026-10-17.md`): backend **206/206**, frontend **67 tests** (`npm run test:frontend`, new), ESLint 0, build 0. `npm run test:mongo` **not run**: no `mongod`, no Razorpay sandbox, no browser in this environment.

**Verdict: Phase 03 acceptance gate is NOT fully met.** Everything below marked LOCALLY_VERIFIED ran the real production services/controllers/routers against an in-memory model layer and a faked provider. Nothing is INTEGRATION_VERIFIED or PRODUCTION_VERIFIED. Items in *Remaining* need the project owner's review before Phase 04.

Status vocabulary: IMPLEMENTED · LOCALLY_VERIFIED · INTEGRATION_VERIFIED · PRODUCTION_VERIFIED · BLOCKED_EXTERNAL · NOT_FIXED. "LOCALLY_VERIFIED" here never means real MongoDB semantics (`$elemMatch`/`$pull` atomicity, unique/partial indexes, aggregation pipelines) — those are BLOCKED_EXTERNAL.

## A. Defects found by reading/exercising the code in this completion pass, and fixed

| # | Defect (how found) | Fix | Proof |
|---|---|---|---|
| P3-10 | **Wallet-only refund replay double-counted** payment counters: wallet-only refunds have no provider refund id, so the "already counted" marker was always false. | New additive `Payment.processedRefundKeys`; marker `rrw:<refundRequestId>`. | `refundFailureMatrix` #6 (fails when fix reverted) |
| P3-11 | **Earning over-reversal on replay**: after a crash between saving counters and applying the earning reversal, the replay passed the *post-refund* total as "refunded before", so a >50% partial refund looked final and reversed the whole doctor share. | On replay `refundedBefore = refundedAmount − thisRefund` (paise-exact). | `refundFailureMatrix` #5 (700 of 1000 → 490, not 700) |
| P3-12 | **Ledger posting skipped forever** after a crash between the wallet credit and the ledger write: the idempotent credit matched nothing on replay, returned no wallet, and the ledger post was guarded by `if (wallet)`. | Replay loads the existing wallet and posts the (idempotent) ledger row. | `refundFailureMatrix` #7 |
| P3-13 | **Receipt dedupe collision**: wallet-only refunds keyed the receipt by amount, so a second equal-amount refund's receipt was silently dropped. | Keyed by refund request id. | `refundFailureMatrix` #8 |
| P3-14 | **Wallet-only refund stuck forever** in `gateway_processing` after a crash (reconcile answered "nothing at provider"). | `reconcileRefundRequest` completes it through the same idempotent finalizer. | `refundFailureMatrix` #6 |
| P3-15 | **Coupon `release` also matched legacy (state-less) entries** — reinterpreting historical data without evidence. | Release/pull only match `state: "reserved"`. | `couponLifecycleService` "legacy entries are never released" |
| P3-16 | **Coupon reservation leaked forever** when a crash hit between the payment cancel transition and the release (the sweep never revisits a cancelled payment). | `recoverOrphanCouponReservations` also releases reserved entries whose payment is terminally cancelled/expired with no provider evidence; never captured / failed (retryable) / evidence-bearing / legacy / fresh. | `couponLifecycleService` recovery matrix |
| P3-17 | Recharge confirmation and doctor earning-adjustment notices were not durable emails (in-app only / none). | `financialEmails.rechargeCredited`, `doctorEarningAdjusted` (amounts only, no patient data), keyed per recharge / refund; enqueued before the terminal write; earning replay re-notifies idempotently. | `outboxDurability`, `refundFailureMatrix` (one notice after crash+recovery) |
| P3-18 | Own-goal caught by tests: my first payment reconciliation filters judged capture on `Payment.status` alone, but `status` is the legacy field and lags `paymentState`. | Use the pipeline's own `isCaptureConfirmed` / `effectiveState`. | `reconciliationClasses` (paymentState-lag cases) |
| — | Two Phase 02 tests built coupon "reservations" as state-less entries (really legacy). | Fixtures now carry `state: "reserved"`, matching real `claim()`. A deliberate behaviour change (P3-15). | full suite |

Test-infrastructure changes (all in `tests/helpers/memoryModels.mjs`, behaviour-only): `skip()`, honour pure-inclusive `select()` projections (so tests prove what a query does *not* return), Mongo-correct `$ne` on arrays, `$expr {$lt}`. Full suite re-run green after each.

## B. What was implemented

**Refund lifecycle (P0 §3).** Reused `refundController`, `refundLock`, state machine, gateway outcome and earning adjustment; no second engine. `tests/refundFailureMatrix.test.mjs` (20 scenarios): duplicate/out-of-order webhooks, concurrent webhook/recovery/retry, crash injection at wallet credit / ledger write / earning apply / receipt enqueue / refund-record save with production recovery, ambiguous timeout (provider accepted + response lost → exactly one provider call, retry refused, evidence resolves it), provider lookup failure (no false "not created"), concurrent over-refund (one provider call), multiple partials to total then refusal, stale-lock takeover + stale-holder release fenced, out-of-band duplicate/over-refund/crash-before-receipt, notification failure isolated from money. Each of the four code fixes was **mutation-verified** (test fails when the fix is reverted).

**Reconciliation (P0 §4).** Extended `walletReconciliationService.js` (11 new classes: recharge↔wallet↔ledger mismatch, recharge ledger orphan, payment allocation vs wallet debit/capture ledger, earning reversal missing, earning adjustment inconsistent, open capture cases, stale refund/recharge/payment, reference inconsistency, duplicate provider refund id). Every finding carries `certainty`: `confirmed` | `missing_evidence` | `expected_pending` (in flight, inside 15 min); resolved items are counted, not re-listed. Filters: `category`, `certainty`, `paymentId`, `from/to`; bounded skip/limit (≤100); deterministic ids; read-only (proved by a before/after store snapshot). **One** audited repair, deliberately narrow: `POST /api/admin/finance/reconciliation/recharges/:id/backfill-ledger` (SUPER_ADMIN, reason 10–300, revalidates posted recharge + exact wallet credit + absent ledger row at mutation time, idempotent via the normal ledger key, never touches balances/recharge/payout, audit has before/after). All other classes are investigation-only. No "repair all".

**Coupons (P0 §5).** Fixes P3-15/16. `scripts/audit-coupon-usage.mjs` (`npm run audit:coupon-usage`) is a read-only inventory (legacy entries, counter mismatches, duplicate payment ids, stale reservations). **No data migration is required or run**; legacy entries stay unclassified by design. 7 service scenarios: concurrent global limit, per-user limit, duplicate checkout/callback, redeem-once, double/concurrent release, legacy untouched, recovery matrix.

**Outbox (P0 §6).** Reused `emailOutboxService` + the 1-minute `financialScheduler` job (guarded by the Phase 00 scheduler lock; claims are additionally fenced, so multiple instances are safe). 9 scenarios on the real service: duplicate enqueue, backoff then exhaustion, permanent rejection, abandoned-lease reclaim (attempt counted), stale worker success and failure fenced out, requeue needs reason + audited + conditional, concurrent workers send each row once. **The duplicate-send window is real and documented**: if the provider accepts a message and the worker dies before recording success, the reclaimed row is sent again (asserted in the test: 2 provider calls). No provider idempotency key exists to close it.

**Admin workspace (P0 §7).** Reused `FinanceOperations` tabs, `AdminRefunds`, `PaymentDetailWorkspace`. Added: Evidence tab on the existing payment drill-down (allocation, attempts, state transitions, wallet hold, ledger refs, earning, reconciliation status; safe projection, bounded); rebuilt discrepancy tab (all classes grouped, certainty + payment filters, per-class "what to do", investigate-this-payment, audited repair dialog); Doctor review queue inside `AdminRefunds` (status filter, pagination, acknowledge/resolve/dismiss with note, 409 handled, refetch after every attempt).

**Patient (P1 §8).** Audited by reading and by HTTP tests; no UI change was needed: wallet already shows posted/held/available and recharge states (`WalletDashboard`), checkout already recovers from interrupted verification via server-authoritative polling (`PaymentCheckout`/`paymentConfirmation`), refund modal is driven by the server's eligibility `uiCase`, invoices download via the canonical `sendStoredPdf` (`pdfStorageKey` + legacy `pdfPath`).

**Doctor (P1 §9).** Earnings page already shows platform fee, net share, refund adjustment and withdrawals (`DoctorWithdrawalPanel`). Added a policy-compliant **refund-review request**: `RefundReview` model (partial unique index = one active request per doctor+payment), `POST/GET /api/doctors/refund-reviews`, admin `GET /api/admin/refunds/reviews` + `POST …/:id/resolve`. A request never refunds, reverses, pays or edits anything; no patient identity is exposed; foreign and unknown payments return the same 404.

**Indexes/migrations (§12).** The only new index is `uniq_active_refund_review` on a **new, empty** collection, picked up automatically by migration 011's schema-derived inventory (verified in a dry inventory + lint clean); the new `Payment.processedRefundKeys` field is additive. No existing index dropped, no data rewritten.

## C. Routes added
- `GET  /api/admin/finance/reconciliation/discrepancies` — now also `certainty`, `paymentId` (400 on bad input)
- `POST /api/admin/finance/reconciliation/recharges/:id/backfill-ledger` — SUPER_ADMIN, audited
- `GET  /api/admin/payments/:id` — adds `evidence`
- `POST|GET /api/doctors/refund-reviews` — approved doctors only
- `GET /api/admin/refunds/reviews`, `POST /api/admin/refunds/reviews/:id/resolve` — admin gate `manage_payments`

## D. Role coverage matrix

Columns: Feature | Backend | Existing page | API connection | Authorization | Tests | Final status. "HTTP" = real routers + middleware + JWT on in-memory models.

### SUPER_ADMIN
| Feature | Backend | Existing page | API connection | Authorization | Tests | Final status |
|---|---|---|---|---|---|---|
| Collections & reconciliation overview | existed (aggregations) | FinanceOperations (overview tab) | existing | gate | existing | IMPLEMENTED (unchanged; no new metrics added) |
| Payment drill-down + evidence | extended | PaymentDetailWorkspace (+tab) | `adminApi.getPaymentDetailAdmin` | admin gate | `paymentEvidence` | LOCALLY_VERIFIED |
| Refund queue + reconcile/approve/retry | existed | AdminRefunds + RefundDetailWorkspace | existing | gate | `refundFailureMatrix` (controller paths) | LOCALLY_VERIFIED |
| Doctor review requests | added | AdminRefunds (+section) | new adminApi fns | HTTP 401/403, state 409 | `phase03CompletionHttp` | LOCALLY_VERIFIED |
| Reconciliation investigation | extended | FinanceOperations › discrepancies | `getFinanceDiscrepancies` | HTTP | `reconciliationClasses`, HTTP | LOCALLY_VERIFIED (aggregation-backed classes BLOCKED_EXTERNAL) |
| Audited ledger backfill | added | discrepancies (dialog) | `backfillRechargeLedger` | SUPER_ADMIN, HTTP 403 for others | `reconciliationRepair`, HTTP | LOCALLY_VERIFIED |
| Wallet reservation recovery | existed (Ph02/03) | FinanceOperations › reservations | existing | gate | `phase02*`, HTTP (capture) | LOCALLY_VERIFIED |
| Coupon management | existed (Ph03) | FinanceOperations › coupons | existing | SUPER_ADMIN | `couponLifecycleService`, `couponUsageAudit` | LOCALLY_VERIFIED |
| Outbox health + requeue | existed | FinanceOperations › delivery | existing | gate, reason | `outboxDurability` | LOCALLY_VERIFIED |
| Capture cases | existed (Ph02) | AdminCaptureCases | existing | HTTP | `captureCasesHttp` | LOCALLY_VERIFIED |
| Browser rendering of all of the above | — | — | — | — | none | BLOCKED_EXTERNAL |

### PATIENT
| Feature | Backend | Existing page | API connection | Authorization | Tests | Final status |
|---|---|---|---|---|---|---|
| Payment history (server status) | existed | PatientPayments | existing | HTTP: list scoped to caller | `patientFinanceHttp` | LOCALLY_VERIFIED |
| Wallet posted/held/available, recharge states | existed | WalletDashboard | existing | — | `phase02*` | IMPLEMENTED (read only; no browser run) |
| Refund eligibility / request / track | existed | RefundActionModal | existing | HTTP: IDOR (eligibility, detail, create, report) | `patientFinanceHttp` | LOCALLY_VERIFIED |
| Duplicate submit | existed (check + partial unique index) | RefundActionModal | existing | HTTP concurrent ×5 → one 201, rest 409 | `patientFinanceHttp` | LOCALLY_VERIFIED |
| Completed consultation ⇒ problem report only | existed | RefundActionModal | existing | server refuses instant path | `patientFinanceHttp` | LOCALLY_VERIFIED |
| Invoice view/download | existed | PatientPayments, InvoiceHistory | `invoiceApi` | HTTP: foreign id 404, unauth 401 | `patientFinanceHttp` | LOCALLY_VERIFIED |
| Interrupted verification recovery | existed | PaymentCheckout | existing | — | pure `paymentConfirmation` tests | IMPLEMENTED (no browser/provider run) |
| Refund receipt email | durable | n/a | outbox | — | `refundFailureMatrix` | LOCALLY_VERIFIED |

### DOCTOR
| Feature | Backend | Existing page | API connection | Authorization | Tests | Final status |
|---|---|---|---|---|---|---|
| Earnings, fee, net share, refund adjustment | existed | DoctorEarnings | existing | — | `refundFailureMatrix` (amounts) | LOCALLY_VERIFIED (backend); UI IMPLEMENTED |
| Withdrawals | existed | DoctorWithdrawalPanel | existing | — | `withdrawalManualSettlement` | IMPLEMENTED (not re-audited here) |
| Refund-review request + status | added | DoctorEarnings (payout row) | `doctorApi.requestRefundReview` | HTTP: 401/403, unapproved 403, IDOR 404, dup 409 | `phase03CompletionHttp` | LOCALLY_VERIFIED |
| Earning-adjustment notice (email) | durable | n/a | outbox | — | `outboxDurability`, `refundFailureMatrix` | LOCALLY_VERIFIED |

## E. Wallet precision decision
`Wallet.balance` remains a rupee float. `npm run audit:wallet-precision` exists and passes its unit test but was **not run on real data** (none available): real-data validation is **BLOCKED_EXTERNAL**. If an audit on a data copy shows anomalies or the owner wants integer storage, the reviewed path is: (1) run the audit on a copy; (2) add `balancePaise` as an additive field, dual-write behind a flag in the existing atomic wallet updates; (3) backfill with a dry-run/inventory script (`Math.round(balance*100)`, report any value whose rounding differs by >0.5 paise); (4) switch readers; (5) reconcile (`audit:wallet-precision` + discrepancy report must show zero drift); (6) keep `balance` for at least one release for rollback; never drop or rewrite in place. Not started; nothing here silently changes the meaning of `balance`.

## F. Remaining (explicit) — reason, risk, next action
| # | Item | Reason / risk | Next action / command |
|---|---|---|---|
| R1 | Real MongoDB behaviour of everything atomic | no `mongod`: `$elemMatch`/`$pull`/partial-unique/aggregation pipelines unproven (BLOCKED_EXTERNAL). Highest residual risk: the new aggregation finders (`walletCreditRefsAggregate`, duplicate refund id) and the new partial unique index | `MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase03_test npm run test:mongo` (existing authored suite; **not extended** for the new classes) |
| R2 | Browser E2E for admin/patient/doctor | no browser: lint + build only | run the three role flows; start with Evidence tab, discrepancy repair dialog, review request dialog |
| R3 | Razorpay sandbox | no credentials | webhook replay + refund against sandbox |
| R4 | Index/query-plan check for the new paged finders | `Payment{refundedAmount>$0}`, ledger idempotency-prefix regex, `WalletRecharge status+updatedAt` may scan at scale; report is operator-triggered and bounded per page, but each page still runs 17 finders | `explain()` on a production-size copy; add indexes only if needed |
| R5 | Admin overview metrics (§7.1) not extended; refund-queue status filter lacks `refundState` values (`reconciliation_required`, `gateway_processing`) | the existing overview already uses server aggregations; not changed | optional follow-up; the stale-refund discrepancy class covers the operational need |
| R6 | Wallet precision real-data audit | no data | §E |
| R7 | Frontend test runner | added in the hardening pass (vitest + jsdom + Testing Library): 67 tests, no browser | `npm run test:frontend` |
| R8 | At-least-once email duplicate window | inherent (no provider idempotency key) | documented; accept or add provider-side idempotency |
| R9 | Behaviour change P3-15 | legacy coupon entries are no longer auto-released | run `npm run audit:coupon-usage` on a copy; decide per-coupon manually if any legacy entries are abandoned |

## G. Commands and exit codes (this session)
- `npm ci` (backend, root) → 0 / 0
- baseline: `cd backend && npm test` → 190/190 exit 0; `npx eslint .` → 0; `npx vite build` → 0
- final: `cd backend && npm test` → **199/199** exit 0; `npx eslint .` → 0; `npx vite build` → 0
- New suites: `refundFailureMatrix` (20), `reconciliationClasses` (13), `reconciliationRepair` (4), `outboxDurability` (9), `couponLifecycleService` (7), `couponUsageAudit` (4), `phase03CompletionHttp` (6), `patientFinanceHttp` (6), `paymentEvidence` (13 checks).
- Skipped suites counted as passed: **none**; `test:mongo` and browser/provider checks were not run and are not counted.
