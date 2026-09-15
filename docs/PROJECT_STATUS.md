# Project Status

## Current release

MediCore HMS does not currently follow a versioned release model.
`package.json` / `backend/package.json` both list `"version": "1.0.0"` as
a static field — that number is not maintained as a meaningful release
indicator (it has not been bumped across the many phases described in
`CHANGELOG.md`), so it should not be read as a maturity signal in either
direction. There is no tagged release and no alpha/beta designation that
is actually kept current, so none is asserted here.

**Status: Active development.**

Repository visibility: public (per `license`).

## Development philosophy

MediCore HMS has been built in many small, phase-by-phase passes (see
`CHANGELOG.md` and `docs/README.md`'s "Historical Phases" section) rather
than as one continuous build. Each phase typically targets one product
area or one class of bug, ships with its own changelog, and is verified as
thoroughly as the available environment allows before moving on.

## Current engineering focus

The most recent phases (P23) have focused on **financial correctness**:
payments, refunds, wallet, wallet recharges, and doctor payouts/
withdrawals. This work replaced a signature-verification-only wallet
credit path with a real, auditable lifecycle, fixed a refund-request
contract bug, and fixed several refund state-machine bypasses. See
`docs/FINANCIAL_ARCHITECTURE.md` for the resulting architecture and
`CHANGELOG.md` for the phase-by-phase history.

## Completed phases (high level)

Per `docs/README.md`'s documentation index, completed phases cover:
public-facing discovery (search, profiles, SEO, articles/CMS),
authentication and password recovery, appointment booking and lifecycle,
the clinical workspace, doctor practice management (onboarding, schedule,
earnings, reviews), patient relationship tooling, admin operations
(user/access management, monitoring, process automation and governance,
integration hub), and the P23 financial-correctness track. See
`docs/FEATURES.md` for the current per-feature implementation status and
the individual `CHANGELOG-*.md` files (in `docs/`, and at the repo root
for the most recent P23 sub-phases) for what each phase specifically
changed.

## Known limitations

See `docs/REMAINING_RISKS.md` for the full, maintained list. In summary:

- The real Razorpay payment path has not been exercised against a live
  Razorpay sandbox in this environment — only the in-repo test gateway has
  been run end-to-end (see `docs/FINANCIAL_ARCHITECTURE.md`).
- No Docker daemon, live MongoDB, or deployed instance has been available
  in this environment to verify `docker compose up`, a real load test, or
  a full click-through of the payment/appointment lifecycle.
- Uploaded-file backups (invoices, prescriptions, reports, insurance docs)
  are not yet automated.
- The realtime layer's presence tracking and rate-limit counters are
  in-process memory — correct for one backend instance, not yet safe for
  horizontal scaling.
- Two dependency advisories (Vite, react-router-dom) need a dedicated
  major-version upgrade pass.
- No independent security audit, SAST/DAST scan, or git-history secret
  scan has been run.
- Performance conclusions are from static code review, not live profiling
  or load testing.

## Verification status (as of this documentation pass)

The three checks defined in `.github/workflows/ci.yml` were run locally
against the current codebase:

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **Fails — 7 pre-existing errors** (an unused variable in `backend/controllers/financeController.js`, an unnecessary escape character in `backend/services/contentHelpers.js`, and duplicate object keys in three `src/i18n/locales/` files). Not introduced by this documentation pass. |
| Backend tests | `npm test` (in `backend/`) | **90 passed / 4 failed** (94 total). The 4 failures are pre-existing: three are a test-runner path-resolution bug (`process.cwd()`-relative reads that assume repo-root cwd, actually run from `backend/`), and one (`servicePartialUpdate.test.mjs`) is an export-name mismatch against `serviceAdminController.js`. |
| Frontend build | `npm run build` | **Succeeds.** Emits a build-size warning for one ~701 KB chunk (206 KB gzipped) and a ~160 KB `CoverageMap` chunk — not an error. |

Full detail on each of these is in `docs/REMAINING_RISKS.md` §9. They are
disclosed rather than fixed in this pass, consistent with this pass's
scope being documentation and GitHub-readiness, not application or
test-code changes.

**Production readiness** — explicitly distinguished, per
`docs/REMAINING_RISKS.md` and `docs/DEPLOYMENT_GUIDE.md`:

- *Code-level readiness*: the application code for the features listed in
  `docs/FEATURES.md` exists and is structured with explicit financial
  state machines, error handling, and role-based access control.
- *Automated-test readiness*: 90/94 backend tests currently pass (see
  table above); no frontend automated test suite exists in this
  repository as of this writing.
- *Runtime readiness*: not verified in this environment — no live
  MongoDB, no live Razorpay sandbox, no live browser.
- *Staging readiness*: not established — no staging environment exists.
- *Production readiness*: **not claimed.** Do not deploy this as a
  production healthcare service handling real patient or payment data
  without independently closing the gaps in `docs/REMAINING_RISKS.md` and
  `SECURITY.md` first.
