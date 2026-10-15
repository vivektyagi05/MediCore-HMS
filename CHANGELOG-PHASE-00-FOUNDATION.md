# Phase 00 — Foundation & Production Integrity (2026-10-13)

## Added
- `backend/migrations/lib/{indexInventory,indexMigration,migrationState}.js`, `backend/migrations/011_ensure_production_indexes.js` (+ `npm run migrate:indexes`, `verify:indexes`)
- `backend/worker.js` (`npm run start:worker`), `SERVICE_ROLE=web|worker|all`
- `backend/services/{pdfDocumentStore,readinessService}.js`, `GET /api/health/ready`
- `backend/scripts/{preflight,release}.mjs` (`npm run preflight`, `npm run release`)
- `.github/workflows/ci.yml`, `.nvmrc`, `render.yaml.example` (example only)
- Tests: `indexInventoryMigration`, `pdfDurableStorage`, `deployLifecycle`, `helpers/fakeDb`, `mongo/phase00.mongo.test.mjs` (not run: no mongod)
- Docs: `docs/IMPLEMENTATION-PROGRESS.md`, `docs/BUG-AND-RISK-REGISTER.md`, `docs/TESTING-AND-RELEASE-GATES.md`

## Changed
- `utils/cronRunTracker.js`: lease + ownerToken fencing, fail-closed, lock-index verification, graceful drain. `models/CronRunLog.js`: lease fields; lock index named `uniq_cronrun_running_per_job` (N-024).
- `cron/financialScheduler.js`: async start (verifies lock index), duplicate-registration no-op, graceful stop. `server.js`: role-aware, `beforeShutdown` hook (`utils/processResilience.js`).
- `config/productionGuards.js`, `config/env.js`: `SERVICE_ROLE` (required in production), `serviceRole`, `schedulerEnabled`; `invoiceStorageDir` resolves under the storage root.
- Indexes: `NotificationDelivery`, `TransactionLedger`, `Subscription`, `Withdrawal`, `ReminderLog`, `Service`, `Appointment` unique+sparse → named partial `$type:"string"` (N-025/N-026).
- PDFs (invoice, prescription, certificate) written via `storageService` (atomic local write); `pdfStorageKey` added; downloads key-first with legacy fallback; invoice API returns `hasPdf` instead of `pdfPath`; admin invoice buttons use `hasPdf`.
- Platform Health storage check: real round-trip through `storageService`.
- Build: all `latest` deps pinned to locked versions; `engines.node >=22.12.0`; Docker images Node 22; backend container CMD runs only `server.js`; compose adds `release` + `worker`.

## Breaking / operator-visible
1. Production boot **fails without `SERVICE_ROLE`** (and `ENABLE_IN_PROCESS_SCHEDULER` when role is `all`).
2. Run `npm run release` (migration 011) before the new build serves traffic; otherwise the scheduler refuses to start and `/api/health/ready` is 503.
3. Deploy exactly one `SERVICE_ROLE=worker`.
4. Legacy sparse unique indexes are not dropped automatically; migration 011 prints the manual `dropIndex` step.

## Verification
Backend 172/172 · eslint 0 · vite build clean · `npm ci` clean (root + backend). Real MongoDB, Docker and CI runs: NOT VERIFIED (see `docs/TESTING-AND-RELEASE-GATES.md`).
