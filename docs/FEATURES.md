# Features

> **Status: rebuilt from the code during the documentation audit.** *Implemented* here means that UI, route and model/service code were found at the snapshot. It does **not** mean runtime-verified, tested, or production-ready: no application was started and no test was executed. Evidence is limited to file and route existence; the rows were not exercised.

Statuses: **Implemented**, **Partially verified**, **Planned** (none identified from code), **Unverified**. Related: [API routes](references/api-routes.md) · [Project status](PROJECT_STATUS.md) · [Architecture](ARCHITECTURE.md).

| Feature | Role | Implementation status | UI / API | Evidence |
|---|---|---|---|---|
| Doctor search / discovery | Public | Implemented | `pages/public/DoctorSearch` · `/api/public`, `/api/doctors` | `publicRoutes.js`, `doctorRoutes.js` |
| Doctor profile, comparison | Public | Implemented | `DoctorProfile`, `DoctorCompare` · `/api/public`, `/api/doctors` | route files above |
| Services, articles, CMS content | Public / Admin | Implemented | `Services`, `ServiceDetail`, `Articles`, `AdminCMS`, `AdminArticles`, `AdminServices` · `/api/public`, `/api/admin` | `admin/cmsAdminRoutes.js`, `admin/serviceAdminRoutes.js` |
| SEO (sitemap, robots) | Public | Implemented | `GET /sitemap.xml`, `GET /robots.txt` | `backend/app.js` |
| Leads / contact | Public / Admin | Implemented | `Contact`, `AdminLeads` · `/api/leads` | `leadRoutes.js` |
| Privacy preferences, consent, data rights | All | Implemented | `PrivacyPreferences`, `DataRights` · `/api/privacy` | `privacyRoutes.js`; models `ConsentRecord`, `PrivacyRequest`, `PrivacyPreference` |
| Registration, login, email/OTP verification, password reset | All | Implemented | `pages/auth/*` · `/api/auth` | `authRoutes.js`; email via Brevo |
| Appointment booking and management | Patient / Doctor / Admin | Implemented | `BookAppointment`, `PatientAppointments`, `AppointmentDetail`, `DoctorAppointments`, `AdminAppointments` · `/api/appointments`, `/api/patient`, `/api/doctor` | `appointmentRoutes.js`, `admin/appointmentAdminRoutes.js` |
| Appointment payment (Razorpay / test gateway) | Patient | Implemented — gateway behaviour not verified live | `PaymentCheckout`, `PatientPayments` · `/api/payments`, webhook `POST /api/payments/webhooks/razorpay` | `paymentRoutes.js`, `backend/payments/` |
| Wallet and wallet recharge | Patient | Implemented — gateway behaviour not verified live | `WalletDashboard` · `/api/wallet`, `/api/payments` | `walletRoutes.js`; models `WalletRecharge`, `Wallet` |
| Refund requests and review | Patient / Admin | Implemented | `AdminRefunds` · `/api/refunds`, `/api/admin` | `refundRoutes.js`, `admin/refundAdminRoutes.js` |
| Invoices (PDF) | Patient / Admin | Implemented | `InvoicePreview`, `InvoiceHistory`, `AdminInvoices` · `/api/invoices` | `invoiceRoutes.js`; `pdfkit` generation not exercised here |
| Subscriptions and billing | Doctor | Implemented — financial behaviour not verified live | `SubscriptionBilling` · `/api/finance` | `financeRoutes.js`; job `subscriptionRenewals` |
| Doctor onboarding and verification | Doctor / Admin | Implemented | `DoctorOnboarding`, `DoctorVerificationCenter` · `/api/doctor` | `doctor/onboardingRoutes.js` |
| Doctor profile, schedule, practice settings | Doctor | Implemented | `DoctorProfessionalProfile`, `DoctorSchedule`, `DoctorPracticeSettings`, `DoctorProfileStrength` · `/api/doctor` | `doctor/practiceRoutes.js` |
| Clinical workspace, notes, prescriptions | Doctor | Implemented | `DoctorClinicalWorkspace`, `DoctorPatientProfile` · `/api/doctor` | `doctor/workflowRoutes.js`; models `MedicalNote`, `Prescription` |
| Patient records, family members, health journey | Patient | Implemented | `PatientRecords`, `PatientFamily`, `HealthJourney` · `/api/patient` | `patient/workflowRoutes.js`; model `FamilyMember` |
| Insurance | Patient | Partially verified — UI and model exist; depth not audited | `PatientInsurance` · `/api/patient` | `Insurance` model; `insuranceExpiryReminder` automation |
| Reviews and reputation | Patient / Doctor / Admin | Implemented | `DoctorReviews`, `DoctorReputationCenter`, `AdminReviews` · `/api/admin` (moderation) | `adminReviewRoutes.js` |
| Earnings, payouts, withdrawals | Doctor / Admin | Implemented — financial behaviour not verified live | `DoctorEarnings`, `AdminWithdrawals` · `/api/finance`, `/api/admin` | `admin/withdrawalAdminRoutes.js`; models `DoctorPayout`, `Withdrawal` |
| Chat and communication hub | Patient / Doctor | Implemented — single-instance realtime | `ChatWorkspace`, `CommunicationHub` · Socket.IO; `/api/realtime` | `backend/socket/`, `services/chat/` |
| Notifications and presence | All | Implemented — single-instance realtime | Socket.IO `notification:*`, `presence:*` | `NotificationDelivery` model |
| AI assistant (patient) and AI insights (admin) | Patient / Admin | Implemented — Gemini in production; template provider for dev/test | `PatientAIAssistant`, `AdminAIInsights` · `/api/ai` | [AI architecture](AI-ARCHITECTURE.md) |
| Admin user management, access control, permissions | Admin | Implemented | `AdminUserManagement`, `AdminAccessControl` · `/api/admin` | `admin/userAdminRoutes.js`, `admin/permissionAdminRoutes.js`; `Permission` model |
| Admin doctor / patient management | Admin | Implemented | `AdminDoctors`, `AdminPatients` · `/api/admin` | `admin/doctorAdminRoutes.js`, `admin/patientAdminRoutes.js` |
| Admin payments, finance dashboard | Admin | Implemented — verification limited | `AdminPayments`, `AdminFinanceDashboard` · `/api/admin` | `admin/paymentAdminRoutes.js`, `admin/financeAdminRoutes.js` |
| Audit log | Admin | Implemented | `AdminAudit` · `/api/admin` | `admin/activityAdminRoutes.js`; `AdminActivityLog` model |
| Monitoring and platform health | Admin | Implemented | `AdminMonitoringPlatform`, `AdminPlatformHealth` · `/api/admin` | `admin/monitoringRoutes.js`, `admin/platformHealthAdminRoutes.js` |
| Mission control, executive action center, operations command | Admin | Implemented (scope not audited) | `AdminMissionControl`, `AdminExecutiveActionCenter`, `AdminOperationsCommandWorkspace` · `/api/admin` | `admin/missionControlAdminRoutes.js`, `admin/executiveActionRoutes.js`, `admin/commandCenterAdminRoutes.js` |
| Smart assignment, automation studio, process designer/analytics/governance/orchestrator, workflow engine | Admin | Implemented (scope not audited) | `AdminSmartAssignment`, `AdminAutomationStudio`, `AdminProcess*`, `AdminWorkflow*` · `/api/admin` | `admin/assignmentAdminRoutes.js`, `automationStudioRoutes.js`, `process*Routes.js` |
| Integration hub | Admin | Implemented — external integrations beyond Razorpay, Brevo, Gemini not identified | `AdminIntegrationHub` · `/api/admin` | `admin/integrationHubRoutes.js` |
| Export center, feature toggles, settings | Admin | Implemented | `AdminExportCenter`, `AdminFeatureManagement`, `AdminSettings` · `/api/admin` | `admin/exportAdminRoutes.js`, `featureAdminRoutes.js`, `settingsAdminRoutes.js` |
| Master data (states, districts, cities; LGD import) | Admin / Doctor | Implemented | location fields in doctor forms · `/api/master-data` | `masterDataRoutes.js`; migrations 004, 005; `backend/master-data/` |
| Multi-language UI (English, Hindi, Hinglish) | All | Implemented | `src/i18n/locales/` | locale files; `scripts/validate-p13-locales.mjs` |
| Scheduled jobs and worker | Platform | Implemented — deployed behaviour not verified | — | [Scheduler](SCHEDULER-ARCHITECTURE.md) |
| Docker / Compose deployment, CI | Platform | Configuration present; never run in this audit | — | `docker-compose.yml`, `.github/workflows/ci.yml` |

## Corrections to the previous feature map

- The previous map said AI needed `AI_TEXT_PROVIDER=openai` and `OPENAI_API_KEY`. The code supports `gemini` and `template` only.
- CI is three jobs (backend tests, Mongo-backed tests, frontend lint/build), not "lint / backend tests / frontend build" without a database job.
- Several admin areas (capture cases, smart widgets, workflow intelligence) exist in the UI but were not described before; their behaviour was not audited.
