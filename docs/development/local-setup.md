# Local Development Setup

> **Status: derived from manifests and example files; the steps were not executed during the audit.**

## Prerequisites
- Node.js **≥ 22.12.0** (`engines` in both `package.json` files; `.nvmrc` pins Node 22). The earlier README claim of "Node 20+" is wrong.
- npm, and a MongoDB instance (the compose file uses `mongo:7`).

## Install
- Frontend: `npm install` at the repository root.
- Backend: `npm install` inside `backend/`.

## Configure
Copy `backend/.env.example` to `backend/.env` and fill it in; copy the root `.env.example` for `VITE_*` frontend variables. `backend/.env.example` is incomplete — see [environment variables](environment-variables.md) for every variable read by the code. In development the test payment gateway and `AI_TEXT_PROVIDER=template` avoid external services; production validation is stricter.

## Run
| Task | Command |
|---|---|
| Frontend dev server | `npm run dev` (Vite) |
| Backend with reload | `npm --prefix backend run dev` (nodemon) |
| Backend once | `npm run dev:backend` or `npm --prefix backend start` |
| Worker process | `npm --prefix backend run start:worker` |
| Bootstrap seed | `npm --prefix backend run seed` (or `npm run seed:backend`) — uses `SEED_SUPER_ADMIN_*` variables |
| Lint / build | `npm run lint`, `npm run build` |

Tests: see the [testing guide](../testing/testing-guide.md). Deployment: [deployment guide](../deployment/deployment-guide.md). With `SERVICE_ROLE` unset or `all` in development the scheduler runs in-process unless disabled ([scheduler](../SCHEDULER-ARCHITECTURE.md)).
