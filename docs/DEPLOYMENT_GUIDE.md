# Deployment and local setup guide

This guide documents the repository's configuration entry points. It does not certify that a deployment has succeeded. Verify every step in the target environment before using the service with real data.

## Deployment shapes

The repository includes frontend and backend container files, a root `docker-compose.yml`, an Nginx configuration, and hosting-related examples. A split-host setup is also supported by the configuration pattern: build the frontend separately and point `VITE_API_BASE_URL` at the backend API base URL.

Inspect `docker-compose.yml`, `Dockerfile`, `backend/Dockerfile`, and `nginx.conf` before deployment; their exact ports, health checks, volumes, and service names are authoritative.

## Local development

Requirements: Node.js compatible with `.nvmrc`, npm, and a local or managed MongoDB instance.

```bash
npm install
npm --prefix backend install
```

Create local environment files:

```bash
# Windows PowerShell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env

# macOS/Linux
cp .env.example .env
cp backend/.env.example backend/.env
```

Set `MONGO_URI` and `JWT_SECRET` in `backend/.env`. Configure the frontend's `VITE_API_BASE_URL` in the root `.env` to match the backend API base URL. Review both example files for optional integrations and other settings. Do not commit populated environment files.

Run the frontend and backend in separate terminals:

```bash
npm run dev
npm run dev:backend
```

## Docker Compose

The repository includes a Compose file. Before starting it, inspect the referenced environment variables, ports, volumes, and health checks. A typical workflow is:

```bash
docker compose config
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100
```

These commands are instructions, not recorded test results. This documentation pass did not run Docker or verify container health.

## Configuration references

- Root `.env.example`: frontend API/site URL and related public configuration.
- `backend/.env.example`: backend runtime, CORS, MongoDB, authentication, rate limiting, payment, and email configuration.
- `.nvmrc`: repository Node.js version selector.
- `render.yaml.example`, `vercel.json`, Dockerfiles, Compose, and Nginx files: deployment-specific configuration.

Keep secrets in the deployment platform's secret store. Do not put private keys or credentials in `VITE_*` variables; frontend variables are exposed to the browser build.

## Database migrations and data

Use a non-production database when learning or validating migration behavior. Read each migration script and its prerequisites before running it. Back up both database records and any separately stored uploaded files before production changes. This guide does not claim that any migration or backup/restore procedure has been executed successfully.

## Pre-release checklist

- Confirm the exact commit and runtime versions.
- Configure required environment variables and verify they are present without printing secrets.
- Confirm MongoDB connectivity and database selection.
- Build the frontend and run the documented backend checks.
- Exercise required flows in a browser against a test database and gateway.
- Verify uploads, logs, health checks, backups, and restore procedures.
- Review [Remaining Risks](REMAINING_RISKS.md) and record which release gates remain open.

See [Testing and Release Gates](TESTING-AND-RELEASE-GATES.md) for the evidence levels used by this project.
