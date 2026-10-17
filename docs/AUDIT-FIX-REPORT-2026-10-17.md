# MediCore HMS — Audit and Fix Report

**Audit date:** 2026-10-17  
**Input:** `MediCore-HMS-PHASE-03-PARTIAL-2026-10-16` source archive  
**Scope:** CI dependency lock, MongoDB payment-attempt concurrency, wallet-ledger reconciliation aggregation, environment-file hygiene, and static syntax checks.

## Findings and changes

### 1. Payment-attempt concurrency retry

**Finding:** `reserveAttempt()` read the latest attempt number and then inserted the next number. Concurrent writers can read the same number and race on the unique `(paymentId, attemptNumber)` index. The previous six immediate retries could repeatedly collide and end in a generic 409. The old catch also retried any duplicate-key error, even if it came from a different unique index.

**Change:** Increased the default retry budget to 16, added a short capped exponential backoff with jitter, and only retries duplicate-key errors identified as the `(paymentId, attemptNumber)` collision. Other duplicate-key errors now surface immediately rather than being hidden behind a generic reservation error.

### 2. Orphan payment-attempt recovery typo

**Finding:** The old-attempt cancellation branch called `newDate()`, which is not a JavaScript function. That path would throw while trying to cancel an expired orphan attempt.

**Change:** Replaced `newDate()` with `new Date()`.

### 3. Wallet reconciliation aggregate counting

**Finding:** Calling `.concat()` directly on a Mongoose Aggregate is invalid in the installed Mongoose API and caused the Phase 03 `agg.concat is not a function` failure.

**Change:** The delivered reconciliation service counts an aggregate by reading its pipeline and running a separate aggregate with `$count`, leaving the original paginated query intact.

### 4. Frontend npm lockfile

**Finding:** The lockfile omitted `@emnapi/core@1.11.3` and `@emnapi/runtime@1.11.3`, even though the optional Tailwind WASI package declares them. This matches the dependency-tree omissions reported by GitHub Actions.

**Change:** Added the two package records, verified registry tarball URLs and integrity values, and included their declared dependencies. The other WASI dependencies already present in the lockfile were retained.

### 5. Environment-file hygiene

**Finding:** The supplied ZIP included local `.env` and `backend/.env` files, outside the tracked source. These can contain private credentials.

**Change:** Excluded those local environment files and `.git` internals from the updated source archive. The safe `.env.example` templates and `.gitignore` files remain. If any real credentials from the original `.env` files were shared outside a trusted environment, rotate them.

## Validation performed

- `node --check` across all backend `.js` and `.mjs` files: **PASS**.
- JSON parsing of root/backend `package.json` and `package-lock.json`: **PASS**.
- Root lockfile check confirms `@emnapi/core@1.11.3` and `@emnapi/runtime@1.11.3` entries exist: **PASS**.
- `git diff --check`: **PASS** after normalizing line endings.

## Validation limitations

Full `npm ci`, unit tests, and real-MongoDB integration tests could not be executed in this build environment: the archive did not include `node_modules`, and npm registry access failed with `EAI_AGAIN`. Therefore this report does **not** claim that the complete runtime test suite passed. Run the install and test commands below in a network-enabled environment before merging or deploying.

## Recommended verification commands

From the project root:

```powershell
npm ci --no-audit --no-fund
npm run lint
npm run build
```

Then backend tests:

```powershell
cd backend
npm ci --no-audit --no-fund
npm test
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/hms_phase01_test"
npm run test:mongo
```

**Safety:** `test:mongo` drops the database named by `MONGODB_TEST_URI`. Use a disposable database whose name contains `test`; never point it at production or a database containing real patient/payment data.
