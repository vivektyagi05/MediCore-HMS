# MediCore HMS — Remaining Issues and Blockers

**Date:** 2026-11-02

## P0 — Verification blockers

1. **Dependency installation incomplete.** Both root and backend `npm ci` attempts timed out. Backend suite had 115 module-load failures; frontend lint/test/build executables were unavailable. Repeat from a network-enabled environment with a supported Node 22 patch.
2. **Live MongoDB state unknown.** No real `.env` or database connection was supplied. Do not claim schema/index/data reconciliation complete.
3. **Financial reconciliation unverified.** No real or isolated financial dataset was queried; payment, invoice, refund, wallet, ledger and payout invariants remain unverified.
4. **Production and browser behaviour unverified.** No real browser E2E, deployed API, production logs or live workflow was available.

## P1 — Product correctness and admin usability

1. **Admin pagination UI incomplete in reviewed list pages.** Backend pagination metadata exists, but patient, appointment, payment, invoice and refund pages use fixed limits and do not expose next/previous page navigation. Implement page state in the URL and preserve filters/sorting across page changes.
2. **Context filter presentation incomplete.** Add visible, accessible filter context (patient/doctor/payment identity) and clear-context controls to deep-linked list pages.
3. **Latest-request protection needs consistent review.** Ensure a slower old response cannot overwrite a newer filter result on every admin/patient/doctor list page.
4. **Cross-entity navigation requires full E2E verification.** Test every relationship in the master prompt and verify the identifier type at each edge.
5. **Backend query validation sweep incomplete.** The appointment/payment/refund ObjectId context filters were fixed, but other admin list filters (including review, withdrawal and finance cursor filters) need the same malformed-value review.

## P2 — Broader audit work not completed

- Complete mounted API route/controller/service/ownership review.
- Full patient and doctor dashboard workflow audit.
- Authentication/session/JWT and cross-user authorization tests.
- File upload/storage authorization and persistence verification.
- Realtime/chat/notification delivery and reconnect tests.
- Full payment gateway/webhook replay and concurrency test execution.
- Migration-by-migration dry-run and actual index/data comparison.
- Query-plan review and p50/p95/p99 load measurements on the isolated `medicore_loadtest` dataset.
- CI run on GitHub Actions and deployment lifecycle verification.

## Safety constraints

- Do not execute any migration until the target database is confirmed and a recovery path exists.
- Do not seed or clean a load-test database until `MONGO_URI_TEST` is confirmed to point to a separate `_loadtest` / `_test` database.
- Do not modify financial records to make tests green.
- Do not treat a successful syntax check or unit helper test as evidence of end-to-end correctness.

## N-001 / N-023 continuation blockers (2026-11-02)

1. **Dependencies unavailable:** offline `npm ci` fails `ENOTCACHED`; online installation previously timed out. Backend suite: 108 pass / 115 module-load failures. Frontend Vitest, ESLint and Vite executables are missing.
2. **Real MongoDB not available:** `MONGODB_TEST_URI` unset; no `mongod`, `mongosh` or Docker. Do not run index migration or claim index reconciliation complete.
3. **Model-derived index lint not executed:** the Mongoose model imports cannot run until dependencies are installed. New duplicate key/options lint must be run against the complete model inventory.
4. **Windows and S3 runtime not executed:** portable path fixes are in place, but native Windows and child-process S3 test require a complete dependency environment.
5. **PDF regression not executed:** the unused `INVOICE_STORAGE_DIR` config has been removed and test coverage updated, but the PDF test needs Mongoose/PDFKit/AWS dependencies to execute.
6. **Remote Mongo tests require explicit opt-in:** after independently confirming the target is disposable, set `MONGODB_TEST_ALLOW_REMOTE=1` in addition to a dedicated database name ending `_test` / `-test`.

Production deployment remains blocked until the real-Mongo index suite, full backend/frontend tests, lint and builds pass in a dependency-complete environment.
