# MediCore HMS — Deployment Guide

## 1. Two supported deployment shapes

MediCore HMS is a standard three-tier app: React/Vite SPA, Express/Mongoose API,
MongoDB. This phase adds Docker support for both of the shapes the project
already assumed:

1. **Split hosting** (what the codebase was already built for): the frontend is
   built as static assets and hosted anywhere that serves static files; the
   backend runs as its own Node service (e.g. Render, Railway, a VM); MongoDB
   is a managed instance (e.g. MongoDB Atlas). `VITE_API_BASE_URL` points the
   built frontend at the backend's public URL.
2. **Single-host Docker Compose** (new in this phase): `docker-compose.yml` at
   the repo root runs MongoDB, the backend, and an Nginx-served frontend
   together on one host. Useful for a staging box, a demo environment, or a
   small on-prem deployment. Not a substitute for a managed MongoDB in real
   production — see §4.

Both shapes use the same `backend/Dockerfile` and root `Dockerfile`.

## 2. Docker Compose (quick start)

```bash
cp backend/.env.example backend/.env      # fill in real secrets
docker compose build
docker compose up -d
docker compose ps                          # check health status
curl http://localhost:5000/api/health      # backend
curl http://localhost:8080                 # frontend
```

- Frontend: http://localhost:8080 (Nginx, serves the built SPA, proxies
  `/api` and `/socket.io` to the backend service)
- Backend: http://localhost:5000
- MongoDB: internal only (`mongo:27017`), not published to the host by default

Uploaded files (invoices, prescriptions, patient reports, insurance documents)
are written to `./storage` inside the backend container and are persisted via
the `backend-storage` named volume — **do not** remove this volume without
backing it up first (see §5).

**This Compose stack has been reviewed for correctness but could not be
executed with a live `docker build`/`docker compose up` in the environment
this phase was produced in (no Docker daemon available there) — see the
Verification Report for exactly what was and wasn't run.** Before relying on
it, run `docker compose up` yourself once and confirm `docker compose ps`
shows all three services healthy.

## 3. Split hosting (backend + static frontend separately)

### Backend
```bash
cd backend
npm ci --omit=dev
# Set all vars from .env.example in your host's environment/secrets manager
npm start
```
Or build/run `backend/Dockerfile` directly as its own service.

### Frontend
```bash
npm ci
VITE_API_BASE_URL=https://api.yourdomain.com/api npm run build
# Upload dist/ to any static host (Vercel, Netlify, S3+CloudFront, Nginx, etc.)
```
`VITE_API_BASE_URL` is compiled in at build time (Vite env vars are not
runtime-configurable) — rebuild if the backend's URL changes.

## 4. Environment configuration

Copy `backend/.env.example` to `backend/.env` (or your platform's secret
store) and fill in real values. As of this phase, **production boots now
fail fast** (see `config/env.js`) if any of the following are missing when
`NODE_ENV=production`:

- `CORS_ORIGIN` — must be your real frontend origin, not a wildcard
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `JWT_SECRET` — must be at least 32 characters; generate with e.g.
  `openssl rand -base64 48`

Also set `TRUST_PROXY` to the number of reverse-proxy hops in front of the
backend (usually `1` for a single load balancer/Render/Nginx). This is new in
this phase — see the Security Audit Summary for why it matters.

For managed MongoDB (recommended for real production over the Compose
stack's local `mongo:7` container): use MongoDB Atlas or equivalent, and set
`MONGO_URI` to its connection string. Enable Atlas's own automated backups
(see §5).

## 5. Backups & restore

- **Compose/local MongoDB**: back up the `mongo-data` volume regularly, e.g.
  `docker compose exec mongo mongodump --archive=/data/db/backup.archive`
  then copy that file off the host. Restore with `mongorestore`.
- **Managed MongoDB (Atlas)**: enable Atlas's continuous/point-in-time backup
  — this is strongly preferred over manual dumps for real production.
- **Uploaded files** (`backend-storage` volume / `backend/storage/` dir):
  these are *not* covered by a MongoDB backup — back them up separately
  (e.g. a scheduled `rsync`/object-storage sync of the volume). No such job
  exists yet; see Remaining Risks.
- **Restore drill**: not yet exercised end-to-end in this phase (would
  require a real MongoDB + real backup file) — flagged in Remaining Risks
  rather than claimed done.

## 6. CI/CD

`.github/workflows/ci.yml` runs on every push/PR to `main` with three jobs:
- `lint` — `npm run lint` (frontend + backend, one ESLint config covers both)
- `backend-tests` — `npm test` inside `backend/` (`backend/tests/run-all.mjs`)
- `frontend-build` — `npm run build`

There is **no MongoDB service container** in this workflow. The backend
test suite (`backend/tests/*.test.mjs`) is dependency-free by design — each
file is spawned with dummy env vars and does not open a real database
connection (see `backend/tests/run-all.mjs`) — so no live Mongo is needed to
run it in CI. If a future test genuinely requires a live database, add a
`services: mongo:` block to the `backend-tests` job at that point rather
than assuming one is already there.

As of this pass, running the workflow's three commands locally gives:
`npm run lint` fails with 7 pre-existing errors (unrelated to this
documentation pass — see Remaining Risks §9), `npm test` (backend) reports
90 passed / 4 failed (also pre-existing — see Remaining Risks §9), and
`npm run build` succeeds. The workflow is expected to go red on `lint` and
`backend-tests` the first time it runs until those pre-existing issues are
fixed; that is a real, disclosed current-state fact, not a workflow bug.

It does not deploy anywhere — no cloud target was specified, and none is
invented here. Add a `deploy` job once a target (Render, a container
registry, etc.) is chosen.

## 7. Rolling out this phase to an existing deployment

Nothing in this phase changes the database schema or breaks existing API
contracts. The changes are: safer socket-event handling, bounded process
shutdown, a few real bug fixes (see the Production Readiness Report), new
required-in-production env vars (`CORS_ORIGIN`, the three `RAZORPAY_*` vars —
audit that these are already set wherever you deploy today, since a plain
`NODE_ENV=production` boot will now fail without them), and the new
`TRUST_PROXY` var (defaults safely, but review it for your actual proxy
setup). No special migration steps are required.
