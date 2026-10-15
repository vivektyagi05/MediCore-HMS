# Testing and release gates — Phase 00

## Evidence levels

| Level | Meaning | Phase 00 result |
|---|---|---|
| L1 unit / static contract | Pure logic, fakes, source contracts | **PASSED** — backend 172/172 (`npm --prefix backend test`) |
| L1 build | `eslint .`, `vite build`, `npm ci` ×2, `node --check` on entrypoints | **PASSED** |
| L1 local filesystem | Real temp dir for storage (atomic write, traversal, legacy) | **PASSED** (`pdfDurableStorage.test.mjs`) |
| L2 real MongoDB (index metadata, lock arbitration, fencing, duplicate aggregation) | `tests/mongo/phase00.mongo.test.mjs` | **BLOCKED_EXTERNAL** — no `mongod`; `mongodb-memory-server` download fails (`ENOTFOUND fastdl.mongodb.org`). Written, syntax-checked, **never executed**. |
| L3 multi-process | Two OS processes racing one lock | **BLOCKED_EXTERNAL** — needs L2 first; only in-process concurrency (25 concurrent `trackRun`) is written for the real-Mongo file. |
| L4 container / CI | `docker build`, compose `release→backend+worker`, GitHub Actions | **NOT VERIFIED** — no Docker daemon or CI runner here. |
| L5 production | Migration 011 on real data, deployed worker heartbeats, S3/volume persistence across a redeploy | **NOT VERIFIED** |

New/rewritten test files: `cronJobLocking`, `financialScheduler` (rewritten), `indexInventoryMigration`, `pdfDurableStorage`, `deployLifecycle`, `helpers/fakeDb.mjs`. Four existing tests had source-regex assertions pinned to the old index declarations / production-env fixture and were updated to the new declarations (`notificationLifecycleIdempotency`, `notificationPhase2Contract`, `productionConfigGuards`, `cronJobLocking`).

Fake-Db tests prove our migration/lock **logic**; they do not prove MongoDB's behaviour (e.g. that the server accepts a same-key, different-name partial index beside a legacy sparse one — the migration handles refusal by reporting FAILED/exit 2, but that path is only simulated).

## Release gates (ALL must hold before Phase 00 is called deployed)

| # | Gate | Status |
|---|---|---|
| G1 | `npm --prefix backend test` green (172/172) | ✅ |
| G2 | `npm run lint` 0 errors; `npm run build` succeeds | ✅ |
| G3 | `npm ci` succeeds for root and backend lockfiles | ✅ |
| G4 | `npm run test:mongo` passes against a real MongoDB 7 (CI job `backend-mongo` or local) | ❌ not run |
| G5 | `npm run verify:indexes` (dry-run) against a **copy of production data** reports no `blocked_duplicates` / `conflict`; duplicates, if any, resolved by a human | ❌ not run |
| G6 | `npm run release` succeeds in staging; `GET /api/health/ready` returns 200 afterwards | ❌ not run |
| G7 | Staging has exactly one `SERVICE_ROLE=worker`; `CronRunLog` shows all 6 jobs with fresh `heartbeatAt` / recent `success` rows | ❌ not run |
| G8 | Kill the worker mid-job in staging: next owner reclaims within one lease (2 min), old row is `timed_out`, no job reported success twice | ❌ not run |
| G9 | Generate an invoice, redeploy/restart the container, download it again (volume or S3 persistence proven) | ❌ not run |
| G10 | `SERVICE_ROLE` (and `ENABLE_IN_PROCESS_SCHEDULER` for `all`) set in every production environment **before** the new build boots | ❌ operator action |
| G11 | Legacy sparse indexes reviewed; `dropIndex` run only after the partial replacement is confirmed present | ❌ operator action |

**Verdict: NOT READY to deploy** until G4–G11 are done. Code-complete for Phase 00 ≠ production-verified.

## How to run

```
# unit + static (anywhere)
npm --prefix backend test

# real MongoDB (disposable DB whose name contains "test"; it is DROPPED)
MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase00_test npm --prefix backend run test:mongo

# against any environment: plan only, changes nothing, exit 3 if indexes missing
npm --prefix backend run verify:indexes
# apply (idempotent, non-destructive)
npm --prefix backend run migrate:indexes
# full release phase: preflight -> 005 -> 011 -> verify
npm --prefix backend run release
```

Migration 011 exit codes: `0` ok · `2` blocked (duplicates / conflict / failed create) · `3` dry-run found missing indexes · `4` another runner holds the lock · `1` unexpected error.


---

# Phase 01 gates (payment core) — added 2026-10-14

| Gate | Requirement | Status |
|---|---|---|
| P1-G1 | `npm --prefix backend test` | ✅ 175/175 (172 baseline + `phase01PaymentCore` 53 checks, `phase01CheckoutRecovery` 9, `phase01Contracts`) |
| P1-G2 | `eslint .` and `vite build` | ✅ 0 errors; build succeeds |
| P1-G3 | `npm run test:mongo` (now includes `phase01.mongo.test.mjs`) against a real MongoDB 7 | ❌ NOT RUN (BLOCKED_EXTERNAL: no mongod) |
| P1-G4 | `npm run migrate:payment-slot -- --dry-run` on a **copy of production data** reports no conflicts (exit 0 or 3; exit 2 = duplicate active payments to resolve by hand) | ❌ not run |
| P1-G5 | `npm run release` in staging runs 012 then 011; `uniq_payment_active_appointment` exists (`npm run verify:indexes`) | ❌ not run |
| P1-G6 | Razorpay **sandbox**: pay an order; pay the same order after a forced retry; send `payment.failed` after capture; replay a webhook; kill the app between capture and post-processing | ❌ not run (no sandbox credentials). No real payment/refund was sent. |
| P1-G7 | Staging worker shows the new `recoverPaymentEvents` job (every 1 min) with fresh heartbeats (7 financial jobs, previously 6) | ❌ not run |
| P1-G8 | Browser E2E: callback success, callback timeout while captured, modal closed, refresh/reconnect, double click | ❌ not run (only pure-logic + source-contract tests) |

**Verdict: NOT READY to deploy.** Code-complete for Phase 01 is not production-verified. Run P1-G3..G8 first.

Run: `npm --prefix backend run migrate:payment-slot` (add `--dry-run` to only report). Exit codes: `0` ok · `2` blocked: duplicate active payments listed, **nothing written** · `3` dry-run found payments needing the flag · `4` lock held · `1` error. `npm run release` now runs `012` before `011` (011 builds the unique index from the flag; it is re-run on every release, so the new index is created without a new "migration 011" record).
