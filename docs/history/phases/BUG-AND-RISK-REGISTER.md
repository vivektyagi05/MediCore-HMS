# Bug and risk register

Updated 2026-10-14 (Phase 01; Phase 00 text below preserved). Phase 00 was 2026-10-13. F-001…F-024 are carried over **unchanged** from `MEDICORE-FINANCIAL-FINAL-RE-AUDIT.md` (slice 2) except where Phase 00 touched them (marked ▲). Statuses: IMPLEMENTED · LOCALLY_VERIFIED · INTEGRATION_VERIFIED · PRODUCTION_VERIFIED · BLOCKED_EXTERNAL · NOT_FIXED. A status above LOCALLY_VERIFIED requires a real-MongoDB / provider / deployment run, none of which exists yet.

## Phase 00 items

| ID | Severity | Finding | Status | Evidence / remaining |
|---|---|---|---|---|
| N-001 | P0 | Production runs `autoIndex:false`; only migration 009 built one index and nothing in the deploy path ran it. Idempotency/uniqueness guarantees did not exist in production. | LOCALLY_VERIFIED | Derived inventory (321 indexes), migration 011, release step, readiness check. `tests/indexInventoryMigration.test.mjs`, `deployLifecycle.test.mjs`. Real-Mongo: `tests/mongo/phase00.mongo.test.mjs` **not run** (BLOCKED_EXTERNAL). |
| N-002 | P0 | Scheduler off by default and in no deploy config; lock had no owner/lease; fail-open on DB error; stale worker could overwrite a reclaimed row; shutdown did not wait for jobs; every replica could run it. | LOCALLY_VERIFIED | Lease + fencing + fail-closed + role split + graceful drain. `tests/cronJobLocking.test.mjs`, `financialScheduler.test.mjs`. Real concurrency BLOCKED_EXTERNAL. No operator status endpoint yet. |
| N-007 | P0 | Invoice PDFs written to `cwd/storage/invoices` (`/app/storage`) while the volume is `/app/backend/storage` → lost on redeploy; same for prescriptions/certificates; health check inspected the wrong directory. | LOCALLY_VERIFIED | `storageService` + atomic write + `pdfStorageKey` + legacy fallback + real round-trip health check. `tests/pdfDurableStorage.test.mjs`. S3 live bucket NOT VERIFIED. Old files already lost on the ephemeral layer cannot be recovered by code. |
| N-023 | P1 | Docker on Node 20, no engines, `latest` deps, no CI, no release step, LGD import in every container start, liveness-only healthcheck. | LOCALLY_VERIFIED | Pins, engines, Node 22 images, `release.mjs`, `preflight.mjs`, `/api/health/ready`, compose roles, `ci.yml`. `tests/deployLifecycle.test.mjs`. Docker build / CI run NOT VERIFIED. |
| N-024 | P0 | `CronRunLog` unique partial lock index shared the default name `jobName_1` with the plain field index → server rejects it silently → **lock index never existed**. | LOCALLY_VERIFIED | Named `uniq_cronrun_running_per_job`; `verifyLockIndex()`; inventory lint rejects duplicate names. Established by static analysis, not reproduced on a live server. |
| N-025 | P1 | `NotificationDelivery {eventKey, recipientId}` unique+sparse collides on `(null, recipientId)` for keyless notifications once the index exists. | LOCALLY_VERIFIED | Partial `$type:"string"` index. Reasoned from index semantics; not reproduced on a live server. Existing dev DBs may still hold the old sparse index until dropped manually. |
| N-026 | P1 | Six other `unique+sparse` indexes index explicit nulls (ledger, subscription, withdrawal, reminder, appointment bookingRequestId, service slug). | LOCALLY_VERIFIED | Named partial indexes, additive creation, null-row report, manual `dropIndex` for legacy. Legacy sparse indexes remain until a human drops them. |
| N-027 | P2 | `paymentController` populates `invoiceId` with `pdfPath` (server filesystem path in two API responses). | NOT_FIXED | Found, out of scope for this phase. |
| N-028 | P2 | Lease/heartbeat: a job blocking the event loop longer than the lease (2 min) can be reclaimed while running. Completion is then fenced and logged, not applied; the job's side effects still happened. | NOT_FIXED (documented limitation) | Jobs must stay idempotent (they are designed to be). |
| N-029 | P2 | Profile-photo / CMS-banner uploads still use bespoke multer + `cwd`-relative unlink code. | NOT_FIXED | Outside invoice/clinical-PDF scope. |

## Phase 01 items (payment core, state machine, webhook integrity)

Evidence level for every row: **LOCALLY_VERIFIED** means `tests/phase01PaymentCore.test.mjs` (53 checks, in-memory model layer that evaluates the real filters/updates and interleaves async operations), `phase01CheckoutRecovery.test.mjs` (9) and `phase01Contracts.test.mjs` passed. **None is INTEGRATION_VERIFIED**: `tests/mongo/phase01.mongo.test.mjs` is written but could not run (no mongod; `mongodb-memory-server` binary download blocked). No Razorpay sandbox was available.

| ID | Severity | Finding (as found in the repository) | Status | Evidence / remaining |
|---|---|---|---|---|
| N-030 | P0 | `payment.failed` webhook set a payment to failed by `razorpayOrderId` with no state guard: a failure could downgrade an already captured payment, a failure for an old order could fail the current one, duplicates re-appended history and re-triggered retry. | LOCALLY_VERIFIED | Attempt-aware `applyGatewayFailure` (shared by webhook and browser verification) over a compare-and-set transition. Tests: captured/completed/refunded never downgrade; stale attempt ignored; duplicate failure is a no-op; concurrent capture vs failure. Mutation-checked (removing the guards fails the tests). |
| N-031 | P0 | State changes were read-modify-`save()` of whole documents and history hard-coded the previous state; `status` and `paymentState` could disagree. | LOCALLY_VERIFIED | `payments/paymentTransitions.js` (`transitionPayment`): validates against `PAYMENT_TRANSITIONS`, pins the exact `status`+`paymentState` read, records the real previous state, refuses to downgrade when EITHER field shows capture. Post-processing, capture, retry, failure and creation use it. No `payment.save()` remains in `paymentController`/`webhookHandler`. Scope: appointment-payment lifecycle only (wallet recharge, refunds, withdrawals, subscriptions untouched: later phases). |
| N-032 | P0 | Browser verification and webhooks found a payment only by its LATEST order id, so a capture for an older attempt could not be correlated (real money unaccounted for or rejected). The machine also forbade `failed -> captured`. | LOCALLY_VERIFIED | `resolveGatewayOrder` resolves any historical order through `PaymentAttempt`. A capture on an old order is claimed on that attempt (`capturedAttemptNumber`, `capturedGatewayOrderId`), other open attempts are marked `superseded`; a second capture of a different provider payment is preserved in `captureEvidence`, flagged `reconciliationState=required`, never fulfils twice. Machine now allows capture from any pre-capture state including `failed`. |
| N-033 | P0 | Patient retry bypassed the retry claim; attempt numbers came from `countDocuments`; order creation and attempt creation could diverge on a crash; a stale worker could overwrite a newer order; no retry cap on the patient path. | LOCALLY_VERIFIED | Attempt-first creation: reserve attempt (unique `paymentId+attemptNumber`) -> create order with deterministic receipt -> bind -> fenced pointer commit (`retryClaimToken`). Ambiguous gateway errors keep a placeholder that `recoverOrphanAttempts` resolves by receipt lookup (adopt or cancel; never deletes). All four callers share `createRetryAttempt`. Bounded by `MAX_RETRIES`; per-candidate isolation in `retryDuePayments`. |
| N-034 | P0 | Only an idempotency-key check guarded payment creation (and that index is not unique): two keys could create two active payments for one appointment. A provider order was also created BEFORE the Payment row existed (orphan order on crash). | LOCALLY_VERIFIED (index: BLOCKED_EXTERNAL) | Claim-first: `Payment.create` (owning `activeAppointmentSlot`) precedes order creation; partial unique index `uniq_payment_active_appointment` on `(appointmentId, activeAppointmentSlot)`; slot released on cancelled/expired/refunded/retries-exhausted; order-less payments resumed by receipt lookup. Migration 012 reports legacy duplicates (stops, exit 2, writes nothing) then backfills the flag; runs before 011 in `release.mjs`. Unique-index behaviour under real concurrency NOT run. |
| N-035 | P0 | Webhook dedupe was find-then-create; no lease, so a crash left events stuck; no bounded retry or permanent-failure class; recovery was admin-triggered only. | LOCALLY_VERIFIED | Unique `eventId` insert is the dedupe gate; `received -> processing(lease) -> processed|failed(retryable,nextAttemptAt)`; completion fenced by lease owner; `recoverWebhookEvents` job (`cron/recoverPaymentEvents.js`, 1 min, under `trackRun`); `retryWebhookEvent`/self-healing and the HTTP handler share `processWebhookEventRecord`. Permanent errors acknowledged 200 and never retried; transient -> 500 and retried with backoff, capped at 8 attempts. Missing secret -> 503 (fail closed). |
| N-036 | P1 | Verification could substitute the expected currency/amount when the provider omitted them. | LOCALLY_VERIFIED | Missing/unequal amount, currency or order is never substituted: verify -> `verification_pending` (503); capture webhook -> evidence + permanent failure; mismatch -> `reconciliation_required`. |
| N-037 | P1 | Browser verify treated provider `authorized`/`created` as a failed payment and marked it failed; an invalid signature or timeout pushed a payment into `verification_pending`; the checkout navigated to success on any 200 and showed an error toast on any verify failure (including timeouts). | LOCALLY_VERIFIED (no browser E2E) | Verify: ownership first, signature, provider re-fetch, strict fields, `authorized` -> HTTP 202 pending, only provider `failed` fails (current attempt only). Frontend: `paymentConfirmation.js` + `PaymentCheckout.jsx`: callback is a hint; 202/timeout/5xx/network -> bounded backoff re-read of `/payments/status`; success only on backend `SUCCESS`; refresh restores an unpaid order; duplicate submission blocked; closing the modal re-reads state. |
| N-038 | P1 | Webhook payloads were stored whole (patient e-mail, phone, card/VPA/bank fields) with the full signature. | LOCALLY_VERIFIED | `sanitizeWebhookPayload` keeps only processing fields; only a 16-char signature digest is stored. Existing stored rows are NOT rewritten. |
| N-039 | P1 | A wallet-only payment whose debit failed became a retryable `failed` payment; a retry would create a full-amount gateway order. | LOCALLY_VERIFIED (by reasoning + shared tests; wallet path itself not run) | Wallet-only debit failure now cancels the payment (releases the slot) instead. |
| N-040 | P2 | Known residual risks (see `PHASE-01-PAYMENT-CORE.md`): provider orders are not closed after a retry (old order stays payable; handled by the old-order capture path, not prevented); capture on a payment whose appointment another payment already fulfilled still runs the invoice step (pre-existing); subscription handlers still use read-modify-save; legacy sparse indexes remain; stored historical webhook payloads keep PII. | NOT_FIXED (documented) | Later phases / explicit operator action. |

## Carried over from slice 2 (F-001 … F-024)

| ID | Status | Note |
|---|---|---|
| F-001 ▲ | PARTIALLY_FIXED | Phase 01: subscription capture/failure events stay isolated from appointment orders (resolution order tested). Not run against Mongo/provider; legacy unpaid-active rows only reported (migration 010); no browser E2E. |
| F-002 | PARTIALLY_FIXED | Manual settlement only; no payout provider; no beneficiary model. |
| F-003 | PARTIALLY_FIXED | `refund.failed` for unowned refunds only flags `refundStatus`; no failure-injection tests. |
| F-004 | PARTIALLY_FIXED | No recharge webhook path, no posting-state recovery. |
| F-005 | PARTIALLY_FIXED | Mongo concurrency test written, NOT RUN; cancel/refund release not wired. |
| F-006 ▲ | PARTIALLY_FIXED | Phase 01: shared fenced retry claim across cron/admin/webhook/patient (LOCALLY_VERIFIED, N-033); real-Mongo race test (`phase01.mongo.test.mjs`) NOT RUN. |
| F-007 | PARTIALLY_FIXED | Continuation not persisted between runs. |
| F-008 ▲ | PARTIALLY_FIXED | Unique `paymentId` index now also part of the migration-011 inventory and the readiness check; migration 009/011 **not run on real data**. |
| F-009 | PARTIALLY_FIXED | `doctor_earning` / `platform_fee` / `recharge` postings still not written. |
| F-010 | PARTIALLY_FIXED | Invoice PDF attachment dropped from receipt; delivery unverified (needs Brevo). |
| F-011 | PARTIALLY_FIXED | Other financial screens not wired; not browser-tested. |
| F-012 | PARTIALLY_FIXED | Wallet reconciliation not scheduled; no admin UI. |
| F-013 ▲ | PARTIALLY_FIXED | Phase 01: capture -> post-processing progress is CAS-tracked (`post_processing`/`post_processing_failed`/`completed`), crash after claim and retried-to-completion are tested with an injected post-processor. The controller's internal steps (invoice/payout/ledger) were not individually crash-injected. |
| F-014 ▲ | PARTIALLY_FIXED | Phase 01 adds in-memory interleaving tests; real-Mongo concurrency test written, NOT RUN. |
| F-015 ▲ | LOCALLY_VERIFIED (was PARTIALLY_FIXED) | Scheduler topology, lease, fencing, fail-closed, graceful stop now implemented and unit-tested; real execution against a database BLOCKED_EXTERNAL; no health endpoint for the worker beyond `CronRunLog` rows. |
| F-016 | NOT_FIXED | Refund receipts. |
| F-017 ▲ | PARTIALLY_FIXED | Phase 01 reworked the appointment checkout callback (N-037); wallet recharge modal still not re-audited. |
| F-018 | PARTIALLY_FIXED | No real-Mongo/HTTP test. |
| F-019 ▲ | PARTIALLY_FIXED | Phase 01: 175/175 backend tests (3 new files). Phase 00: added scheduler, index, storage, deploy tests (172/172) and a real-Mongo Phase 00 suite that has **not run**. |
| F-020 | NOT VERIFIED | Every production-verification row still unverified. |
| F-021 | NOT_FIXED | Earning/fee ledger postings. |
| F-022 ▲ | PARTIALLY_FIXED (was NOT VERIFIED) | Invoice/prescription/certificate PDFs now use `storageService`; production storage driver/volume setting still unverified. |
| F-023 | PARTIALLY_FIXED | No dunning policy beyond expiry. |
| F-024 | PARTIALLY_FIXED | Other money screens not audited line-by-line. |

## Phase 02 updates (wallet / split / recharge / coupon) — all LOCALLY_VERIFIED at best; real Mongo/Razorpay BLOCKED_EXTERNAL
| ID | Status | Note |
|---|---|---|
| N-P2-01 | LOCALLY_VERIFIED | Wallet double-spend: split contribution is now reserved atomically (`Wallet.holds`, available = balance − holds) before any provider order; commit/release at-most-once. Real-Mongo race test written, NOT RUN. |
| N-P2-02 | LOCALLY_VERIFIED | Capture after a failed wallet debit: commit of a reservation cannot fail for lack of funds; late capture after release falls back to guarded debit or stays reconciliation-required with capture preserved. |
| N-P2-03 | LOCALLY_VERIFIED | Wallet-only crash windows (after reserve / after commit) recovered by `recoverWalletOnlyPayments`; ambiguous debit errors no longer cancel a possibly-debited payment. |
| N-P2-04 | LOCALLY_VERIFIED | Recharge: intent before order, wallet-before-ledger, late-capture credit, recovery job, strict amount/currency, webhook path added (none existed), stale-save downgrade closed. |
| N-P2-05 | LOCALLY_VERIFIED | Coupon orphan reservations recovered; release gated on provider evidence. Reservation/redemption still one list (documented limit). |
| N-P2-06 | LOCALLY_VERIFIED | Held funds/coupons of unpayable appointments are now released (cleanup sweep + expiry hook). |
| N-P2-07 | LOCALLY_VERIFIED | Audited SUPER_ADMIN capture-evidence resolution API. **No UI** (NOT_FIXED). |
| F-018 | PARTIALLY_FIXED → LOCALLY_VERIFIED (wallet-only now reservation-backed); no real-Mongo/HTTP run. |

## Phase 02 closure updates
| ID | Status | Note |
|---|---|---|
| N-P2-07 | API LOCALLY_VERIFIED / UI IMPLEMENTED (not browser-verified) | `/admin/capture-cases` SUPER_ADMIN workspace |
| N-P2-08 | LOCALLY_VERIFIED | stale whole-document recharge `save()` replaced by guarded updates |
| N-P2-09 | LOCALLY_VERIFIED | duplicate concurrent checkout opened extra provider orders → in-progress guard |
| N-P2-10 | LOCALLY_VERIFIED | recharge amount: finite, ≤2 decimals |
| N-P2-11 | NOT_FIXED (documented) | `Wallet.balance` rupee float; needs reviewed migration; `npm run audit:wallet-precision` |
| N-P2-12 | NOT_FIXED | no UI for `recovery_required` wallet reservations (API exists) |
| N-P2-13 | NOT_FIXED | coupon reservation/redemption share `usedBy[]` |
