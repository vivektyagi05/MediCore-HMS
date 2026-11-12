# MediCore HMS — Test and Validation Results

**Date:** 2026-11-02  
**Environment:** Node v22.16.0, npm 10.9.2, isolated ZIP extraction.

## Baseline commands and results

| Command | Result | Evidence / limitation |
|---|---|---|
| `node --version` | PASS | v22.16.0 |
| `npm --version` | PASS | 10.9.2 |
| `npm ci --no-audit --no-fund` (root) | BLOCKED | Timed out after 300 seconds; dependencies remained incomplete |
| `npm ci --no-audit --no-fund` (backend) | BLOCKED | Timed out after 300 seconds; dependencies remained incomplete |
| `cd backend && npm test` | BLOCKED | Runner reported 106 passed / 115 failed (221 total); failing test processes could not resolve packages such as `mongoose`, `bcrypt` and `dotenv` from incomplete `backend/node_modules` |
| `npm run lint` | BLOCKED | Exit 127: `eslint: not found` |
| `npm run test:frontend` | BLOCKED | Exit 127: `vitest: not found` |
| `npm run build` | BLOCKED | Exit 127: `vite: not found` |
| `npm run test:mongo` | NOT RUN | No MongoDB service or `MONGODB_TEST_URI` was supplied |
| Browser E2E | NOT RUN | No browser automation session or running app was available |
| Load/performance test | NOT RUN | No isolated load-test DB or load-test runner execution |

The backend suite's 106 passing files did execute and pass. The 115 failing files are not classified as product assertion failures: representative failures terminated during module resolution because the dependency tree was incomplete. The suite must be rerun after a successful clean dependency install before any backend pass/fail conclusion is drawn.

## Source-level checks

| Check | Result |
|---|---|
| Initial syntax scan | PASS — 808 `.js`, `.mjs`, `.cjs` files; zero syntax failures |
| Post-change syntax scan | PASS — 812 `.js`, `.mjs`, `.cjs` files; zero syntax failures |
| Changed backend controller/helper syntax checks | PASS |
| Changed frontend JSX compile | BLOCKED | Vite/esbuild dependencies unavailable; JSX transformation was not run |
| `node backend/tests/adminQueryObjectId.test.mjs` | PASS |
| Frontend URL filter helper assertions | PASS when exercised directly with Node assertions |

The direct helper checks do not replace the full Vitest or backend test suites.

## Environment warnings

During dependency installation, npm reported `EBADENGINE` warnings under Node v22.16.0 for resolved transitive packages including jsdom-related packages requiring Node >=22.22.2 and `undici` requiring Node >=22.19.0. The project declares Node >=22.12.0 and `.nvmrc` contains `22`; local runtime compatibility should be normalized to a supported current Node 22 patch before CI-equivalent validation.

## Required rerun after dependencies are available

```bash
# From repository root
npm ci --no-audit --no-fund
npm run lint
npm run test:frontend
npm run build

# Backend dependencies
npm --prefix backend ci --no-audit --no-fund
npm --prefix backend test

# Only with an isolated MongoDB test service/database
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/hms_ci_test npm --prefix backend run test:mongo
```

Do not run migrations, load-test cleanup or seed commands as part of this test rerun unless their target database has been independently verified.

## N-001 / N-023 continuation results (2026-11-02)

| Command/check | Result | Actual evidence |
|---|---|---|
| N-001 vs N-023 file comparison | PASS | Files are byte-for-byte identical; SHA-256 `98760d0882dfc65152e23c4d989c0c0a9e3e2dad75486f605f4a5acb14c02cd8`. |
| `node --check` on changed JS/MJS files | PASS | Every changed JS/MJS file parsed successfully. |
| `node tests/mongoSafety.test.mjs` | PASS | Disposable DB naming and remote-host opt-in guard assertions executed. |
| Direct migration-state fake-DB smoke | PASS | One concurrent owner, renewal, expiry takeover and stale-owner fencing. This is unit evidence only. |
| Backend `npm ci --offline --ignore-scripts --no-audit --no-fund` | BLOCKED | `ENOTCACHED` for `yauzl`; no complete dependency tree. |
| `npm run test:backend` | BLOCKED | 108 passed, 115 failed (223 total); failures were module-resolution errors for missing packages, not proven product assertion failures. |
| `npm run test:frontend` | BLOCKED | `vitest: not found` (exit 127). |
| `npm run lint` | BLOCKED | `eslint: not found` (exit 127). |
| `npm run build` | BLOCKED | `vite: not found` (exit 127). |
| Real MongoDB tests | BLOCKED / NOT RUN | No `MONGODB_TEST_URI`, `mongod`, `mongosh` or Docker. |
| Windows-native tests | BLOCKED | No Windows runtime. |
| PDF / S3 integration tests | BLOCKED | Required backend packages unavailable. |

The workspace contains no `.env` file. No `.env` was edited and no credential was exposed. Only template environment files are present. The backend test suite's module-load failures are explained by incomplete dependency installation in this execution environment; they are not evidence that `.env` content caused the failures.

A final repository-wide `node --check` pass after the N-001/N-023 continuation parsed **814 JavaScript/MJS/CJS files with zero syntax failures**. This is syntax evidence only. `node tests/mongoSafety.test.mjs` and the direct migration-state fake-DB heartbeat/expiry/takeover/fencing smoke also passed.

An additional isolated pure-index-module smoke harness (temporary Mongoose import stub + repository fake Db) passed text-index classification, duplicate lint, partial unique creation, legacy sparse reporting, duplicate blocking without deletion, collation forwarding and legacy-scan error propagation. A separate fake-DB CAS race smoke passed. Neither is a substitute for the complete Mongoose test file or a real MongoDB server.
