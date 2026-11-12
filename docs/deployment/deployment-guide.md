# Deployment Guide

> **Status: rewritten from `docker-compose.yml`, `Dockerfile`, `backend/Dockerfile`, `nginx.conf`, `render.yaml.example`, `vercel.json`, `.github/workflows/ci.yml` and `backend/scripts/`. Nothing was deployed, built or started during the audit.** `render.yaml.example` states that it is an example and that nothing in it has been provisioned. Production readiness is not asserted here; see [Project status](../PROJECT_STATUS.md) and [Remaining risks](../REMAINING_RISKS.md).

## Runtime topology
Three process roles share one MongoDB:

| Role | Command | Notes |
|---|---|---|
| **release** | `node backend/scripts/release.mjs` (`npm run release` in `backend/`) | Run once per deploy before web/worker. Steps in order: `preflight` → LGD master-data import (migration 005) → payment active-slot migration (012) → ensure indexes (011) → verify indexes (011 `--dry-run`). Any failing step aborts with a non-zero exit. |
| **web** | `node backend/server.js`, `SERVICE_ROLE=web` | HTTP API + Socket.IO. Never runs the scheduler. Probe: `GET /api/health/ready` (liveness: `GET /api/health`). |
| **worker** | `node backend/worker.js`, `SERVICE_ROLE=worker` | No HTTP; runs the in-process scheduler. Deploy exactly one. See [scheduler](../SCHEDULER-ARCHITECTURE.md). |

`docker-compose.yml` defines five services: `mongo` (`mongo:7`, volume `mongo-data`), `release`, `backend` (port 5000), `worker`, and `frontend` (nginx, host port 8080 → 80). The frontend image is built with `VITE_API_BASE_URL=/api`; `nginx.conf` proxies `/api/` and `/socket.io/` to `backend:5000` and falls back to `/index.html` for client routes. Both Dockerfiles use Node 22 (`node:22-alpine` build stage); `engines` requires Node ≥ 22.12.0.

Other targets present in the repository: `render.yaml.example` (web / worker / release split, example only) and `vercel.json` (SPA rewrite to `/index.html`).

## Configuration
All variables are in [environment-variables.md](../development/environment-variables.md). `node backend/scripts/preflight.mjs` (`npm run preflight`) runs the same production guards as server boot and prints variable names and reasons, never values. Key production rules: `SERVICE_ROLE` set explicitly; `PAYMENT_GATEWAY_MODE=razorpay` with Razorpay keys and webhook secret; `AI_TEXT_PROVIDER=gemini` with Gemini key and model; Brevo key and sender; no `localhost` in URL settings; `JWT_SECRET` ≥ 32 chars.

## Local container run (documented by compose, not executed here)
`docker compose up --build` from the repository root, then open `http://localhost:8080`. Provide the backend environment as the compose file expects.

## Data seeding
`backend/seed.js` (`npm run seed` in `backend/`) is the platform bootstrap seed. The synthetic load-test dataset tool is separate and must never target production; see [load testing](../testing/load-testing.md).

## CI
`.github/workflows/ci.yml` has three jobs on Node from `.nvmrc`: `backend` (`npm test`), `backend-mongo` (`npm run test:mongo` against a `mongo:7` service container), and `frontend` (`npm run lint`, `npm run build`). `npm run test:frontend` (vitest) is **not** run by CI. CI results for any commit were not examined.

## Not verified
Live Razorpay, Brevo, Gemini, storage and hosting behaviour; whether any environment is deployed; image builds.

For a step-by-step acceptance checklist see [deployment runbook](deployment-runbook.md).
