# Load-Test Dataset Tool

> **Status.** Written from the code in `backend/scripts/seed-load-test.mjs` and `backend/scripts/loadtest/`. **Nothing here was executed during the documentation audit** — not the dry run, not a seed, not verify, not cleanup, and not the two load-test test files. Behaviour below is what the code says it does. The original design plan, written before the tool existed, is kept at [`../LOAD-TEST-DATASET-PLAN.md`](../LOAD-TEST-DATASET-PLAN.md).

## 1. Two different seeders — do not confuse them

| | `backend/seed.js` | `backend/scripts/seed-load-test.mjs` |
|---|---|---|
| Purpose | Existing platform/bootstrap seed (`npm run seed` in `backend/`, `npm run seed:backend` at the root) | Synthetic, high-volume **load-test** dataset |
| Target | The application database configured by `MONGO_URI` | A separate **test-only** database from `MONGO_URI_TEST` |
| Status | Unchanged by the load-test tool | Standalone; does not replace, import or modify `seed.js` |

They are separate because their risk profiles differ: bootstrap data belongs in the real application database, whereas the load-test tool creates tens of thousands of fake users and financial records that must never share a database with real data. The load-test tool never connects with `MONGO_URI`; it only reads it to prove the target is a *different* database.

## 2. Architecture

| Module (`backend/scripts/loadtest/`) | Role |
|---|---|
| `profile.mjs` | Profiles, default counts, option validation, and the `plan` object |
| `safety.mjs` | Pure (no I/O) safety gates; unit-testable without a database |
| `ids.mjs` | Deterministic ObjectIds that also mark ownership |
| `rng.mjs` | Seeded deterministic random source (not listed in the original brief) |
| `generate.mjs` | Builds each synthetic document from the plan |
| `planpass.mjs` | Dry computation of expected counts without a database |
| `db.mjs` | Connection and model loading (the 18 models below) |
| `seeder.mjs` | Dependency-ordered bulk upserts |
| `verify.mjs` | Read-only integrity checks |
| `cleanup.mjs` | Run-scoped deletion |

### Profiles and scale
Profiles change **only related-record volume**. Role counts stay at the defaults (10,000 doctors, 10,000 patients, 50 `super_admin` users) unless overridden with `--doctors`, `--patients`, `--admins` (each 1–999,999).

| Profile | appointments per eligible doctor | saved per patient | admin logs per admin | cron logs | automation logs |
|---|---|---|---|---|---|
| `smoke` | 2 | 1 | 5 | 20 | 40 |
| `standard` (default) | 6 | 2 | 40 | 400 | 1000 |
| `large` | 20 | 3 | 200 | 2000 | 5000 |

`--scale <x>` (0 < x ≤ 100) multiplies related-record volume (not role counts). `--batch-size` is 10–10,000 (default 1000). Appointments = eligible-doctor pool × per-doctor value × scale.

### Deterministic IDs and run namespace
Every `_id` is built as `4c54` + first 4 bytes of `sha1(run-id)` + a 2-byte collection code + a 4-byte record index. The `4c54xxxx` prefix decodes to an ObjectId timestamp in 2010 — earlier than this product — so a real document cannot fall in a run's range. The same run id and seed therefore regenerate the same ids, and a run's records are identifiable purely by `_id` range. Seeded user emails use the reserved domain `<run-id>.medicore.test`.

### Collections generated (18)
`users`, `doctors`, `appointments`, `payments`, `invoices`, `doctorpayouts`, `transactionledgers`, `refundrequests`, `medicalnotes`, `prescriptions`, `reviews`, `notificationdeliveries`, `reminderlogs`, `chatmessages`, `saveddoctors`, `adminactivitylogs`, `cronrunlogs`, `automationrunlogs` — this matches the model map in `db.mjs`. Relationships follow the real models (for example `Appointment.doctorId` → `Doctor`, not `User`; see [database design](../architecture/database-design.md)). The tool does not generate wallets, withdrawals, subscriptions or other models.

### Write path
Order: users → doctor profiles → appointments → dependent collections (up to four in parallel) → saved doctors → admin, cron and automation logs. Writes are `bulkWrite` with `ordered: false`, `timestamps: false`, and a filter of exactly `{ _id }` with upsert, so reruns repair the same namespace and cannot match unrelated documents. Duplicate-key conflicts are retried up to 4 attempts; any other write error aborts, and unresolved conflicts abort **without deleting anything**. Passwords are hashed with bcrypt (`BCRYPT_SALT_ROUNDS`, default 12), reusing an existing hash when the password still matches.

## 3. Safety model
All gates are evaluated in `safety.mjs`. A write requires every one to pass; a dry run reports them but opens no connection.

| Gate | Rule |
|---|---|
| Opt-in | `SEED_LOAD_TEST=1` |
| Environment | `NODE_ENV=production` is refused |
| Target | `MONGO_URI_TEST` required and parseable; has host and an explicit database name |
| Database name | Must match `^[a-z0-9][a-z0-9_-]*[_-](loadtest\|test)$` (case-insensitive): a real prefix followed by `_` or `-` then `loadtest` or `test` (e.g. `medicore_loadtest`, `hms_test`). Reserved names (`admin`, `local`, `config`, `test`, `production`, `prod`, `staging`, `live`, `hms`, `medicore`, `medicore-hms`, …) and names or hosts containing `prod`, `production`, `prd`, `live`, `staging` or `stage` as a word are refused |
| Separation | Refused if host and database equal the application `MONGO_URI` |
| Password | `LOAD_TEST_PASSWORD`, at least 12 characters (writes only) |
| Confirmation | Seed needs `--confirm-load-test-seed`; it is mutually exclusive with `--dry-run` |
| Cleanup | Needs an exact `--run-id` and `--confirm-load-test-cleanup`; without the latter it only reports |
| Ownership | Cleanup deletes only documents whose `_id` is inside that run's deterministic range |

If `MONGO_URI_TEST` is supplied but unsafe, the dry run exits non-zero (code 2).

## 4. Runbook
Commands are the package scripts in `backend/package.json` (run from `backend/`; extra flags go after `--`).

1. **Configure** — copy `backend/.env.loadtest.example` to a private env file and set `SEED_LOAD_TEST=1`, `MONGO_URI_TEST=<dedicated test database, name matching the pattern above, e.g. `medicore_loadtest`>`, `LOAD_TEST_PASSWORD=<12+ chars>`. Export them into the shell; never reuse production credentials.
2. **Dry run (default)** — `npm run seed:loadtest -- --dry-run`. No connection, no writes; prints the plan and gate results.
3. **Seed** — `npm run seed:loadtest -- --confirm-load-test-seed [--profile smoke|standard|large] [--scale 0.5] [--run-id my-run] [--doctors N --patients N --admins N] [--ensure-indexes]`. `--ensure-indexes` explicitly creates schema indexes on the **test** database first. `--anchor-date YYYY-MM-DD` and `--seed <str>` make reruns reproducible.
4. **Verify** — `npm run seed:loadtest:verify -- [same --profile/--scale/--run-id/--seed/--anchor-date as the seed]`. Read-only. Add `--skip-timings` to skip explain/timing samples, `--json` for machine output; non-zero exit if a check fails. Checks cover per-collection counts, role counts, reserved-domain and duplicate emails, orphaned or inconsistent doctor/appointment/payment/invoice/payout/ledger/refund relationships, slot uniqueness, and (when a manifest exists) that foreign document counts are unchanged.
5. **Cleanup one run** — `npm run seed:loadtest:cleanup -- --run-id <id>` (report only), then add `--confirm-load-test-cleanup` to delete. Exit code 3 and "nothing was deleted" if no records match the id.

**Never** run any of this with `MONGO_URI_TEST` pointing at production or at the application database, and never relax or bypass the gates. The tool is not part of the normal deploy path.

### The seed manifest
On a successful seed the tool writes `backend/scripts/loadtest/.manifests/<run-id>.json`, used by verify's foreign-count check. **That directory is not listed in `.gitignore`**, contrary to the original plan — see [Remaining risks](../REMAINING_RISKS.md).

## 5. Tests
Both run inside the standard backend suite (`node tests/run-all.mjs` picks up every top-level `*.test.mjs`).
- `backend/tests/loadTestSeederSafety.test.mjs` — `evaluateSafety` gates and target parsing, plus cleanup's `ownedFilter`.
- `backend/tests/loadTestSeederGeneration.test.mjs` — determinism, id ranges, counts (e.g. 20,050 users and 39,000 appointments for default `standard` settings), validation of generated documents with the real Mongoose schemas (`validateSync`), business invariants, and an assertion that `backend/seed.js` contains no load-test or destructive operations.
Neither was run in this audit.

## 6. Open points
- The data-volume totals in the original plan (§10) are not asserted by tests and were not re-derived; run the dry run to confirm them.
- Gates on `LOAD_TEST_PASSWORD` apply to writes only; dry run does not require it.
