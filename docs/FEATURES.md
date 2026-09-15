# Features

Current feature map by product area, verified against the live
`src/pages/`, `backend/routes/`, `backend/controllers/`, and
`backend/models/` directories. Every item is marked:

- **Implemented** — the frontend page/component and backend route/
  controller/model exist and appear functionally complete.
- **Implemented — verification limited** — the code exists and is
  structurally complete, but hasn't been exercised against a live
  MongoDB/Razorpay/browser in this environment (see
  `docs/REMAINING_RISKS.md`).
- **Partial** — some of the pieces exist, but the area is visibly
  incomplete.
- **Planned** — referenced in docs/vision but no corresponding code found.

Never read "Implemented" here as "production-verified" — see
`docs/PROJECT_STATUS.md` for the distinction.

## Public Experience

| Feature | Status |
|---|---|
| Doctor discovery / search | Implemented |
| Doctor profiles | Implemented |
| Doctor comparison | Implemented (`DoctorCompare.jsx`) |
| Services listing / detail | Implemented |
| Articles / CMS content | Implemented |
| Doctor coverage-area map (Leaflet) | Implemented |
| SEO infrastructure (sitemap, robots.txt) | Implemented (`seoInfrastructureService.js`) |
| Contact / leads | Implemented |
| Privacy preferences / data-rights pages | Implemented |

## Patient

| Feature | Status |
|---|---|
| Registration / login (JWT) | Implemented |
| Doctor booking flow | Implemented |
| Appointment management (list, detail, history) | Implemented |
| Appointment payment | Implemented — verification limited (real Razorpay path not live-tested; test gateway path is tested, see `docs/FINANCIAL_ARCHITECTURE.md`) |
| Wallet + wallet recharge | Implemented — verification limited (same gateway caveat) |
| Refund requests | Implemented |
| Invoices | Implemented (`pdfkit`-generated) |
| Medical records / documents | Implemented |
| Family member management | Implemented (`PatientFamily.jsx`, `FamilyMember` model) |
| Insurance | Partial — `Insurance` model and `PatientInsurance.jsx` exist; depth of the feature not independently audited this pass |
| Health journey / consultation history | Implemented |
| AI assistant (patient-facing) | Implemented — verification limited (`PatientAIAssistant.jsx`, `aiController.js`, `SymptomSession` model exist; response quality/accuracy is not something this pass evaluated) |

## Doctor

| Feature | Status |
|---|---|
| Onboarding + verification | Implemented (`DoctorOnboarding.jsx`, `DoctorVerificationCenter.jsx`) |
| Professional profile + profile-strength scoring | Implemented |
| Practice settings / overview | Implemented |
| Schedule management | Implemented |
| Appointments | Implemented |
| Clinical workspace | Implemented |
| Patient list / patient profile (doctor view) | Implemented |
| Reviews / reputation center | Implemented |
| Smart inbox | Implemented |
| Earnings | Implemented |
| Payouts (`DoctorPayout`) | Implemented — see `docs/FINANCIAL_ARCHITECTURE.md` |
| Withdrawals | Implemented — see `docs/FINANCIAL_ARCHITECTURE.md` |
| Business overview / analytics | Implemented |
| Documents | Implemented |

## Admin

| Feature | Status |
|---|---|
| Doctor management | Implemented |
| Patient management | Implemented |
| Appointment operations | Implemented |
| Payments | Implemented — verification limited (real gateway path) |
| Refunds | Implemented |
| Withdrawals | Implemented |
| Leads | Implemented |
| CMS / Articles / Services management | Implemented |
| User management / access control / permissions | Implemented |
| Reviews moderation | Implemented |
| Invoices | Implemented |
| Monitoring platform / platform health | Implemented |
| Audit log | Implemented (`AdminActivityLog`) |
| Mission control / executive action center | Implemented |
| Operations command workspace | Implemented |
| Smart assignment | Implemented |
| Automation studio | Implemented |
| Process designer / analytics / governance / orchestrator | Implemented |
| Integration hub | Implemented — scope of actual third-party integrations beyond Razorpay/Brevo not audited this pass |
| Export center | Implemented |
| Feature management (feature toggles) | Implemented (`FeatureToggle` model) |
| AI insights (admin-facing) | Implemented — verification limited |
| Notifications | Implemented |
| Settings | Implemented |

## Platform / Cross-cutting

| Feature | Status |
|---|---|
| Authentication (JWT + bcrypt) | Implemented |
| Role-based access control | Implemented |
| Realtime (Socket.IO: presence, chat, notifications) | Implemented — single-backend-instance only; see `docs/REMAINING_RISKS.md` §4 |
| Transactional email / OTP (Brevo) | Implemented — requires `BREVO_API_KEY` etc. configured to actually send |
| Financial reconciliation | Implemented — see `docs/FINANCIAL_ARCHITECTURE.md` |
| Privacy / consent management | Implemented (`ConsentRecord`, `PrivacyRequest`, `PrivacyPreference` models + routes) |
| Rate limiting | Implemented (`express-rate-limit` + `accountRateLimit.js`) |
| Docker / Docker Compose deployment | Implemented — not yet run against a live Docker daemon in this environment (see `docs/REMAINING_RISKS.md` §2) |
| CI (lint / backend tests / frontend build) | Implemented (`.github/workflows/ci.yml`) — not yet observed running on GitHub itself; local runs of the same three commands currently show pre-existing lint/test failures unrelated to any specific feature (see `docs/REMAINING_RISKS.md` §9) |

## What "Implemented" does not mean here

None of the "Implemented" rows above should be read as "independently
security-audited," "load-tested," or "verified against a live production
environment." See `docs/PROJECT_STATUS.md` for the project's actual
verification status and `docs/REMAINING_RISKS.md` for the specific,
current list of what still needs real-environment verification before a
production launch.
