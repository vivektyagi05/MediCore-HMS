# MediCore HMS — N-001 / N-023 Index Audit Reconciliation

**Assessment date:** 2026-11-02  
**Repository:** isolated `MediCore-HMS-audited-2026-11-02.zip` workspace  
**Database status:** BLOCKED — no MongoDB server or `MONGODB_TEST_URI` was available. No migration was executed.

## 1. Evidence identity and scope

The two uploaded evidence files, `N-001 production index inventory +.txt` and `N-023 production index inventory +.txt`, are byte-for-byte identical:

- SHA-256: `98760d0882dfc65152e23c4d989c0c0a9e3e2dad75486f605f4a5acb14c02cd8`
- Both are 555 lines and 37 KB.
- They contain the same N-023 deployment/readiness/preflight test, canonical tax test, family-member ownership test, PDF durable-storage test, Phase 02 index assertions and storage/S3 child-process test.

Consequently, the two filenames do not represent independent test runs or independent evidence. The bundle itself labels Docker/Compose and live CI as not verified. Its fake-DB readiness and index tests do not prove server-side MongoDB index semantics.

## 2. Duplicate and overlapping checks

| Check | Overlap | Disposition |
|---|---|---|
| `lintInventory(buildInventory())` | Full inventory test and Phase 02 targeted inventory test | Keep the full inventory check canonical; targeted assertions remain useful for business invariants but are not independent inventory evidence. |
| `loadAllModels()` / `buildInventory()` | Inventory, Phase 02 and deploy-lifecycle checks | Shared setup, not separate proof of database state. |
| WalletReservation / WalletRecharge / TransactionLedger unique indexes | Phase 02 targeted checks overlap full inventory assertions | Keep targeted invariant assertions and pair them with real-Mongo insert/concurrency tests. |
| Payment-slot partial unique index | Inventory test and Phase 02 targeted check | Same intended invariant; real Mongo insert behavior remains necessary. |
| `ensureIndexes()` with fake DB | Inventory migration test and deploy-lifecycle readiness test | Useful unit coverage, but not a substitute for `listIndexes`, real duplicate aggregation or server index builds. |
| PDF storage | PDF durable-storage test and storage-service test | Different layers: PDF lifecycle/ownership vs driver contract. The old `invoiceStorageDir` assertion was misleading and has been replaced. |

## 3. Implementation findings and repairs

### `backend/migrations/lib/indexInventory.js`

- **Windows ESM path defect:** `loadAllModels()` passed `path.join()` output directly to `import()`. On Windows this is a drive-letter filesystem path, not a portable ESM file URL. It now converts each model path with `pathToFileURL(...).href`.
- **Index option coverage:** behavioral normalization now includes `hidden`, wildcard projection, geospatial options, storage-engine options and `prepareUnique` in addition to unique/sparse/partial/TTL/collation/text options.
- **Duplicate definition lint:** in addition to duplicate names and unique+sparse-without-partial definitions, the linter now reports duplicate key + normalized-option definitions declared under different names, multiple text indexes on one collection, and unsupported sparse + partial-filter combinations.

The full model inventory and linter could not be executed in this workspace because Mongoose was unavailable. Therefore no claim is made that the actual model inventory is currently conflict-free.

### `backend/migrations/lib/indexMigration.js`

- Same-name text indexes were previously accepted without validating that the existing index was actually a text index. Text compatibility now checks the server text marker, field weights and declared/default language/collation behavior.
- Same-key incompatible definitions were previously treated as missing and sent to `createIndex()`. They now return a conflict, except the explicit legacy unique+sparse to partial-unique replacement path, which remains additive and never drops the legacy index.
- Duplicate aggregation now receives the declared index collation, so case-insensitive unique conflicts are not missed by a simple-collation grouping pass.
- A legacy sparse-index scan error was previously swallowed and represented as `legacy: []`. It now propagates and fails the migration rather than producing a falsely clean report.
- The old sparse index remains in place. The migration reports explicit-null counts and a manual removal instruction; it never drops indexes or alters documents.

### `backend/migrations/lib/migrationState.js` and `backend/migrations/011_ensure_production_indexes.js`

- Added `renewMigrationLock()` and a runner heartbeat. The runner checks lease ownership before and after each index operation.
- Takeover now compares the exact observed `leaseExpiresAt` value in the atomic update. A heartbeat that changes the lease after a contender's stale read prevents the takeover update from matching.
- Renewal requires an unexpired lease and the current owner token. Finalization requires an unexpired lease, accepts only `completed`, `blocked` or `failed`, and clears the lease on terminal state.
- The migration report now records the number of legacy sparse indexes reviewed. A failed legacy scan cannot silently produce a completed state.

These are source-level changes plus a direct fake-DB migration-state smoke check. The complete index migration test and real-Mongo concurrency/recovery tests were not executable because Mongoose and MongoDB were unavailable.

## 4. Windows ESM/path and S3 child-process failures

The shared filesystem-path mistake was using URL `.pathname` as a filesystem path and passing native Windows paths directly as ESM import specifiers.

Repaired all backend filesystem-path occurrences found in the test/migration code:

- `migrations/lib/indexInventory.js`: `pathToFileURL()` for dynamic model imports.
- `tests/storageService.test.mjs`: `fileURLToPath(new URL("..", import.meta.url))` for child-process `cwd`.
- `tests/canonicalTaxRate.test.mjs`: `fileURLToPath()` for the backend root.
- `tests/familyMemberOwnership.test.mjs`: `fileURLToPath()` for the backend root.

The S3 child-process probe also now inherits the parent environment (including Windows `SYSTEMROOT` and other platform variables) and asserts spawn error, exit status and the success marker separately. It remains an injected fake S3 client test; it is not a live bucket test.

MongoDB URI `.pathname` parsing is intentionally not changed as it parses a URI database component, not a filesystem path.

A native Windows runtime was not available, so Windows behavior is corrected by the portable Node URL APIs but not claimed as executed on Windows in this run.

## 5. PDF storage configuration mismatch

`env.invoiceStorageDir` and `INVOICE_STORAGE_DIR` were a second, unused invoice path setting. Current invoice creation and retrieval use `pdfDocumentStore` and `storageService` with the `invoices` category; the legacy config property was not referenced by those paths. Its old test asserted the unused path and could therefore pass while active storage used a different driver/root.

The dead `invoiceStorageDir` setting was removed. The PDF test now deliberately supplies a conflicting `INVOICE_STORAGE_DIR` value and verifies the active configuration is `STORAGE_DRIVER` + `STORAGE_LOCAL_ROOT`, with PDF bytes stored under the configured storage root. This regression test is authored but could not execute because the dependency tree is incomplete.

No `.env` file was present in the extracted workspace. No `.env` file was edited, and no credential values were printed. The supplied `.env.example` files are templates, not evidence of the runtime environment.

## 6. Real-Mongo safety and integration coverage

The previous destructive integration-suite guard accepted any database name containing a `test` token, even on a remote cluster. Because these suites call `dropDatabase()`, that was too permissive.

Added `backend/tests/mongo/safety.mjs` and applied it to all five real-Mongo suite entry points. The guard now requires a database named exactly `test` or ending in `_test` / `-test`; non-local MongoDB hosts additionally require the explicit `MONGODB_TEST_ALLOW_REMOTE=1` opt-in. The guard unit test passed.

Expanded `phase00.mongo.test.mjs` with real-server scenarios for:

- concurrent migration-lock acquisition;
- lease renewal, expiry recovery and stale-owner fencing;
- legacy unique+sparse plus partial-unique replacement behavior;
- collation-aware duplicate detection;
- migration state changing to `blocked` when duplicate invoice data prevents a unique index, preserving both rows, and changing to `completed` only after test-fixture cleanup and a verified rerun.

These real-Mongo cases are authored, not executed. No `mongod`, `mongosh`, Docker daemon or `MONGODB_TEST_URI` was available. No database was connected, dropped, migrated or modified.

## 7. Exact changed source/test files

- `backend/migrations/lib/indexInventory.js`
- `backend/migrations/lib/indexMigration.js`
- `backend/migrations/lib/migrationState.js`
- `backend/migrations/011_ensure_production_indexes.js`
- `backend/config/env.js`
- `backend/tests/helpers/fakeDb.mjs`
- `backend/tests/indexInventoryMigration.test.mjs`
- `backend/tests/storageService.test.mjs`
- `backend/tests/pdfDurableStorage.test.mjs`
- `backend/tests/canonicalTaxRate.test.mjs`
- `backend/tests/familyMemberOwnership.test.mjs`
- `backend/tests/mongo/safety.mjs`
- `backend/tests/mongoSafety.test.mjs`
- `backend/tests/mongo/phase00.mongo.test.mjs`
- `backend/tests/mongo/phase01.mongo.test.mjs`
- `backend/tests/mongo/phase02.mongo.test.mjs`
- `backend/tests/mongo/phase03.mongo.test.mjs`
- `backend/tests/mongo/financialConcurrency.mongo.test.mjs`

## 8. Execution evidence and blockers

| Command/check | Result | Notes |
|---|---|---|
| `node --check` on all changed JS/MJS files | PASS | Syntax only; does not resolve dependencies or execute application logic. |
| `node tests/mongoSafety.test.mjs` | PASS | Guard behavior only. |
| Direct `migrationState.js` + fake DB smoke | PASS | Acquisition, heartbeat, expiry takeover and stale-owner fencing. |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` in backend | BLOCKED | `ENOTCACHED` for `yauzl`; dependency tarball unavailable in local cache. |
| Prior online backend `npm ci` attempt | BLOCKED | Timed out; dependencies were not restored. |
| `npm run test:backend` | BLOCKED | 108 passed, 115 failed (223 total); failures stop at missing packages including `mongoose`, `bcrypt`, `dotenv`, `express`, `@aws-sdk/client-s3`, `@google/genai`, `razorpay`, `socket.io` and `supertest`. These are module-load failures, not established assertion failures. |
| `npm run test:frontend` | BLOCKED | Exit 127: `vitest` not found. |
| `npm run lint` | BLOCKED | Exit 127: `eslint` not found. |
| `npm run build` | BLOCKED | Exit 127: `vite` not found. |
| `npm run test:mongo` | BLOCKED / NOT RUN | No `MONGODB_TEST_URI`; `mongod`, `mongosh` and Docker unavailable. |
| Windows-native execution | BLOCKED | No Windows runtime in this environment. |
| S3 injected child-process test | BLOCKED | Backend dependencies unavailable; live S3 was not requested or attempted. |

## 9. Acceptance decision

**NOT PRODUCTION READY. DO NOT DEPLOY.** The code repairs are present in the isolated workspace, but model inventory lint, the full index migration suite, actual MongoDB semantics, complete backend/frontend suites, lint and production builds remain unverified.

Additional isolated module-level smoke checks were run after source edits using the real `indexMigration.js` / `indexInventory.js` modules, a temporary minimal Mongoose import stub, and the repository's fake Db helper. They passed text-index definition classification, duplicate inventory lint, partial-unique creation, legacy sparse reporting, duplicate blocking without document deletion, collation option forwarding and legacy scan error propagation. This is **fake-DB unit evidence only**; it does not load the actual Mongoose models or exercise MongoDB server semantics.
