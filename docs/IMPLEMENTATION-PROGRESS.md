# Phase 00 — Foundation & Production Integrity: implementation progress

Date: 2026-10-13 · Base: `MediCore-HMS-FINANCIAL-HARDENING-S2-2026-10-09.zip` · Baseline: 169/169 backend tests · Now: **172/172**, eslint 0 errors, Vite build clean, `npm ci` clean for both lockfiles.

Status vocabulary: `IMPLEMENTED` (code exists) → `LOCALLY_VERIFIED` (unit/static/local-filesystem evidence, no real Mongo) → `INTEGRATION_VERIFIED` (passed against a real MongoDB) → `PRODUCTION_VERIFIED` → `BLOCKED_EXTERNAL` → `NOT_FIXED`.

**Nothing in this phase is INTEGRATION_VERIFIED or PRODUCTION_VERIFIED.** No `mongod` exists in the sandbox and `mongodb-memory-server` cannot download its binary (`getaddrinfo ENOTFOUND fastdl.mongodb.org`, re-checked this session). The real-Mongo suite `tests/mongo/phase00.mongo.test.mjs` is written and syntax-checked but has **not run**. Run it with `MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase00_test npm run test:mongo` (CI job `backend-mongo` does this on a `mongo:7` service).

## Workstream results

| Item | Status | What changed |
|---|---|---|
| **N-001** production indexes | LOCALLY_VERIFIED (real-Mongo BLOCKED_EXTERNAL) | `migrations/lib/indexInventory.js` derives the inventory **from the Mongoose schemas** (321 indexes, 54 models, 39 unique) so it cannot miss one. `migrations/lib/indexMigration.js` + `011_ensure_production_indexes.js`: duplicate scan before every unique build, compare on key+options (not name), conflicts reported never dropped, nothing deleted, every create re-verified via `listIndexes`, serialized `migration_state` lock with lease+fencing, `--dry-run`, exit codes 0/2/3/4/1. `npm run migrate:indexes`, `npm run verify:indexes`. |
| **N-002** scheduler | LOCALLY_VERIFIED (real-Mongo BLOCKED_EXTERNAL) | `CronRunLog` lock is now a lease: `ownerToken` + `leaseExpiresAt` + heartbeat. Heartbeat/complete/fail/release are all fenced on `{_id, ownerToken, status:"running"}`, so a reclaimed stale worker cannot overwrite the newer owner or a `timed_out` row. Lock errors are **fail-closed** (job skipped, error logged — previously it ran unlocked). The unique partial lock index is verified before locking; the scheduler refuses to start without it. `SERVICE_ROLE=web|worker|all`; new `backend/worker.js`; web never runs the scheduler. Graceful shutdown: timers + boot timeout cleared, bounded wait for in-flight jobs, unfinished runs recorded `timed_out`, never success. |
| **N-007** invoice storage | LOCALLY_VERIFIED (S3 live bucket NOT VERIFIED) | Invoice, prescription and certificate PDFs are rendered to a buffer and written through `storageService` (`services/pdfDocumentStore.js`). Local driver writes are now atomic (temp file → fsync → rename). New `pdfStorageKey` on the three models; `pdfPath` kept for legacy rows. Downloads read the key first, then the legacy path, then the legacy basename under the storage root; ownership-scoped lookups unchanged. API no longer exposes `pdfPath`/keys on invoices (`hasPdf` flag instead; two admin buttons updated). `env.invoiceStorageDir` resolves under the storage root; Platform Health storage check is now a real write/read/delete round-trip through `storageService`. |
| **N-023** build / CI / Docker | LOCALLY_VERIFIED (Docker build and CI run NOT VERIFIED) | Every `latest` dependency pinned to the exact version the lockfile already resolved (backend lock: 0 resolution changes; root lock: 6 inert optional wasm sub-entries differ). `engines.node >=22.12.0`, `.nvmrc`, both Dockerfiles `node:22-alpine` (was 20; vite's rolldown needs ≥20.19/22.12). Container CMD runs **only** `server.js` — the LGD import no longer runs in every replica at every start. New `scripts/release.mjs` (preflight → 005 → 011 → verify, any failure aborts). New `scripts/preflight.mjs` (production guards + storage writability; never prints values). `/api/health/ready` (DB ping + critical indexes + lock index; 503 otherwise) is the image HEALTHCHECK. `docker-compose.yml`: `release` one-shot → `backend` (web) + `worker`. `.github/workflows/ci.yml` (only real scripts). `render.yaml.example` is labelled example-only; no `render.yaml` is claimed. |

## New defects found and fixed while doing the work

* **N-024 — the scheduler lock index could not exist.** `CronRunLog` declared `jobName: {index:true}` (default name `jobName_1`) **and** an unnamed unique partial index on the same key (also default name `jobName_1`). Index names are unique per collection, so the server rejects the second one; Mongoose only emits that as an event, so it fails silently. The partial unique lock index was therefore never created, even in development. It now has its own name `uniq_cronrun_running_per_job`, and `verifyLockIndex()` checks the real index list. (Established from MongoDB's naming rule + the inventory lint; not reproduced on a live server.)
* **N-025 — notification idempotency index would break keyless notifications.** `{eventKey:1, recipientId:1}` was `unique+sparse`. `recipientId` is required, so sparse still indexes every document; a second notification without an `eventKey` for the same user collides on `(null, recipientId)` and `createDelivery` rethrows the E11000. Production (autoIndex off) never had the index; building it (migration 011) would have created the failure. Now partial on `eventKey: {$type:"string"}`.
* **N-026 — six more `unique+sparse` indexes** (ledger/subscription/withdrawal `idempotencyKey`, reminder `eventKey`, appointment `bookingRequestId`, service `slug`) index explicit `null`s. Converted to named partial `$type:"string"` indexes.

## Behaviour changes operators must know before deploying

1. **`SERVICE_ROLE` is now mandatory in production** (`web`, `worker`, or `all`; `all` also needs `ENABLE_IN_PROCESS_SCHEDULER=true|false`). Boot fails without it. Previously the scheduler was silently off everywhere.
2. **Run migration 011 (`npm run release`) before the new code takes traffic.** Without the lock index the scheduler refuses to start and `/api/health/ready` returns 503.
3. Deploy **exactly one** `SERVICE_ROLE=worker` service, otherwise no financial job runs. (Extra workers are safe, just redundant.)
4. Existing databases keep their old **sparse** unique indexes; migration 011 creates the partial ones **additively** and prints the exact `dropIndex` command plus a count of explicit-null rows. The drop is a reviewed manual step — nothing is dropped automatically.
5. Existing PDFs written to the old cwd path (`/app/storage/...`) lived on the container layer and may already be gone; rows keep `pdfPath` and still download if the file survived. Nothing is regenerated or deleted.
6. The in-process scheduler is not started by `server.js` for `SERVICE_ROLE=web`, but `server.js` with `SERVICE_ROLE=all` (the dev default) still starts it.

## Not done / still open (honest)

* All real-MongoDB behaviour (index build, lock arbitration, fencing under real concurrency) — **BLOCKED_EXTERNAL**.
* No `docker build`, compose run, or GitHub Actions run (no Docker daemon / network).
* No dedicated operator "scheduler status" endpoint. `getLatestRunPerJob()` now also returns `host`, `heartbeatAt`, `leaseExpiresAt`; whether the existing Platform Health UI surfaces them was not checked.
* `paymentController` still `populate`s `invoiceId` with `pdfPath` in two payment responses (exposes a server path in nested JSON). Not changed this phase.
* `services/emailService.sendPaymentReceipt` still attaches by `pdfPath`; it has no callers today.
* Profile-photo and CMS-banner uploads still use their own multer/`cwd` unlink code; not part of N-007's invoice/clinical-PDF scope.
* Lease default is 2 min with heartbeat every ~40 s; a job that blocks the event loop longer than the lease could be reclaimed while still running (its completion is then fenced and logged, not applied).
* Phase 01 (payment-state transitions, webhook ordering, retry correlation, duplicate appointment payment prevention) is **not started**.


---

# Phase 01 checkpoint — Payment core, state machine, webhook integrity (2026-10-14)

Baseline re-measured on the uploaded Phase 00 zip: 172/172 backend tests. Final: **175/175**, `eslint .` clean, `vite build` OK. Real MongoDB and Razorpay sandbox unavailable: nothing here is INTEGRATION_VERIFIED.

**Repository facts that differ from the Phase 01 brief:** `Payment.status` and `Payment.paymentState` use the SAME lowercase vocabulary (not uppercase vs lowercase) but move independently (e.g. status `created`/`pending` while workflow state advances; status stays `captured` through post-processing). The machine therefore reasons about the effective state `paymentState || status` and refuses a downgrade if either field shows capture; no data migration of states was done. No git repository exists in the working tree.

## Delivered
* `payments/paymentTransitions.js` — the single compare-and-set transition (real previous state, no blind save).
* `payments/paymentAttemptService.js` — attempt-first order creation, order->attempt->payment resolution, orphan recovery.
* `payments/paymentFailureService.js` — attempt-aware failure shared by webhook and browser verification.
* `payments/webhookHandler.js` — one processor: raw-body HMAC (fail closed), unique event id, lease/fencing, bounded retry, recovery, payload minimisation.
* `payments/paymentRetryService.js` — fenced claim, shared by cron/admin/webhook/patient.
* `payments/paymentCapture.js` — capture claim through the CAS; evidence for unapplicable captures.
* `controllers/paymentController.js` — claim-first creation, strict server-authoritative verification, status/recovery classification, retry via the canonical service.
* Models: `Payment` (+`activeAppointmentSlot`, `retryClaimToken`, `capturedAttemptNumber/OrderId`, `captureEvidence`, unique partial index), `PaymentAttempt` (+`superseded`, `failureCode`), `WebhookEvent` (+lease/attempt fields, `processing`).
* `migrations/012_payment_active_slot.js`, `release.mjs` order, `cron/recoverPaymentEvents.js` (+ scheduler entry).
* Frontend: `src/pages/payment/paymentConfirmation.js`, `PaymentCheckout.jsx`.
* Tests: `phase01PaymentCore`, `phase01CheckoutRecovery`, `phase01Contracts`, `mongo/phase01.mongo.test.mjs` (not run), `helpers/memoryModels.mjs`; `paymentReplayIdempotency` assertions updated to the stronger CAS structure.

## Behaviour changes to know before deploying
1. `payment.failed` can no longer fail a captured payment, an old attempt, or a payment twice.
2. A webhook for a permanently bad event is acknowledged with 200 and stored `failed`, `retryable:false`; a transient failure returns 500 (event is durably stored and also retried by the 1-minute job). Missing webhook secret returns 503 (was 400).
3. `POST /payments/verify` can return **202** (`confirming:true`) when the provider has not finished; an invalid signature or provider timeout no longer mutates payment state except `verification_pending` on an unreachable/incomplete provider response.
4. `POST /payments/orders` returns **409** `ACTIVE_PAYMENT_EXISTS` (with `paymentId`, `recoveryState`, `retryable`) when another active payment exists for the appointment, whatever the idempotency key.
5. A wallet-only payment whose wallet debit fails is now `cancelled` (was a retryable `failed`).
6. Retried orders get status `pending` + paymentState `pending` (was status `failed` + `pending` for cron/webhook retries and `order_created` for patient retries). Legacy rows in the old shape are still classified correctly.
7. Machine additions (additive): capture is legal from any pre-capture state including `failed`; every pre-capture state may enter `reconciliation_required`; `expired -> pending`.

## Phase 02 checkpoint (2026-10-16)
Done (LOCALLY_VERIFIED): wallet reservation service+model, split/wallet-only integration, wallet-only recovery, recharge pipeline+webhook+recovery, coupon orphan recovery + guarded release, unpaid-payment sweep, capture-evidence resolution API, frontend contract. Index: schema-declared, picked up by re-run migration 011.
Tests: backend 179/179 (`npm test`), `npx eslint backend src` clean, `npm run build` OK. `npm run test:mongo` NOT RUN (no mongod).
Next task: run `MONGODB_TEST_URI=... npm run test:mongo` on a disposable DB; Razorpay sandbox; admin UI for capture cases; then Phase 03.

## Phase 02 FINAL CLOSURE (2026-10-16)
Status: implementation-complete locally; NOT integration-verified. Backend 185/185 (exit 0), ESLint exit 0, build exit 0, `test:mongo` SKIPPED (no disposable Mongo). New: capture-case workspace UI, controller-level crash matrix (25), authorization sweep, index inventory test, read-only wallet audit script; 3 new defects fixed (N-P2-08/09/10). Full report: docs/PHASE-02-FINAL-CLOSURE.md.
Next task: run `npm run test:mongo` on a disposable DB, Razorpay sandbox, browser E2E; then Phase 03 (separate commit).

## Phase 03 checkpoint (2026-10-16) — PARTIAL
Done (LOCALLY_VERIFIED unless noted): refund lock lease+fencing (P3-01), receipt-before-terminal-save (P3-02), outbox claim fencing + health + audited requeue (P3-03), read-only paginated discrepancy report with 6 classes (P3-04), coupon reserved/redeemed lifecycle + validated/audited admin + usage (P3-05/06), FinanceOperations tabs: wallet-reservation review, discrepancies, delivery health, coupons (IMPLEMENTED), wallet held/available display (P3-07), doctor payout refund-adjustment display (P3-09).
Tests: backend 190/190 (exit 0), ESLint exit 0, build exit 0. `test:mongo` NOT RUN (phase03.mongo.test.mjs authored, unexecuted). No Razorpay sandbox, no browser E2E.
NOT done: refund test matrix beyond lock, remaining reconciliation classes + audited repair, admin overview/payment drill-down/refund-queue completion, doctor refund-review request, patient receipt/eligibility audit, indexes/migrations, wallet precision (BLOCKED_EXTERNAL). Full list: docs/PHASE-03-REFUND-LEDGER-OUTBOX.md.
Next task: run `npm run test:mongo` on a disposable DB; then close the NOT done list above.
