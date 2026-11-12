# Testing Guide

> **Status: derived from `package.json`, `backend/package.json`, `backend/tests/`, `src/**/*.test.*`, `.github/workflows/ci.yml` and the scripts directories. No test, lint, build or script was executed during the documentation audit, so no pass/fail result or coverage figure is claimed.** Counts below are *file counts at the audited snapshot*; they are not test-case counts and must not be added together.

## Test categories

| Category | What | Files at snapshot | Command | In CI |
|---|---|---|---|---|
| Backend unit / contract tests | Top-level `backend/tests/*.test.mjs`; `tests/run-all.mjs` runs each file in its own Node process and reports one PASS/FAIL per file | 221 | `npm --prefix backend test` (root: `npm run test:backend`) | Yes — `backend` job |
| Database-backed tests | `backend/tests/mongo/*.mongo.test.mjs` (financial concurrency, phases 00–03). Skipped unless `MONGODB_TEST_URI` points at a disposable database | 5 | `npm --prefix backend run test:mongo` | Yes — `backend-mongo` job (`mongo:7` service) |
| Frontend tests | Vitest files under `src/` | 21 | `npm run test:frontend` | **No** |
| Lint / build | ESLint and production build | — | `npm run lint`, `npm run build` | Yes — `frontend` job |
| SEO test subset | Three `p20Seo*` files | 3 (also inside the 221) | `npm --prefix backend run test:p20-seo` | Via the 221 |
| Runtime verification scripts | Scripts that exercise a running backend with imported LGD data | 4 chained | `npm --prefix backend run verify:runtime` | No; needs a live API/database |
| UI verification (jsdom) | Component/page harnesses in `backend/scripts/ui-verification/`; not a real browser; not part of `npm test` | — | see script headers | No |
| Locale/structure validators | `scripts/validate-p13-locales.mjs`, `validate-p14/15/16.mjs` | 4 | `node scripts/<file>` | No |
| Production smoke | Health and public endpoints of a deployed instance | 1 | `npm run smoke:production` (needs `BACKEND_URL`) | No |
| Load testing | **No load-test runner exists in the repository.** Only a dataset generator, see [load testing](load-testing.md) | — | `npm run seed:loadtest -- --dry-run` (backend) | No |
| Manual QA | [Test matrix](test-matrix.md) and [scenario documents](scenarios/) | — | manual | — |
| Production verification | [Deployment runbook](../deployment/deployment-runbook.md) acceptance list | — | manual | — |

## Notes
- The backend suite counts a file as one test. A historical figure such as "221/221" refers to files, not assertions.
- Several tests read documentation: `automationCronEntrypoint.test.mjs` reads `docs/SCHEDULER-ARCHITECTURE.md`, and `masterDataLgdImportContract.test.mjs` checks `backend/master-data/source/lgd/README.md`. Changing those documents can fail the suite.
- Historical release gates: [release-gates.md](release-gates.md).
- Current CI does not run frontend tests, and no coverage tooling configuration was found in the scripts.
