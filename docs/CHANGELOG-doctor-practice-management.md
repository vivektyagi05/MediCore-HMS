# MediCore HMS — Phase D4: Doctor Identity & Practice Management Platform

Connects Profile Strength, Professional Profile, Verification, Billing, and
Subscription into one Practice Management Platform. Additive-only on top of
D1–D3; no redesign of prior phases; Patient module untouched.

## 1. Audit Report

**Models/controllers/routes reviewed:** Doctor, User, Subscription, Invoice,
Payment, Certificate (n/a — doesn't exist; documents live on Doctor),
Coupon, AIDraft, TransactionLedger; doctorController, doctorOnboardingController,
financeController, invoiceController, publicController, workflowController
(doctor), businessOverviewController; all doctor/finance/public/admin routes;
Socket.IO realtime emitters; the AI prompt/template/generativeAssistant
pipeline; admin approval flow.

**Real gaps found (no fabrication — genuine missing functionality):**
1. Subscription plans had no usage limits (storage/AI/patient/appointment) —
   only name/price existed.
2. Subscription payments never generated a GST invoice, unlike appointment
   payments (`Invoice.appointmentId`/`paymentId` were hard-required, making
   this structurally impossible).
3. No plan upgrade/downgrade endpoint — only create/cancel.
4. `approveDoctor`/`rejectDoctor` never notified the doctor or recorded
   history — completely silent transitions.
5. Subscription renewal cron never notified anyone on past_due/cancelled,
   and no renewal reminder existed at all.
6. No profile-view/search-visibility tracking anywhere — "Profile Visits,"
   "Search Visibility," "Growth Score" had zero backing data.
7. `updateOnboarding` permanently blocked all edits once a doctor was
   approved — a doctor could never fix a typo or update practice details
   without admin intervention.
8. Verification Center document types were 4 generic categories
   (certification/identity/profile/other) with no expiry-driven timeline.
9. No AI capabilities existed for Profile Review, Verification Advisor,
   Subscription Advisor, Growth Advisor, or Missing Fields Advisor.
10. Document uploads never captured file size — no real data existed for
    storage-usage tracking.

**Reused as-is (per "no redesign" instruction):** Doctor's existing
onboarding/document fields, `businessOverviewController.js` hub-composition
pattern, `BusinessIntelligenceNav.jsx` nav-strip pattern, `notificationEmitter`
+ `roomManager` realtime plumbing, the AI prompt-library/templateProvider/
generativeAssistant pipeline, `buildDoctorReputationIntelligence` (trust
score, repeat-patient rate) and `buildDoctorAnalyticsIntelligence`
(appointment/patient funnels, growth forecast) — both reused directly by the
new Practice Analytics builder instead of being recomputed.

## 2. Backend Changes (all additive)

- **Doctor model**: widened `documents.type` enum (added medical_license,
  medical_registration, degree, government_id, pan, gst,
  clinic_registration); added `documents.fileSize`; added Professional
  Profile fields (`subSpecialties`, `education`, `experienceEntries`,
  `awards`, `researchPublications`, `memberships`, `clinics`,
  `clinicPhotos`, `emergencyAvailability`, `insuranceAccepted`); added
  `profileViews` (real counter) and `verificationHistory` (real timeline).
- **Invoice model**: `appointmentId`/`paymentId` relaxed to optional,
  added `subscriptionId`/`billingType`, with a `pre("validate")` hook
  enforcing the real either/or requirement so subscription invoices are
  possible without weakening appointment-invoice integrity.
- **generateInvoice.js / invoiceTemplates.js**: conditional "Billed
  To"/"Plan" labeling for subscription invoices vs. "Patient"/"Doctor" for
  consultation invoices.
- **invoiceService.js**: new `createSubscriptionInvoiceRecord`, reusing the
  existing GST/PDF pipeline.
- **subscriptionService.js**: real plan limits per tier (`doctor_free`,
  `doctor_premium_monthly`, `doctor_premium_yearly`); new `changePlan`
  (upgrade/downgrade).
- **doctorController.js**: `approveDoctor`/`rejectDoctor` now push to
  `verificationHistory` and notify the doctor in real time; fixed an
  unrelated pre-existing lint bug (unused catch binding) found during
  verification.
- **doctorOnboardingController.js**: rewritten to fix the permanent
  edit-lock bug — only changes to real credential fields
  (license/council/qualification/college/graduation year) trigger
  re-verification; everything else stays editable at any status.
- **workflowController.js (doctor)**: document uploads now capture real
  `fileSize`.
- **publicController.js**: public profile views increment a real
  `profileViews` counter (fire-and-forget, never blocks the response).
- **practiceController.js** (new): builders for Profile Intelligence
  (completion/practice-completeness/verification-progress/SEO-readiness/
  trust-score/discoverability/recommendations), Professional Profile
  read/update, Verification Center, Subscription Intelligence
  (real usage vs. real limits), Practice Settings, Practice Analytics
  (profile visits, appointment conversion, acquisition, repeat patients,
  growth score), and a composed overview hub — mirrors the D3
  `businessOverviewController.js` pattern exactly.
- **financeController.js**: subscription create/cancel now generate real
  GST invoices and emit realtime notifications (previously silent).
- **subscriptionRenewals.js cron**: now notifies on past_due/cancelled
  transitions and sends renewal reminders 3 days ahead of billing
  (previously completely silent).
- **practiceEmitter.js** (new): verification/subscription/invoice/renewal/
  profile-completion realtime events, following the exact
  `notificationEmitter` + `roomManager` pattern used by `clinicalEmitter.js`.
- **practiceRoutes.js** (new): all Phase D4 doctor endpoints, mounted at
  `/api/doctor/practice/*`.

## 3. Frontend Changes

- `DoctorProfileStrength.jsx` transformed in place into the **Professional
  Identity Center** (same route `/doctor/profile-strength`, standalone page
  confirmed via audit — safe to transform without breaking other usages).
- `SubscriptionBilling.jsx` transformed in place into the **Subscription
  Center** (same route `/doctor/billing`): usage bars vs. real plan limits,
  plan comparison/upgrade/downgrade, cancel, GST invoice history + download.
- New pages: `DoctorPracticeOverview.jsx` (`/doctor/practice`, hub),
  `DoctorProfessionalProfile.jsx` (`/doctor/profile/edit`, education/
  experience/awards/research/memberships/clinics/insurance editors),
  `DoctorVerificationCenter.jsx` (`/doctor/verification`, required docs/
  timeline/expiry alerts), `DoctorPracticeSettings.jsx`
  (`/doctor/practice-settings`, telemedicine/emergency/clinics).
- New shared component: `PracticeManagementNav.jsx`, mirroring
  `BusinessIntelligenceNav.jsx`.
- Routes registered in `AppRoutes.jsx`; sidebar updated in `navigation.js`.

## 4. Shared Components/Builders Reused

`businessOverviewController.js`-style hub composition;
`buildDoctorReputationIntelligence` (trust score, repeat-patient rate);
`buildDoctorAnalyticsIntelligence` (funnels, growth forecast);
`notificationEmitter` + `roomManager`; `AIDraftPanel.jsx`;
`SubscriptionPlans.jsx`; `Button`/`Card`/`Loader`/`EmptyState` UI kit.

## 5. New APIs (all under existing auth/role middleware)

`GET /doctor/practice/overview`, `GET /doctor/practice/profile-intelligence`,
`GET|PATCH /doctor/practice/professional-profile`,
`GET /doctor/practice/verification`,
`GET /doctor/practice/subscription`,
`PATCH /doctor/practice/subscription/:id/change-plan`,
`PATCH /doctor/practice/settings`,
`GET /doctor/practice/analytics`,
`GET /ai/assist/doctor/practice/{profile-review, verification-advisor,
subscription-advisor, growth-advisor, missing-fields-advisor}`.

## 6. AI Enhancements

5 new grounded prompts (profileReview, verificationAdvisor,
subscriptionAdvisor, growthAdvisor, missingFieldsAdvisor), each reusing the
same builder data the corresponding page displays — narrative can never
diverge from on-screen figures, same discipline as every prior phase.

## 7. Security

- Fixed a real permanent-lockout bug in profile editing (see gap #7 above).
- `updateProfessionalProfile`/`updatePracticeSettings` use narrow field
  whitelists (not `Object.assign(doctor, req.body)`), consistent with the
  mass-assignment fix already in place for onboarding.
- Subscription/invoice ownership enforced via `req.user._id` scoping on
  every new endpoint.
- Credential changes on an already-approved doctor now correctly revert
  status to pending rather than silently keeping stale verification valid.

## 8. Performance

No duplicate queries: Practice Analytics and the overview hub reuse
`buildDoctorReputationIntelligence`/`buildDoctorAnalyticsIntelligence`
rather than recomputing; profile-view increments are a single
fire-and-forget `updateOne`; subscription usage runs its 4 counts via
`Promise.all`.

## 9. Deferred

- Prorated mid-cycle billing on plan change (currently a straightforward
  plan swap, documented in code) — no proration engine exists in this
  codebase.
- Coupon application on the Subscription Center UI (backend
  `validateCoupon` exists and is unchanged/untouched; not wired into this
  page given scope).
- Clinic photo file upload (field exists on the model; upload UI deferred).

## 10. Verification

- `node --check` across every backend file: pass.
- All 17 pre-existing backend tests: pass unchanged
  (`node tests/run-all.mjs`).
- Backend ESLint: 0 errors (including 2 pre-existing, unrelated errors
  found and fixed during this pass: an unused destructured variable in
  `templateProvider.js` and an unused catch binding in
  `doctorController.js`).
- Server boot check: clean startup, fails only on the expected
  `ECONNREFUSED` (no live MongoDB in this sandbox) — consistent with every
  prior phase.
- Frontend production build (`npm run build`): clean, no errors.
- Frontend ESLint (`npx eslint src/`): 0 errors.
- The one Vitest suite (`api.test.js`) remains unrunnable in this sandbox
  (`mongodb-memory-server` can't download its MongoDB binary,
  network-restricted) — flagged as unverified, not claimed passing,
  consistent with every prior phase's disclosure.

## Stop Condition Met

Profile Strength, Professional Profile, Verification, Billing, and
Subscription now work as one connected Practice Management Platform,
sharing a nav strip, a composed overview hub, and real (non-fabricated)
data throughout. Patient module untouched.
