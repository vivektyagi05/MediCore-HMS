# Phase 1 — Identity + Email Verification + Doctor Onboarding Foundation

## Implementation status

Phase 1 implementation was applied to the supplied MediCore HMS repository.

The implementation preserves the existing Brevo transactional email abstraction, `NotificationDelivery` persistence, Socket.IO notification emitter, atomic doctor approval/rejection flow, and existing doctor profile model.

## Root causes found

1. Doctor onboarding routes were already correctly protected by `protect + authorizeRoles(DOCTOR)` and were **not** using `requireApprovedDoctor`. The existing onboarding controller therefore already represented the intended access boundary; the production 403 needs to be distinguished from any other `/api/doctor/*` route or stale deployed build. The Phase 1 contract test now explicitly guards that onboarding routes do not add `requireApprovedDoctor`.
2. Registration had no real email-ownership verification state or verification lifecycle.
3. Registration returned an authenticated session immediately, allowing the frontend to enter the application before email ownership had been verified.
4. Doctor onboarding submission persisted profile data and `verificationStatus=pending`, but did not create the required SUPER_ADMIN persistent/realtime notification or admin transactional email.
5. The existing notification model enum did not contain dedicated `user_registered` and `doctor_application` notification types, so these new Phase 1 events needed additive enum support.
6. Approval/rejection already had atomic terminal transitions and doctor notifications/emails. Those mechanisms were preserved rather than duplicated.
7. The runtime role constants contained an unused `RECEPTIONIST` role in addition to SUPER_ADMIN, DOCTOR and PATIENT. It was removed from the runtime enum/rank. PATIENT remains the codebase's existing runtime name for the product's USER account; a broad PATIENT→USER rename was deliberately avoided because it would be an unrelated architectural rewrite.

## Files changed

### Backend
- `backend/constants/roles.js`
- `backend/controllers/authController.js`
- `backend/controllers/doctorController.js`
- `backend/controllers/doctorOnboardingController.js`
- `backend/models/NotificationDelivery.js`
- `backend/models/User.js`
- `backend/routes/authRoutes.js`
- `backend/services/emailService.js`
- `backend/utils/emailVerification.js`
- `backend/services/emailVerificationService.js`
- `backend/emails/emailVerificationEmail.js`

### Frontend
- `src/api/authApi.js`
- `src/context/AuthContext.jsx`
- `src/pages/auth/Register.jsx`
- `src/pages/auth/VerifyEmail.jsx`
- `src/pages/doctor/DoctorOnboarding.jsx`
- `src/routes/AppRoutes.jsx`

### Tests
- `backend/tests/emailVerificationCrypto.test.mjs`
- `backend/tests/phase1AuthContract.test.mjs`
- `backend/tests/phase1OnboardingContract.test.mjs`

## Database/schema changes

### User
Added:
- `emailVerified`
- `emailVerificationTokenHash`
- `emailVerificationExpiresAt`
- `emailVerificationSentAt`
- `emailVerificationLastUsedHash`

New registrations explicitly set `emailVerified=false`.

For backward compatibility, the schema default remains `true`, so existing production accounts are not silently locked by this phase. Newly created accounts do not use that default because registration explicitly writes the unverified state.

Verification credentials are stored as SHA-256 hashes, not raw tokens.

### NotificationDelivery
Added notification types:
- `user_registered`
- `doctor_application`

The existing unique `(eventKey, recipientId)` protection remains the notification deduplication mechanism.

## API changes

Added:
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`

Registration now:
- creates the account as unverified;
- issues a cryptographically secure, expiring, single-use verification credential;
- sends verification email through Brevo;
- creates a persistent SUPER_ADMIN registration notification;
- does not return a login session before verification.

Login now rejects unverified USER/DOCTOR accounts with HTTP 403.

## Email changes

Extended the existing Brevo service. No SMTP/Nodemailer replacement was introduced.

Added reusable transactional operations for:
- email verification;
- patient/user welcome email;
- new doctor application admin email.

Existing doctor approval/rejection email methods remain in the same service.

Verification tokens, password-reset credentials, API keys and other secrets are not logged.

Verification links use a URL fragment (`#token=...`) so the token is not sent as an HTTP request path/query to the backend when the frontend page loads.

## Doctor onboarding flow

The resulting flow is:

`DOCTOR register`
→ `email verification`
→ `login`
→ `GET /api/doctor/onboarding`
→ fill profile
→ submit
→ `verificationStatus=pending`
→ persistent SUPER_ADMIN notification
→ Socket.IO `notification:new`/dashboard sync through existing infrastructure
→ SUPER_ADMIN transactional email
→ existing atomic approve/reject workflow
→ doctor persistent notification + email

Onboarding submission remains protected by:
- authentication;
- DOCTOR role authorization.

It does not require professional approval.

The existing `requireApprovedDoctor` middleware remains on restricted clinical/practice routes.

## Data persistence

The onboarding controller continues to use the existing `Doctor` model as the authoritative professional profile source.

Existing editable fields are preserved:
- specialization
- qualification
- experience
- fees
- license number
- medical council
- college
- graduation year
- hospital
- city/state/district
- bio
- languages
- consultation mode
- profile photo

Mass-assignment protection remains in place.

A pending application cannot be submitted repeatedly as a new application. Rejected doctors can resubmit. Approved doctors cannot create a second onboarding application.

## SUPER_ADMIN notification

Doctor submission now:
1. persists the application;
2. creates a persistent `doctor_application` notification for SUPER_ADMIN users;
3. emits through the existing notification/Socket.IO infrastructure;
4. sends a Brevo transactional email to active SUPER_ADMIN recipients.

Email failure does not roll back the already-persisted application.

User registration similarly creates a persistent `user_registered` SUPER_ADMIN notification.

## Approval/rejection

The existing atomic approval/rejection mechanism was retained.

Approval continues to:
- atomically change pending → approved;
- set `isVerified=true`;
- update the user's onboarding state;
- emit the existing doctor verification notification;
- send the existing Brevo approval email.

Rejection continues to:
- atomically change pending → rejected;
- persist the rejection reason;
- update the user's onboarding state and rejection metadata;
- emit the existing doctor verification notification;
- send the existing Brevo rejection email.

No second approval/rejection implementation was introduced.

## Security

Implemented/audited:
- cryptographically secure verification tokens;
- hashed token storage;
- expiration;
- single-use invalidation;
- resend cooldown;
- resend rate limiting;
- generic resend responses for enumeration resistance;
- verification state owned by backend;
- approval state owned by backend;
- onboarding field allow-list;
- existing authorization checks;
- existing atomic approval/rejection concurrency controls.

## Tests executed

Passed:
- email verification crypto contract;
- Phase 1 authentication verification contract;
- Phase 1 onboarding contract;
- existing onboarding mass-assignment tests;
- existing doctor approval concurrency tests.

JavaScript syntax checks passed for all modified backend JavaScript files.

The full backend suite was attempted. The repository's dependency installation in the supplied environment was incomplete: `mongoose` was missing from the installed dependency tree. As a result, the complete suite could not be executed end-to-end; 57 tests reported PASS before dependency-related failures and 42 failed because the environment could not resolve `mongoose` for tests that import the database layer. These failures were not treated as Phase 1 functional failures.

The frontend ESLint/build could not be completed in the supplied environment because the root dependency installation did not provide the `eslint` binary.

## Known limitations requiring production verification

1. Install/restore the repository's complete frontend and backend dependency trees before claiming a clean full-suite/build result.
2. Run a real production integration test with the configured Brevo account.
3. Verify Brevo's accepted response separately from actual inbox delivery.
4. Verify the deployed Render/Vercel build contains these Phase 1 changes; the supplied source already had an onboarding route without `requireApprovedDoctor`, so a production 403 on that endpoint should also be checked against the deployed commit/version and route registration.
5. Run the exact production flow with a fresh USER and a fresh DOCTOR account.

## Acceptance flow implemented

USER/PATIENT:

`register → verification email → verify → login/access → SUPER_ADMIN persistent notification`

DOCTOR:

`register → verification email → verify → login → onboarding → submit → data persists → pending → SUPER_ADMIN persistent notification + email → existing approval/rejection workflow → doctor notification + email`

No second notification system, second email transport, AI/payment rewrite, Socket.IO rewrite, or approval-concurrency rewrite was introduced.
