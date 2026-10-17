# Phase 1 Closure Report — MediCore HMS

## Defects found

1. Patient registration created the existing persistent/realtime SUPER_ADMIN notification but did not call the existing `emailService.sendNewUserAdminNotification` Brevo path.
2. `sendNewUserAdminNotification` reused `toEmail` as both the recipient address and the displayed newly registered user's email, so the template could show the SUPER_ADMIN recipient email as the new-user email.
3. Email verification consumption used a separate token lookup followed by document mutation and `save()`. Two concurrent requests could both pass the lookup before either write completed.
4. The patient welcome email instructed the user to verify email but did not contain a verification link or explain that verification is delivered separately. It also needed to remain truthful when the verification email provider call failed.
5. Frontend runtime role logic still contained the removed `admin` role in navigation arrays and Sidebar checks.
6. Frontend runtime role logic still exposed `receptionist` in User Management role choices and the Executive Action Center role selector.

## Exact fixes

### New-user SUPER_ADMIN email
- Kept the existing `notificationEmitter.emitToAdmins` persistent + Socket.IO flow unchanged.
- For `patient` registration only, registration now queries active `super_admin` users and calls the existing `emailService.sendNewUserAdminNotification` Brevo abstraction for each recipient.
- Registration success is not rolled back if recipient lookup or email delivery fails; failures are logged without secrets.
- The email method now separates recipient and registered-user fields:
  - `toEmail` = active SUPER_ADMIN recipient
  - `userName` = newly registered patient's name
  - `userEmail` = newly registered patient's email
  - `userRole` = newly registered patient's role
- The email body displays the registered user's name, email, and role and no longer labels the recipient address as the registered-user email.

### Atomic email verification consumption
- Replaced the read/mutate/save consumption path with one `User.findOneAndUpdate` operation.
- The atomic match requires:
  - matching verification-token hash
  - `emailVerificationExpiresAt > now`
  - `isActive: true`
  - `emailVerified: false`
- The same atomic update:
  - sets `emailVerified: true`
  - stores `emailVerificationLastUsedHash`
  - clears `emailVerificationTokenHash`
  - clears `emailVerificationExpiresAt`
  - clears `emailVerificationSentAt`
- If the atomic update loses a concurrent race, the existing last-used-hash lookup preserves the existing `already verified` response for token reuse.
- Raw verification tokens are still never stored.

### Welcome-email UX
- Kept the existing welcome-email transport and Brevo abstraction.
- The welcome email now states that verification is sent in a separate email when the verification provider accepted the send request.
- If verification-email sending failed during registration, the welcome message instead tells the user to use resend verification, so it does not falsely claim a verification email was sent.

### Runtime roles
Runtime roles remain exactly:
- `super_admin`
- `doctor`
- `patient`

Frontend closure changes:
- removed `admin` from all navigation role arrays
- removed `role === "admin"` from Sidebar runtime checks
- removed `receptionist` from User Management role options
- removed `receptionist` from Executive Action Center runtime role selection

The `/admin/...` URL namespace and human-facing administrative wording were not renamed because they are routes/labels, not runtime roles.

### Regression/security preservation
Verified by the required contracts and source audit:
- registration creates no authenticated session
- unverified patient/doctor login remains blocked
- SUPER_ADMIN login exemption remains intact
- verification requires an unexpired token
- consumed verification token cannot win twice concurrently
- reused consumed token follows existing already-verified behavior
- resend cooldown remains active
- doctor onboarding routes remain authenticated DOCTOR-only and do not use `requireApprovedDoctor`
- doctor onboarding contract still persists/submits and changes professional verification status to `pending`
- onboarding mass-assignment protection still blocks doctor self-approval fields
- existing atomic doctor approval/rejection controller was not modified
- existing Socket.IO notification implementation was not modified
- existing Brevo transport was not replaced or duplicated

## Tests executed + real results

Required Phase-1 closure regression set:

- `backend/tests/emailVerificationCrypto.test.mjs` — PASS
- `backend/tests/phase1AuthContract.test.mjs` — PASS
- `backend/tests/phase1OnboardingContract.test.mjs` — PASS
- `backend/tests/onboardingMassAssignment.test.mjs` — PASS
- `backend/tests/doctorApprovalConcurrencyRace.test.mjs` — PASS, 4/4 subtests
- `backend/tests/phase1AdminRegistrationEmail.test.mjs` — PASS
- `backend/tests/emailVerificationConcurrency.test.mjs` — PASS, simultaneous-consumption regression 1/1
- `backend/tests/runtimeRolesContract.test.mjs` — PASS

Modified backend files also passed `node --check` syntax validation.

Full backend test command executed:

`npm --prefix backend test`

Real result:
- 105 test files discovered
- 62 passed
- 43 failed
- the failing files require unavailable installed dependencies; the emitted failures include `ERR_MODULE_NOT_FOUND: Cannot find package 'mongoose'`
- therefore the full backend suite is **not claimed as PASS** in this environment

Frontend lint command executed:

`npm run lint`

Real result:
- not executable to completion because frontend dependencies are not installed
- shell result: `eslint: not found`
- **not claimed as PASS**

Frontend build command executed:

`npm run build`

Real result:
- not executable to completion because frontend dependencies are not installed
- shell result: `vite: not found`
- **not claimed as PASS**

## Remaining environment limitations

- Root `node_modules` is absent.
- `backend/node_modules` is absent.
- Mongoose-dependent backend tests cannot execute successfully in this sandbox without installing backend dependencies.
- ESLint and Vite are unavailable because frontend dependencies are not installed.
- No production Brevo inbox-delivery test was performed in this closure patch; this patch reuses the existing Brevo abstraction and does not claim provider delivery beyond the behavior covered by code/contracts.
