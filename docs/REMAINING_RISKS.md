# MediCore HMS — Remaining Risks

Ordered roughly by how much it should matter for a real production launch.

## 1. Dependency upgrades needing a dedicated pass (breaking changes)

- **Vite** and **react-router-dom** each have an open high-severity advisory
  whose fix requires a major-version bump (`npm audit fix --force`). Neither
  was force-applied in this phase — both are the kind of change that needs
  its own regression pass (Vite: build/dev-server behavior; react-router-dom:
  routing behavior across every page in the app), not to be bundled
  silently into a stability/hardening phase. Budget a follow-up for this
  specifically.

## 2. No live-environment verification was possible here

Every fix in this phase was verified as thoroughly as this environment
allows (see Verification Report) — but there is no Docker daemon, no live
MongoDB, and no deployed instance available here. Concretely still needed
before calling this "done":
- Run `docker compose up` and confirm all three services report healthy.
- Push to GitHub and watch the CI workflow's first real run.
- A real load test against the socket layer specifically — the stability
  fix is proven correct in isolation (mocked handlers/servers), not yet
  proven under real concurrent WebSocket traffic.
- A full click-through of the payment/appointment lifecycle against a real
  MongoDB + Razorpay sandbox (this gap predates this phase and was already
  flagged in earlier project phases — still open).

## 3. Uploaded-file backups are not yet automated

Invoices, prescriptions, patient reports, and insurance documents are
written to local disk (`backend/storage/`, or the `backend-storage` Docker
volume). MongoDB backups (via Atlas or `mongodump`) do **not** cover these
files. No scheduled backup job exists for this directory/volume yet — see
Deployment Guide §5. This is a real data-loss risk for anything users have
uploaded, independent of database backup strategy.

## 4. Single-instance assumptions in the realtime layer

`socket/presenceManager.js`'s online-tracking and the rate-limit counters
in `socket/eventHandlers.js` are in-process memory. This is correct and
fine for exactly one backend instance. The moment this is horizontally
scaled (multiple backend instances behind a load balancer), each instance
will have its own partial view of who's online and its own independent
rate-limit buckets — Socket.IO's own Redis adapter (or similar) would be
needed first. Not a bug today; will silently misbehave the moment a second
instance is added without this.

## 5. Encryption at rest depends entirely on hosting choice

`docker-compose.yml`'s local `mongo:7` container does not encrypt data at
rest by default. If real patient data will ever touch that specific
Compose stack (rather than a managed MongoDB with encryption-at-rest, like
Atlas), that needs its own storage-level encryption configured — this
wasn't set up in this phase since it's a deployment/hosting decision, not a
code change.

## 6. No secrets-in-git-history or SAST/DAST scan was run

This phase's security work was a manual code-level review plus `npm audit`
for known dependency CVEs. It did not include scanning git history for
committed secrets, a static-analysis security pass, or any dynamic
scanning/pen-testing against a live instance (none exists to test against).
Recommended before a real production launch, run by a team with the tooling
and mandate for it.

## 7. Performance numbers are review-based, not measured

The Performance Audit Summary's conclusions (indexing looks healthy, query
patterns look fine) are from static code review of the highest-traffic
models/controllers, not from profiling against real data volumes or a real
load test. Fine as a first pass; don't treat it as a substitute for actually
measuring once there's real traffic or a staging environment to load-test.

## 8. Frontend bundle size

The main shared chunk is ~701 KB (206 KB gzipped) after `npm run build`,
plus a ~160 KB `CoverageMap` chunk — Vite's build output warns about both.
Not broken, not urgent, but worth a dedicated pass (manual chunking / more
aggressive route-level `import()`) if initial load time on slow connections
becomes a real user complaint.

## 9. Pre-existing lint errors and backend test failures (found during the
   documentation/GitHub-readiness pass, not introduced by it)

Running the exact commands the new CI workflow (`.github/workflows/ci.yml`)
runs turned up issues that predate this pass:

- **`npm run lint` — 7 errors**: an unused variable in
  `backend/controllers/financeController.js`, an unnecessary escape
  character in `backend/services/contentHelpers.js`, and duplicate object
  keys (`trustText`, `continuityText`, `review`) in three i18n locale files
  under `src/i18n/locales/` (`p13.en.js`, `p13.hi.js`, `p19.en.js`).
- **`npm test` (backend) — 90 passed / 4 failed** out of 94 test files:
  - `p12BookingAuthFlow.test.mjs` and `p12GeographicSearchConsistency.test.mjs`
    fail with `ENOENT` — they read source files with paths like
    `"backend/routes/appointmentRoutes.js"` resolved against
    `process.cwd()`, which only works if the test runner's cwd is the repo
    root. The documented run path (`backend/package.json`'s `test` script,
    invoked from inside `backend/`) has cwd = `backend/`, so the path
    doubles to `backend/backend/routes/...` and the read fails. This is a
    test-runner path-assumption bug, not a bug in the routes/controllers
    themselves.
  - `p12Geography.test.mjs` fails for the same underlying reason (a
    cwd-relative import resolves to the wrong module, so a schema lookup
    hits `undefined`).
  - `servicePartialUpdate.test.mjs` fails because it imports
    `buildUpdatePayload` from `backend/controllers/admin/serviceAdminController.js`,
    which does not export a function by that name — a genuine
    test/implementation contract mismatch, not investigated further in this
    documentation pass.

None of these were fixed here — this phase's brief was documentation and
GitHub-readiness, not application or test-code changes (see
`CONTRIBUTING.md` / the project's own "don't rewrite business logic just to
make docs prettier" rule). They are disclosed here, in
`docs/PROJECT_STATUS.md`, and in the CI workflow's own comments so the
first real CI run's failures are expected and traceable rather than a
surprise.
