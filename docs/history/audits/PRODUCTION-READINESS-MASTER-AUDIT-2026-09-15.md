# MediCore HMS — Master Production Readiness Audit

Audit date: 2026-09-15

## Goal

The target for this pass is not a visual demo. The target is a deployable application in which every feature currently exposed by the product is backed by a real route, real persistence, real business logic, and a real external provider where the feature requires one. Unsupported capabilities must remain explicitly unavailable rather than returning fabricated success.

## Historical production issues tracked

1. **GitHub push/rebase conflict** — resolved previously by aborting the conflicting rebase and replacing the remote history with the audited local release. This is a repository-history issue, not an application runtime issue.
2. **Brevo recipient blocked/unsubscribed** — resolved in the Brevo account by restoring the intended transactional-email recipient state. The backend already uses the real Brevo HTTP API and requires a `messageId` acceptance response.
3. **Vercel deep-link refresh** — fixed by the root `vercel.json` SPA rewrite. `/forgot-password`, `/login`, and other React routes can be opened directly.
4. **Frontend/backend API prefix inconsistency** — corrected architecture is one Axios base URL ending in `/api`; feature modules use `/auth`, `/public`, `/appointments`, etc. They must not independently add the production host or duplicate `/api`.
5. **Render global rate-limit exhaustion (429)** — confirmed root cause: `/api` global limiter was shared by public discovery and auth. Production bursts could exhaust the bucket before password recovery. This release separates global, public, auth, and realtime policies.
6. **Password recovery provider failure (503)** — backend now returns stable provider-specific error codes and invalidates the OTP when delivery fails; frontend distinguishes provider failure from a browser connectivity failure.
7. **Render running in development mode** — production configuration must set `NODE_ENV=production`; `TRUST_PROXY=1` is required for the single Render proxy hop.
8. **Socket/HTTP process instability** — previous unhandled socket rejections and unbounded shutdown behavior were fixed with async socket wrappers, bounded process shutdown, DB connection observability, and socket rate-map cleanup.
9. **Duplicate MongoDB indexes** — duplicate `Appointment.bookingRequestId` and `RefundRequest.paymentId` declarations were removed while preserving intentional indexes.
10. **Error middleware not registered** — fixed previously; routes now terminate in the application's JSON `notFound`/`errorMiddleware` contract.
11. **Backend test runner/path problems** — the backend has a dependency-free runner rather than incorrectly invoking Vitest against plain assertion files. P12 contract tests in this release no longer depend on the caller's working directory.
12. **AI was deterministic/template-only by default** — this was a genuine non-real-AI gap. A real OpenAI Responses API provider is now implemented. Production refuses the template provider and requires a real provider key.

## Current production architecture

### Request throttling

- General API: `2500 / 15 minutes` by default.
- Public discovery: `180 / minute` by default.
- Authentication: `20 / 15 minutes`.
- Password recovery: `1 / minute` and `5 / 15 minutes` per email, plus auth IP limiting.
- Realtime: `120 / minute`.
- `/api/health` is excluded from application throttling.

The purpose is separation, not simply making every limit huge.

### Payments

Production defaults to the real Razorpay adapter. `PAYMENT_GATEWAY_MODE=test` is now rejected during production boot. The test gateway remains available only for local/CI verification.

### Email

Production requires Brevo credentials. Password recovery and transactional receipts use the real Brevo HTTP API. A successful provider response must contain `messageId`.

### AI

Production defaults to `openai` unless explicitly configured otherwise. `AI_TEXT_PROVIDER=template` is rejected in production. The real provider preserves the structured response shape already consumed by the frontend and fails closed if the model returns an incompatible response; it does not silently fall back to deterministic fake content.

## Explicitly NOT claimed as complete yet

These are deployment/runtime tasks that cannot be truthfully completed from a source ZIP without the user's live credentials/infrastructure:

- Live Render deployment and restart.
- Live MongoDB production database verification/migration execution.
- Live Razorpay sandbox payment + webhook + refund click-through.
- Live Brevo send/OTP/reset click-through.
- Live OpenAI generation with a real API key.
- Real browser E2E across patient → doctor → admin → finance journeys.
- Docker daemon execution and container health verification in this audit environment.
- Durable object storage/backup for uploaded patient documents and generated files.
- Redis-backed Socket.IO/rate-limit infrastructure if the service is scaled beyond one backend instance.

## Features that are intentionally not fabricated

- SMS provider is not integrated.
- Generic WhatsApp delivery is not integrated.
- Process Designer Delay/Wait remains explicitly unsupported until a durable job scheduler exists.
- Generic AutomationFlow replay/dead-letter execution is not invented where no real gateway replay path exists.
- Direct insurer-specific connectors are not claimed where vendor credentials/contracts are absent.

## Release gate

The release is only production-complete after the live environment passes the smoke test and the critical business flows listed in `docs/DEPLOYMENT-RUNBOOK-2026-09-15.md`.
