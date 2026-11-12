# MediCore HMS — Database Reconciliation Report

**Date:** 2026-11-02  
**Status:** BLOCKED — no live database connection was supplied.

## Scope reviewed

Static inspection covered:

- `backend/config/db.js`
- `backend/config/env.js`
- `backend/scripts/release.mjs`
- `backend/scripts/loadtest/safety.mjs`
- `backend/scripts/seed-load-test.mjs`
- Migration and integrity-audit script inventory

## Configuration findings

- Application DB connection is sourced from `MONGO_URI`.
- The DB connection log emits host and database name, not credentials.
- `autoIndex` is enabled only when the environment is not production.
- The release lifecycle runs preflight, LGD master-data import, payment active-slot processing, index migration and a dry-run index verification.
- Load-test tooling uses `MONGO_URI_TEST` rather than connecting to the application `MONGO_URI`. It requires explicit opt-in and a separate test/load-test database name, and checks that the target is not the same application host/database.

## Runtime reconciliation not performed

No real `.env` or `MONGO_URI` was present in the ZIP. Therefore the following are **not verified**:

- Actual database host and database name used by web, worker, tests and migration scripts.
- Actual collections and document counts.
- Actual index inventory versus model definitions.
- Missing/obsolete/duplicate indexes.
- Legacy document fields and enum values.
- Orphaned references or duplicate business records.
- Wallet, payment, invoice, refund, payout and ledger invariants.
- Which migrations have executed in the target database.
- Whether the load-test dataset already exists and is complete.

## Safety decision

No migration, seeder, cleanup, index rebuild, collection drop, financial repair or production write was executed. This is intentional: the target database cannot be identified or independently confirmed from the supplied snapshot.

## Safe next execution plan

1. Supply a non-secret confirmation of the intended database environment and database name; do not paste credentials into reports.
2. Use a verified backup/recovery path before any write migration.
3. Run the repository preflight against the intended environment.
4. Run migration dry-runs or report-only modes where available.
5. Record affected collections, counts and index differences.
6. Execute only approved migrations against the verified target.
7. Independently query the resulting indexes and document invariants.
8. Preserve before/after counts and migration logs in this report.

## Migration status

| Migration group | Execution status | Reason |
|---|---|---|
| Master data / LGD | NOT RUN | No DB connection or target confirmation |
| Payment active slot | NOT RUN | No DB connection or target confirmation |
| Production index migration | NOT RUN | No DB connection or target confirmation |
| Other backfills | NOT RUN | No DB connection or target confirmation |
| Load-test seed / cleanup | NOT RUN | No test DB target confirmation |

No rollback claim is made because no migration was executed.

## N-001 / N-023 index migration follow-up (2026-11-02)

The supplied N-001 and N-023 evidence files are identical by SHA-256, so they do not constitute independent audit runs. The implementation audit identified and repaired index classification, collation-aware duplicate scanning, legacy sparse scan error propagation, and migration lease renewal/takeover fencing. See `docs/audits/INDEX_AUDIT_RECONCILIATION.md` for exact file-level details.

The new real-Mongo tests are authored but were not run. `MONGODB_TEST_URI` was not set; `mongod`, `mongosh` and Docker are unavailable. The new test guard requires a dedicated `test` / `*_test` database and an explicit opt-in for remote hosts. No migration was run and no database records or indexes were changed.

The actual model-derived index inventory, `lintInventory()` result, current server indexes, duplicate document counts, legacy sparse indexes, partial unique index behavior and migration-state collection remain **BLOCKED / UNKNOWN**. Fake-DB and static checks must not be reported as real database reconciliation.
