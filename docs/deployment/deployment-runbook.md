# Deployment Runbook and Acceptance Checklist

> **Status: rewritten during the documentation audit from the dated runbook** ([`DEPLOYMENT-RUNBOOK-2026-09-15.md`](../history/historical-status/DEPLOYMENT-RUNBOOK-2026-09-15.md), preserved unchanged apart from a banner). The acceptance checklist is carried over as a **manual procedure**; nothing in it was executed in this audit and no deployment was contacted. Corrections to the original: the AI provider settings (`openai`/`OPENAI_*`) are not supported by the code; the release phase, `SERVICE_ROLE` and worker are now required; the readiness probe is `/api/health/ready`.

Read first: [deployment guide](deployment-guide.md), [environment variables](../development/environment-variables.md).

## 1. Backend configuration
Set variables in the hosting dashboard, never in Git. Minimum production set (see the guide for rules): `NODE_ENV=production`, `SERVICE_ROLE` (`web` for API instances, `worker` for the single worker), `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`, `FRONTEND_URL`, `SEO_SITE_URL`, `TRUST_PROXY`, `PAYMENT_GATEWAY_MODE=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `AI_TEXT_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and storage settings. Rate-limit variables (`RATE_LIMIT_*`, `PUBLIC_RATE_LIMIT_*`) are optional tuning.

## 2. Release phase (every deploy, before web/worker)
`node backend/scripts/preflight.mjs`, then `node backend/scripts/release.mjs`. A non-zero exit means do not start new instances.

## 3. Health checks
Readiness `GET /api/health/ready`; liveness `GET /api/health`. The production boot log should report the `production` environment.

## 4. Frontend
Set `VITE_API_BASE_URL` to the backend's public `/api` URL at build time and redeploy after changes. `vercel.json` rewrites all paths to `/index.html`.

## 5. Smoke test (from a machine with network access)
`BACKEND_URL=<backend> FRONTEND_URL=<frontend> node scripts/production-smoke.mjs` (also `npm run smoke:production`). It checks the health endpoint and several public endpoints.

## 6. Manual acceptance checklist
Mark each item only with real evidence from a real environment.
- **Authentication:** register; duplicate email → 409; valid login → session; invalid login → 401; logout clears client session.
- **Password recovery:** recovery record created; Brevo returns a `messageId`; OTP arrives; reset token is single-use; session invalidated through `securityVersion`; provider failure returns an error, not fake success.
- **Booking:** patient picks a real doctor/slot; appointment persisted and visible to the doctor; approval transitions the same appointment; payment created for it.
- **Razorpay:** order created; sandbox payment completed; signature and amount/currency verified server-side; webhook processed against the same payment; duplicate webhook idempotent; invoice generated; refund exercised through to final state.
- **Realtime:** two users connect; presence works; authorised chat works; unauthorised chat rejected; notification failure does not roll back the originating transaction.
- **Clinical:** doctor opens a patient; notes saved; prescription only in an allowed state; document upload persisted and visible to the patient.
- **Admin:** RBAC blocks cross-role access; permission changes audited; CMS changes appear publicly; finance/refund actions update the same records the other roles see.

## 7. Durability and scaling (still open)
- Local `backend/storage` is not a backup strategy; use durable object storage (`STORAGE_DRIVER=s3`) before real patient data.
- Presence is in-process and no Socket.IO adapter exists; rate limiters use the default in-memory store (no `store:` option in `app.js` or the middleware). Add shared state before running more than one web instance. See [Remaining risks](../REMAINING_RISKS.md).
