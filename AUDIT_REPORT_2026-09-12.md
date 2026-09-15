MediCore HMS — End-to-End Deployment/Logic Audit
Audit date: 2026-09-12

SCOPE
- Audited the uploaded project source.
- Focus: Vercel SPA routing, Render API connectivity, authentication, password recovery, Brevo email delivery, transactional email callers, error UX, duplicate indexes, and production/deployment configuration.
- No real credentials are included in this fixed package.

CONFIRMED FROM THE PROVIDED LOCAL/RENDER LOGS
1. MongoDB connectivity works.
2. Public API routes return 200/304.
3. /api/auth/register returns 409 for an existing email and 201 for a genuinely new email.
4. /api/auth/login returns 401 for invalid credentials and 200 for valid credentials.
5. /api/auth/forgot-password has successfully returned 200 when Brevo accepted the email.
6. When Brevo rejected credentials, backend correctly produced 503 and invalidated the recovery OTP.
7. Rate limiting correctly produces 429 after repeated password-recovery requests.
8. SIGINT/SIGTERM shutdown messages shown in the logs are graceful shutdowns, not evidence of an application crash.

FIXES APPLIED
1. Added root vercel.json SPA rewrite:
   /(.*) -> /index.html
   This prevents direct navigation/refresh of React routes such as /forgot-password from returning Vercel 404.
2. Improved authentication error UX:
   - 401 login is shown as an authentication failure.
   - 409 registration now surfaces the actual safe server message ("Email is already registered").
   - 429 is shown as rate limiting instead of a network error.
   - 503 is shown as service unavailable where applicable.
   - validation details are surfaced when the backend provides safe field messages.
3. Improved password-recovery error UX:
   - Brevo credential failure has a distinct user-safe message.
   - Brevo rate limiting has a distinct message.
   - Brevo network/unreachable failure has a distinct message.
   - provider 5xx/unavailable is distinguished from a browser/network failure.
   - HTTP 429 from the account limiter is no longer reported as "could not reach MediCore".
4. Improved OTP verification/resend error handling:
   - network, rate-limit, invalid-code, provider-unavailable and server errors are separated.
5. Added localized English/Hinglish/Hindi strings for the new recovery/provider states.
6. Removed duplicate Mongoose index declarations:
   - Appointment.bookingRequestId: removed field-level index; retained unique sparse schema index.
   - RefundRequest.paymentId: removed field-level index; retained the intentional compound/partial indexes.
7. Transactional email service no longer silently reports "skipped" when Brevo is not configured.
   It now raises a real configuration error; existing business callers already catch email failures so core appointment/payment/refund transactions are not rolled back merely because notification delivery fails.
8. Transactional email attachment read failures now fail the email operation rather than silently sending an incomplete message.
9. Transactional email acceptance is logged with Brevo messageId.
10. Public contact submission response now records whether its acknowledgement email was delivered/failed/skipped, and the contact UI warns the user if the enquiry was accepted but email acknowledgement was unavailable.

IMPORTANT ARCHITECTURE FINDINGS
- Vercel -> Render API URL is structurally correct when VITE_API_BASE_URL is set to:
  https://medicore-hms-nc0z.onrender.com/api
- Render CORS is env-driven and structurally correct when CORS_ORIGIN equals the Vercel production origin.
- The uploaded project did not contain vercel.json, which is a real SPA deep-link deployment gap.
- Render logs showed NODE_ENV=development. Production Render configuration should explicitly set NODE_ENV=production.
- Render logs showed MongoDB database "test". This is not inherently a code failure, but it must be intentional; production should use the intended production database/database name.
- Brevo is used through the real transactional API endpoint:
  https://api.brevo.com/v3/smtp/email
- Password recovery uses a real CSPRNG OTP, bcrypt hash, expiry, attempt limit, one-time verification, and separate reset-token hash.
- Test payment gateway is selected only when PAYMENT_GATEWAY_MODE=test; production defaults to the Razorpay adapter.

REMAINING DEPLOYMENT ACTIONS
These require the user's actual Vercel/Render dashboards and real credentials, so they were not fabricated or changed in source:
1. Vercel Production Environment:
   VITE_API_BASE_URL=https://medicore-hms-nc0z.onrender.com/api
   Then redeploy Production.
2. Render Environment:
   NODE_ENV=production
   CORS_ORIGIN=https://medi-core-hms-woad.vercel.app
   FRONTEND_URL=https://medi-core-hms-woad.vercel.app
   SEO_SITE_URL=https://medi-core-hms-woad.vercel.app
   Preserve existing real secrets.
3. Verify BREVO_API_KEY and BREVO_SENDER_EMAIL are real, active, and the sender is verified in Brevo.
4. Verify MONGO_URI points to the intended production database, not an accidental "test" database.
5. Render health check path should be /api/health.
6. After deployment, test:
   - direct /login
   - direct /register
   - direct /forgot-password
   - forgot password -> Brevo email -> OTP -> reset token -> password change -> login
   - existing-email registration -> 409
   - invalid login -> 401
   - repeated recovery request -> 429
   - Brevo failure -> user-visible provider/service error
   - contact form -> acknowledgement email status
   - appointment approval -> confirmation email
   - payment completion -> receipt email
   - refund completion -> refund email

TESTING LIMITATION
- Changed JavaScript files passed Node syntax checks.
- P15 locale modules successfully imported after the patch.
- A full npm dependency install/build/test could not be completed in this isolated audit runtime because npm registry artifacts were not available locally; npm --offline failed on an uncached package. Therefore this report does NOT falsely claim a fresh full frontend build/backend test pass for the patched package.
- The user-provided local logs demonstrate that the unpatched project had previously passed its backend test suite and that the local backend successfully exercised registration, login, password recovery, realtime and patient/admin routes.

NO-CREDENTIAL POLICY
- Real .env and backend/.env files were excluded from the fixed package.
- No API key, database URI, JWT secret, Razorpay secret, or Brevo credential was copied into source or documentation.
