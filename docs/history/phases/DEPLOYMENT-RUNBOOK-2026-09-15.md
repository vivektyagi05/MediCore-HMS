# MediCore HMS — Production Deployment Runbook

## 1. Render backend environment

Set these values in Render. Never paste secrets into Git or chat.

```text
NODE_ENV=production
PORT=5000
CORS_ORIGIN=https://medi-core-hms-woad.vercel.app
FRONTEND_URL=https://medi-core-hms-woad.vercel.app
SEO_SITE_URL=https://medi-core-hms-woad.vercel.app
TRUST_PROXY=1

RATE_LIMIT_MAX=2500
RATE_LIMIT_WINDOW_MS=900000
PUBLIC_RATE_LIMIT_MAX=180
PUBLIC_RATE_LIMIT_WINDOW_MS=60000

PAYMENT_GATEWAY_MODE=razorpay
AI_TEXT_PROVIDER=openai
OPENAI_MODEL=gpt-5.6-luna
OPENAI_TIMEOUT_MS=30000
```

Preserve the real values for:

```text
MONGO_URI
JWT_SECRET
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
BREVO_API_KEY
BREVO_SENDER_EMAIL
BREVO_SENDER_NAME
OPENAI_API_KEY
```

## 2. Render health check

Use:

```text
/api/health
```

Expected response: HTTP 200 and `{ success: true, data.status: "healthy" }`.

The boot log must say:

```text
environment: production
```

## 3. Vercel

Production variable:

```text
VITE_API_BASE_URL=https://medicore-hms-nc0z.onrender.com/api
```

Redeploy after changing it.

## 4. Smoke test from a machine with network access

```bash
BACKEND_URL=https://medicore-hms-nc0z.onrender.com \
FRONTEND_URL=https://medi-core-hms-woad.vercel.app \
node scripts/production-smoke.mjs
```

## 5. Critical end-to-end acceptance

### Authentication

- Register a new patient.
- Existing-email registration returns 409.
- Valid login returns a JWT session.
- Invalid login returns 401.
- Logout clears the client session.

### Password recovery

- Forgot password creates a real recovery record.
- Brevo accepts the message and returns `messageId`.
- OTP arrives in the real inbox.
- Valid OTP creates a real one-time reset token.
- New password is saved.
- Existing JWT sessions are invalidated through `securityVersion`.
- Old reset token cannot be reused.
- Brevo failure returns a provider-specific 503, not fake success.

### Booking

- Patient chooses a real doctor and real availability.
- Appointment is persisted.
- Doctor sees the appointment.
- Doctor approval transitions the same appointment.
- Payment is created for the same appointment.

### Razorpay

- Create a real Razorpay order.
- Complete a Razorpay sandbox payment.
- Verify signature server-side.
- Verify the gateway amount/currency.
- Process the webhook against the same payment.
- Ensure duplicate webhooks are idempotent.
- Generate invoice/receipt.
- Exercise refund and verify final payment/refund state.

### Realtime

- Two authenticated users connect.
- Presence changes are persisted/emitted.
- Authorized patient/doctor chat works.
- Unauthorized chat relationship is rejected.
- Notification delivery does not break the originating transaction.

### Clinical

- Doctor opens a real patient.
- Consultation notes are saved.
- Prescription is saved only in an allowed consultation state.
- Medical report/document upload is persisted.
- Patient sees the resulting record.

### Admin

- RBAC prevents cross-role access.
- Permission changes are audited.
- CMS/service changes appear on the public side.
- Finance/refund actions update the same persistent records used by patient/doctor views.

## 6. Data durability before real patient data

The default local `backend/storage` volume is not a production backup strategy. Move invoices, prescriptions, reports, and insurance uploads to durable object storage with lifecycle/backup policy before treating the deployment as a hospital production system.

## 7. Scaling

The current realtime presence and in-process rate-limit stores are correct for one backend instance. Before adding a second Render instance, add a shared Redis adapter/store and verify Socket.IO room/presence semantics under concurrent load.
