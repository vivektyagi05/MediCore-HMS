# Phase P15 — Secure Password Recovery with Real Email OTP

This phase adds a real forgot-password → OTP → reset-password flow to
MediCore HMS, delivered via Brevo's transactional email API. P14's
authentication UX (Login/Register/AuthPageFrame) is unchanged except for
one additive "Forgot password?" link and one additive `AuthPageFrame`
story-copy branch (`mode="recovery"`).

## 1. Architecture

```
POST /api/auth/forgot-password         (email) -> generic response + recoveryId
POST /api/auth/verify-password-reset-otp (recoveryId, otp) -> resetToken
POST /api/auth/reset-password           (resetToken, newPassword) -> success
```

Storage: a dedicated `PasswordReset` model (Option B from the brief), not
fields on `User` — a recovery attempt has its own lifecycle (expiry,
attempt counting, one-time consumption, superseding) that doesn't belong
on the account itself.

```
User ──1:N──► PasswordReset { otpHash, otpExpiresAt, otpAttemptCount,
                               otpVerifiedAt, resetTokenHash,
                               resetTokenExpiresAt, consumedAt }
```

Nothing in this model is ever a raw credential: `otpHash` (bcrypt) and
`resetTokenHash` (sha256) are `select: false` by default.

## 2. OTP generation & storage

- `crypto.randomInt(100000, 1000000)` — CSPRNG, not `Math.random()`/`Date.now()`.
- OTP hashed with bcrypt (same cost factor as user passwords) before
  storage — a 6-digit space is small enough that a fast hash (sha256)
  would let a leaked DB be brute-forced offline in seconds; bcrypt's
  deliberate slowness matters here even though it doesn't for high-entropy
  secrets.
- Raw OTP exists only in memory for the duration of one request, and only
  ever leaves the process as an argument to the Brevo send call.

## 3. Reset authorization is not the OTP

Verifying the OTP does **not** itself authorize a password change. It
mints a second, independent secret — a 32-byte `crypto.randomBytes`
reset token, hashed with sha256 (fast hash is fine here: 256 bits of
entropy makes offline brute force infeasible regardless of hash speed) —
with its own 15-minute expiry and one-time consumption. `reset-password`
only accepts this token, never the OTP itself.

## 4. Expiry, attempts, one-time use

- OTP: 15-minute expiry and reset-token: 15-minute expiry, with 5 max incorrect attempts, both re-checked at the
  application layer on every verify call (never trusted to Mongo TTL
  alone).
- Every "use it once" transition (attempt increment, OTP verification,
  reset-token consumption) is a single atomic `findOneAndUpdate` with the
  precondition (`consumedAt: null`, `otpVerifiedAt: null`, etc.) baked into
  the query filter — never a separate find-then-update, which would leave
  a race window for concurrent reuse.
- A new `forgot-password` request immediately consumes (invalidates) any
  prior active `PasswordReset` record for that user — only the newest OTP
  can ever succeed. This is also how "resend" is implemented: resend
  **is** `forgot-password`, called again.

## 5. Email enumeration protection

`forgot-password` returns the identical `{ success: true, message, data:
{ recoveryId, expiresInSeconds } }` shape whether the email belongs to a
real active account, an unknown address, or an account whose OTP email
failed to send. For an unknown email, `recoveryId` is a random
24-hex-char value not tied to any document — a later `verify-otp` call
against it falls through to the same generic "invalid or expired" branch
as a wrong code against a real record, never a different message. A
bcrypt-cost dummy hash runs on the unknown-email path to roughly equalize
response latency (a mitigation, not a constant-time guarantee — Brevo's
own network latency on the real path still varies).

## 6. Email failure handling

If Brevo's API call fails (config missing, rejected, 5xx, network/timeout),
the `PasswordReset` record just created is immediately consumed before
the (still-generic) response is returned. The OTP that was minted for
that attempt can never be entered successfully, even though the user
never sees an error. Safe internal logging captures only an event name,
a status category, and (on success) Brevo's message id — never the API
key, the OTP, or the email body.

## 7. Brevo integration

`backend/services/otpEmailService.js` calls Brevo's `POST
/v3/smtp/email` directly via Node's built-in `fetch` (no new dependency —
the Dockerfile's healthcheck already relies on native `fetch`, so this
matches the project's existing convention rather than introducing
`@getbrevo/brevo` or axios for a single JSON POST). Kept separate from
`backend/services/emailService.js` (the existing nodemailer/SMTP service
used for appointment/payment/refund email) rather than merged into it —
two unrelated transports in one module would be harder to reason about
for no benefit.

- Sender: `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME`, both required. There
  is **no fallback sender** (`support@medicore.com` etc.) — if unset, the
  send throws `BrevoConfigurationError` and the calling controller treats
  it exactly like a delivery failure (record invalidated, generic
  response returned).
- Template: if `BREVO_OTP_TEMPLATE_ID` is set, the send uses that Brevo
  transactional template with `{OTP, EXPIRY_MINUTES, NAME}` params.
  Otherwise it falls back to the inline HTML in
  `backend/emails/passwordRecoveryEmail.js`. No fabricated template ID is
  ever used.

## 8. Session invalidation

Added `User.securityVersion` (default `0`). `generateToken` embeds it in
every JWT payload; `authMiddleware.protect` now rejects any token whose
embedded `securityVersion` doesn't match the user's current value.
`reset-password` increments `securityVersion` by 1 on success — this is
the entire mechanism that makes "all previously issued sessions/tokens
become invalid" true, without a server-side token blocklist. It only
touches the one account being reset.

## 9. Rate limiting

Layered on top of the existing IP-based `authLimiter` in `app.js`
(unchanged): `backend/middleware/accountRateLimit.js` adds an in-process,
account-keyed sliding-window limiter —
- `forgot-password`: up to 10 requests / 60s per email + 60 requests / 15 min per email. A separate IP limiter allows up to 60 recovery requests / 60s from a network without sharing the login/register bucket.
- `verify-password-reset-otp`: 15 attempts / 15 min per `recoveryId`.

This is a second layer, not a replacement, and uses the same in-process
approach as the existing limiter (no new store/library). Like
`authLimiter`, it is per-process — an accepted limitation for a
single-instance deployment, not a new one introduced here.

## 10. Frontend

- `/forgot-password`, `/verify-otp`, `/reset-password` — reuse
  `AuthPageFrame` (additive `mode="recovery"` branch), `Input`, `Button`.
- `OtpInput` — six accessible digit boxes: numeric-only, paste-splits
  across boxes, arrow-key/backspace navigation, auto-advance, `aria-live`
  error announcement, `autoComplete="one-time-code"` on the first box.
- The `recoveryId` and `resetToken` travel only in React Router
  navigation `state` — never the URL, never localStorage/sessionStorage.
  Opening `/verify-otp` or `/reset-password` directly (refresh, bookmark)
  redirects back to `/forgot-password` since there's no state to act on.
- i18n: `p15.en.js` / `p15.hi.js` / `p15.hinglish.js`, registered in each
  locale index; validated for key parity by `scripts/validate-p15.mjs`.
- SEO: all three routes render `<SEOMeta ... noIndex />`.

## 11. A deliberate, documented P14-validator change

`scripts/validate-p14.mjs` previously forbade the literal phrase "forgot
password" (etc.) anywhere in `Login.jsx`/`Register.jsx` — a guard against
P15 leaking in before it existed. P15 is now real, so that entry has been
**removed** from `validate-p14.mjs`'s forbidden list (not the whole
check — the P17 entry is untouched). `scripts/validate-p15.mjs` is the
new validator for this phase's own surface.

## 12. Environment variables (`backend/.env.example`)

```
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=MediCore
BREVO_OTP_TEMPLATE_ID=
FRONTEND_URL=http://localhost:5173
```
No real values are committed. `backend/.env` is not included in this
package.

## 13. Tests

- `backend/tests/p15OtpCrypto.test.mjs` — real, executed (not mocked):
  OTP shape/range/non-determinism, bcrypt hash round-trip (hash ≠ raw,
  correct code accepted, wrong code rejected), reset-token entropy and
  hash determinism. **Actually run in this environment — see status
  below.**
- Controller-level integration behavior (enumeration parity end-to-end,
  atomic one-time-use under concurrent requests, attempt-limit lockout,
  multiple-OTP-request invalidation, resend throttling, full reset →
  session-invalidation → re-login cycle) is **not** covered by an
  executed test in this delivery. The controller talks to real Mongoose
  models directly (`User`, `PasswordReset`) rather than through injected
  dependencies, and this sandbox has no reachable MongoDB (see Blockers).
  Two pre-existing P10-era tests in this same repo
  (`followUpSchedulingConcurrency.test.mjs`,
  `followUpContinuityInvariants.test.mjs`) hit the identical constraint
  via `mongodb-memory-server`, whose binary download is also blocked
  here — this is a pre-existing environment limitation, not one
  introduced by P15. Faking this with a full hand-rolled in-memory
  replacement for `User`/`PasswordReset` was avoided deliberately: the
  brief explicitly says not to mock the entire recovery system, and a
  parallel fake persistence layer covering every query shape used by the
  controller would amount to exactly that.

## 14. Regression

- `node scripts/validate-p14.mjs` → **PASS** (80 keys × 3 locales).
- `node scripts/validate-p13-locales.mjs` → **PASS** (146 keys × 3 locales).
- `node scripts/validate-p15.mjs` → **PASS** (56 keys × 3 locales, routes
  and security wiring checks).
- `npm test` (backend, full suite) → 73 passed / 3 failed. The 3 failures
  (`p12BookingAuthFlow.test.mjs`, `p12GeographicSearchConsistency.test.mjs`,
  `p12Geography.test.mjs`) are **pre-existing and unrelated to P15**:
  they fail with `ENOENT` on a doubled path
  (`backend/backend/controllers/...`), caused by those test files
  resolving paths against `process.cwd()` assuming the repo root, while
  the test runner's actual cwd is `backend/`. Confirmed by inspecting the
  failing files directly — none of the three touch anything P15 changed
  (auth routes, `User`, JWT, or password recovery). Not modified, per the
  brief's "do not modify tests to make them pass."
- `npm run lint` (frontend + backend, full project) → 13 pre-existing
  errors remain, all in files P15 never touched
  (`appointmentController.js`, `emailService.js`, `p13.*.js` duplicate
  locale keys, `BookAppointment.jsx`, `DoctorCompare.jsx`). Every file
  P15 created or modified lints clean on its own.
- `npm run build` (frontend) → succeeds; `ForgotPassword`, `VerifyOtp`,
  `ResetPassword` are present as separate lazy chunks in `dist/assets/`.

## 15. Blockers (honest status, not converted to PASS)

- **Brevo Runtime / Real Email Delivery: BLOCKED.** This sandbox's
  network egress allowlist does not include `api.brevo.com` (or any
  Brevo domain), so a real transactional-email call cannot be made or
  verified from here regardless of whether credentials are supplied. The
  integration is implemented exactly against Brevo's documented
  `POST /v3/smtp/email` contract (sender/to/subject + either
  `templateId`+`params` or `htmlContent`, `api-key` header
  authentication) but has not been exercised against the live API. When
  run in an environment with real `BREVO_API_KEY` / `BREVO_SENDER_EMAIL`
  and network access to Brevo, the full lifecycle in §64 of the brief
  should be re-run end-to-end before this is called PASS.
- **Full controller-level OTP integration tests (no live MongoDB
  reachable): BLOCKED**, for the reasons in §13 above.

## Production fix: invalid template configuration fallback

The password-recovery sender now uses inline HTML when `BREVO_OTP_TEMPLATE_ID` is blank or not a positive numeric ID. This prevents Brevo `missing_parameter` failures caused by an invalid template environment value.
