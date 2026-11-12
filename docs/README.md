# MediCore HMS Documentation

Central index. Documents describing the **current** state are in the first sections; everything under [History](#history) and [Audits](#audits) is preserved as written and describes earlier states. Where documents conflict, trust the code, then [Project status](PROJECT_STATUS.md). This documentation set was audited against the repository snapshot **without executing any application code**; see the [audit report](audits/DOCUMENTATION_AUDIT_REPORT.md).

Start at the [root README](../README.md) for setup. 

## Architecture

- [Architecture overview](ARCHITECTURE.md)
- [System design (flows)](architecture/system-design.md)
- [Database design](architecture/database-design.md)
- [Authentication and authorization](architecture/authentication-authorization.md)
- [Payments and financial architecture](architecture/payments-financial-architecture.md)
- [Realtime architecture](architecture/realtime-architecture.md)
- [Scheduled jobs and background processing](SCHEDULER-ARCHITECTURE.md)
- [AI assistance architecture](AI-ARCHITECTURE.md)
- [API route reference (generated)](references/api-routes.md)

## Features and status

- [Feature matrix](FEATURES.md)
- [Project status](PROJECT_STATUS.md)
- [Remaining risks](REMAINING_RISKS.md)

## Development

- [Local setup](development/local-setup.md)
- [Environment variables](development/environment-variables.md)
- Specifications (not re-verified): [APPOINTMENT-BUSINESS-LOGIC-SPEC](references/APPOINTMENT-BUSINESS-LOGIC-SPEC.md), [FINANCIAL-ACCOUNTING-CONTRACT](references/FINANCIAL-ACCOUNTING-CONTRACT.md), [PAYMENT-BUSINESS-LOGIC-SPEC](references/PAYMENT-BUSINESS-LOGIC-SPEC.md)
- [LGD master-data source README](../backend/master-data/source/lgd/README.md)

## Testing

- [Testing guide](testing/testing-guide.md)
- [Test matrix (manual, unverified)](testing/test-matrix.md)
- [Release gates (historical counts)](testing/release-gates.md)
- Scenarios: [ai-automation-test-scenarios](testing/scenarios/ai-automation-test-scenarios.md), [doctor-workflow-test-scenarios](testing/scenarios/doctor-workflow-test-scenarios.md), [financial-engine-test-scenarios](testing/scenarios/financial-engine-test-scenarios.md), [patient-workflow-test-scenarios](testing/scenarios/patient-workflow-test-scenarios.md), [realtime-test-scenarios](testing/scenarios/realtime-test-scenarios.md)

## Load testing

- [Load-test dataset tool — guide](testing/load-testing.md) (current)
- [Load-test dataset plan](LOAD-TEST-DATASET-PLAN.md) (original design, with corrections banner)
- Not to be confused with `backend/seed.js`, the platform bootstrap seed.

## Deployment

- [Deployment guide](deployment/deployment-guide.md)
- [Deployment runbook and acceptance checklist](deployment/deployment-runbook.md)
- [Superseded deployment guide](history/historical-status/DEPLOYMENT_GUIDE.md)
- [Superseded 2026-09-15 runbook](history/historical-status/DEPLOYMENT-RUNBOOK-2026-09-15.md)

## Security

- [Security overview](security/security-overview.md)
- [Security policy](../SECURITY.md)
- [Remaining risks](REMAINING_RISKS.md)
- [Historical security audit summary](audits/historical-audits/SECURITY_AUDIT_SUMMARY.md)

## Audits

- [Documentation audit report](audits/DOCUMENTATION_AUDIT_REPORT.md) (this audit)

Historical audits (point-in-time, not re-verified):

- [MediCore HMS — Admin System Audit](audits/historical-audits/ADMIN-SYSTEM-AUDIT.md)
- [MediCore HMS — Complete Audit & Fix Report](audits/historical-audits/AUDIT_REPORT.md)
- [AUDIT_REPORT_2026-09-12.md](audits/historical-audits/AUDIT_REPORT_2026-09-12.md)
- [Bug and risk register](audits/historical-audits/BUG-AND-RISK-REGISTER.md)
- [MediCore HMS — Final Enterprise Readiness Score](audits/historical-audits/ENTERPRISE_READINESS_SCORE.md)
- [Global Flow Integrity Audit — 2026-09-25](audits/historical-audits/GLOBAL-FLOW-INTEGRITY-AUDIT-2026-09-25.md)
- [MediCore Financial Re-Audit — after hardening slice 1](audits/historical-audits/MEDICORE-FINANCIAL-FINAL-RE-AUDIT.md)
- [MediCore HMS — Performance Audit Summary](audits/historical-audits/PERFORMANCE_AUDIT_SUMMARY.md)
- [P23 Financial Audit & Architecture](audits/historical-audits/PHASE-P23-FINANCIAL-AUDIT.md)
- [MediCore HMS — Master Production Readiness Audit](audits/historical-audits/PRODUCTION-READINESS-MASTER-AUDIT-2026-09-15.md)
- [MediCore HMS — Production Readiness Report](audits/historical-audits/PRODUCTION_READINESS_REPORT.md)
- [MediCore HMS — Security Audit Summary](audits/historical-audits/SECURITY_AUDIT_SUMMARY.md)
- [MediCore HMS — Verification Report](audits/historical-audits/VERIFICATION_REPORT.md)

## History

Historical records, preserved as written (each carries a banner). Filenames are unchanged from the original locations.

### Changelogs (88)

- [Phase A5.1 — Executive Dashboard + Live Platform (Mission Control)](history/changelogs/CHANGELOG-A5.1.md)
- [CHANGELOG — Phase A5.2: Platform Health Center + Smart Widgets Platform](history/changelogs/CHANGELOG-A5.2.md)
- [CHANGELOG — Phase A5.3: Executive Action Center](history/changelogs/CHANGELOG-A5.3.md)
- [Phase A6.1 — Unified Operations Queue (Hospital Operations Center)](history/changelogs/CHANGELOG-A6.1.md)
- [MediCore HMS — Phase A6.2.1: Enterprise Workflow Automation Core](history/changelogs/CHANGELOG-A6.2.1-enterprise-workflow-automation-core.md)
- [Phase A6.2.2 — Smart Assignment Engine (Enterprise AI Workload Intelligence)](history/changelogs/CHANGELOG-A6.2.2-smart-assignment-engine.md)
- [CHANGELOG — A6.2.3: Enterprise Automation Studio](history/changelogs/CHANGELOG-A6.2.3-automation-studio.md)
- [CHANGELOG — A6.2.4 — Enterprise Monitoring Platform](history/changelogs/CHANGELOG-A6.2.4-monitoring-platform.md)
- [CHANGELOG — A6.2.5: Autonomous Workflow Intelligence & Self-Healing Platform](history/changelogs/CHANGELOG-A6.2.5-autonomous-workflow-intelligence.md)
- [Phase A6.3.1 + A6.3.2 — Enterprise Process Registry & Orchestration Core + Cross-System In](history/changelogs/CHANGELOG-A6.3-enterprise-process-orchestration.md)
- [Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine](history/changelogs/CHANGELOG-A6.3.3-process-designer.md)
- [CHANGELOG — A6.3.4 Process Analytics & Optimization Intelligence](history/changelogs/CHANGELOG-A6.3.4-process-analytics-optimization.md)
- [Phase A6.3.5 — Process Governance, Compliance & Enterprise Control Intelligence](history/changelogs/CHANGELOG-A6.3.5-process-governance.md)
- [MediCore HMS — Admin Final Integrity Pass](history/changelogs/CHANGELOG-ADMIN-FINAL-INTEGRITY-PASS.md)
- [CHANGELOG — Appointment Regression Repair (pre-P10)](history/changelogs/CHANGELOG-APPOINTMENT-REGRESSION-REPAIR.md)
- [CHANGELOG — Final End-to-End Closure](history/changelogs/CHANGELOG-FINAL-END-TO-END-CLOSURE.md)
- [Financial hardening — slice 1](history/changelogs/CHANGELOG-FINANCIAL-HARDENING-SLICE1.md)
- [Financial hardening — slice 2](history/changelogs/CHANGELOG-FINANCIAL-HARDENING-SLICE2.md)
- [MediCore HMS — P23 Concurrency Hardening Pass](history/changelogs/CHANGELOG-P23-CONCURRENCY-HARDENING.md)
- [MediCore HMS — P23 Payment + Refund 3.0 — CONTINUATION PASS](history/changelogs/CHANGELOG-P23-CONTINUATION.md)
- [CHANGELOG — P23 Fake-Success Elimination (Bug 1 + Bug 2 + hardening pass)](history/changelogs/CHANGELOG-P23-FAKE-SUCCESS-ELIMINATION.md)
- [Phase 00 — Foundation & Production Integrity (2026-10-13)](history/changelogs/CHANGELOG-PHASE-00-FOUNDATION.md)
- [CHANGELOG — Phase 01 (2026-10-14)](history/changelogs/CHANGELOG-PHASE-01-PAYMENT-CORE.md)
- [Phase 02 changelog](history/changelogs/CHANGELOG-PHASE-02-WALLET-SPLIT-PAYMENT.md)
- [CHANGELOG — Phase 03 Financial Operations Hub (partial)](history/changelogs/CHANGELOG-PHASE-03-FINANCIAL-OPERATIONS-HUB.md)
- [Changelog — Phase 1 Engineering Report / Re-verification Pass](history/changelogs/CHANGELOG-PHASE-1-ENGINEERING-REPORT.md)
- [CHANGELOG — Phase 2-B: Real Doctor Workflow](history/changelogs/CHANGELOG-PHASE-2B.md)
- [Phase 2-C — Admin Platform](history/changelogs/CHANGELOG-PHASE-2C.md)
- [PHASE DOC-01 — Doctor Dashboard Command Center](history/changelogs/CHANGELOG-PHASE-DOC-01-DOCTOR-DASHBOARD.md)
- [PHASE DOC-01 — Doctor Dashboard Command Center Finalization](history/changelogs/CHANGELOG-PHASE-DOC-01-FINALIZATION.md)
- [Phase DOC-02 — Doctor Smart Inbox](history/changelogs/CHANGELOG-PHASE-DOC-02-SMART-INBOX.md)
- [PHASE DOC-03 — Doctor Patient Relationship Center](history/changelogs/CHANGELOG-PHASE-DOC-03-PATIENT-RELATIONSHIP-CENTER.md)
- [PHASE DOC-03B — Patient Relationship Center: Final Completion & Hardening](history/changelogs/CHANGELOG-PHASE-DOC-03B-PATIENT-RELATIONSHIP-CENTER-FINAL.md)
- [PHASE DOC-04 — Doctor Appointments Rebuild](history/changelogs/CHANGELOG-PHASE-DOC-04-DOCTOR-APPOINTMENTS.md)
- [PHASE DOC-05 — Doctor Reviews & Reputation Workspace](history/changelogs/CHANGELOG-PHASE-DOC-05-REVIEWS-REPUTATION.md)
- [PHASE DOC-06 — Clinical Intelligence & Consultation Workspace](history/changelogs/CHANGELOG-PHASE-DOC-06-CLINICAL-WORKSPACE.md)
- [DOC-07 Final Pass — Command Center Redesign, Consistency Audit, Responsive Pass](history/changelogs/CHANGELOG-PHASE-DOC-07-COMMAND-CENTER-FINAL.md)
- [DOC-07 Final Pass — Follow-up Scheduling, Week/Month Views (Interim)](history/changelogs/CHANGELOG-PHASE-DOC-07-FINAL-PASS-INTERIM.md)
- [PHASE DOC-07 — Schedule & Capacity Intelligence](history/changelogs/CHANGELOG-PHASE-DOC-07-SCHEDULE-CAPACITY-INTELLIGENCE.md)
- [PHASE DOC-09 — Doctor Earnings / Financial Control Center](history/changelogs/CHANGELOG-PHASE-DOC-09-EARNINGS.md)
- [P1 — Doctor Experience Foundation](history/changelogs/CHANGELOG-PHASE-P1-DOCTOR-EXPERIENCE-FOUNDATION.md)
- [Phase P10 — Follow-up / Continuity](history/changelogs/CHANGELOG-PHASE-P10-FOLLOW-UP-CONTINUITY.md)
- [Phase P11 — Public Experience 2.0 — Final Scope](history/changelogs/CHANGELOG-PHASE-P11-PUBLIC-EXPERIENCE-2.0.md)
- [MediCore HMS — Phase P12](history/changelogs/CHANGELOG-PHASE-P12-DOCTOR-DISCOVERY-GEOGRAPHIC-INTELLIGENCE.md)
- [Phase P12 — Final Closure Changes](history/changelogs/CHANGELOG-PHASE-P12-FINAL-CLOSURE.md)
- [MediCore HMS — P13 Closure Pass](history/changelogs/CHANGELOG-PHASE-P13-PUBLIC-PRODUCT-EXPERIENCE.md)
- [MediCore HMS — P14 Authentication UX](history/changelogs/CHANGELOG-PHASE-P14-AUTHENTICATION-UX.md)
- [Phase P15 — Secure Password Recovery with Real Email OTP](history/changelogs/CHANGELOG-PHASE-P15-PASSWORD-RECOVERY-OTP-BREVO.md)
- [MediCore HMS — Phase 16 Final Closure Audit](history/changelogs/CHANGELOG-PHASE-P16-FINAL-CLOSURE-AUDIT.md)
- [MediCore HMS — Phase 16 Legal, Privacy, Consent & User Data Rights](history/changelogs/CHANGELOG-PHASE-P16-LEGAL-PRIVACY-CONSENT.md)
- [MediCore HMS — Phase 17 Contact + Lead Management](history/changelogs/CHANGELOG-PHASE-P17-LEAD-MANAGEMENT.md)
- [Phase 18 — Doctor Profile 3.0](history/changelogs/CHANGELOG-PHASE-P18-DOCTOR-PROFILE-3.0.md)
- [MediCore HMS — P18.1 Doctor Profile 3.0 Intelligence Upgrade](history/changelogs/CHANGELOG-PHASE-P18.1-DOCTOR-PROFILE-INTELLIGENCE.md)
- [P19 — Article Management, Authoring & Publication Repair](history/changelogs/CHANGELOG-PHASE-P19-ARTICLE-MANAGEMENT-PUBLICATION-REPAIR.md)
- [MediCore HMS — Phase P19 — Services + Content](history/changelogs/CHANGELOG-PHASE-P19-SERVICES-CONTENT.md)
- [PHASE P2 — Doctor Dashboard 2.0 (Trends & Intelligence pass)](history/changelogs/CHANGELOG-PHASE-P2-DOCTOR-DASHBOARD-TRENDS.md)
- [Phase P20 — SEO Infrastructure](history/changelogs/CHANGELOG-PHASE-P20-SEO-INFRASTRUCTURE.md)
- [Phase P22 — End-to-End Booking Experience 3.0](history/changelogs/CHANGELOG-PHASE-P22-BOOKING-JOURNEY-3.0.md)
- [PHASE P23 — Payment + Refund 3.0](history/changelogs/CHANGELOG-PHASE-P23-PAYMENT-REFUND-3.0.md)
- [Phase P3 — Patient Relationship (MediCore-PRIME-20)](history/changelogs/CHANGELOG-PHASE-P3-PATIENT-RELATIONSHIP.md)
- [Phase P4 — Appointment 2.0](history/changelogs/CHANGELOG-PHASE-P4-APPOINTMENT-2.0.md)
- [CHANGELOG — Phase P6 FINAL: Clinical Workspace 2.0 Gap-Closure](history/changelogs/CHANGELOG-PHASE-P6-CLINICAL-WORKSPACE-2.0-FINAL.md)
- [CHANGELOG — Phase P6: Clinical Workspace 2.0](history/changelogs/CHANGELOG-PHASE-P6-CLINICAL-WORKSPACE-2.0.md)
- [Phase P9 — Documents & Records](history/changelogs/CHANGELOG-PHASE-P9-DOCUMENTS.md)
- [PHASE UI-10 — Mission Control, Platform Health & Operations Command Workspace](history/changelogs/CHANGELOG-PHASE-UI-10-MISSION-CONTROL-OPERATIONS.md)
- [PHASE UI-12 — AI Command Center & AI Operational Intelligence](history/changelogs/CHANGELOG-PHASE-UI-12-AI-COMMAND-CENTER.md)
- [CHANGELOG — PHASE UI-13 FINAL + UI-14 ADMIN PLATFORM ADMINISTRATION WORKSPACE](history/changelogs/CHANGELOG-PHASE-UI-13-FINAL-UI-14-ADMIN-PLATFORM.md)
- [PHASE UI-13 — Carry-Forward Hardening Pass](history/changelogs/CHANGELOG-PHASE-UI-13-HARDENING.md)
- [PHASE UI-13 — Process, Automation & Governance Intelligence Workspace](history/changelogs/CHANGELOG-PHASE-UI-13-PROCESS-AUTOMATION-GOVERNANCE.md)
- [PHASE UI-5 — Payments Management Workspace](history/changelogs/CHANGELOG-PHASE-UI-5-PAYMENTS.md)
- [PHASE UI-6 — Refunds Management Workspace](history/changelogs/CHANGELOG-PHASE-UI-6-REFUNDS.md)
- [PHASE UI-7 — Finance / Finance Operations / Invoices](history/changelogs/CHANGELOG-PHASE-UI-7-FINANCE.md)
- [PHASE UI-8 — Reviews Management, Moderation & Reputation Operations Workspace](history/changelogs/CHANGELOG-PHASE-UI-8-REVIEWS.md)
- [PHASE UI-9 — Executive Admin Command Center](history/changelogs/CHANGELOG-PHASE-UI-9-EXECUTIVE-COMMAND-CENTER.md)
- [PHASE UI-4 — Patients Management Workspace](history/changelogs/CHANGELOG-PHASE-UI4-PATIENTS.md)
- [CHANGELOG — Phase UI-3: Appointment Operations Workspace](history/changelogs/CHANGELOG-appointment-operations-workspace.md)
- [MediCore HMS — Doctor Clinical Intelligence Workspace (Phase D2)](history/changelogs/CHANGELOG-clinical-intelligence-workspace.md)
- [MediCore HMS — Phase D5: Doctor AI Automation & Smart Practice Platform (Core Slice)](history/changelogs/CHANGELOG-doctor-ai-automation.md)
- [MediCore HMS — Doctor Command Center (Phase D1)](history/changelogs/CHANGELOG-doctor-command-center.md)
- [MediCore HMS — Phase D4: Doctor Identity & Practice Management Platform](history/changelogs/CHANGELOG-doctor-practice-management.md)
- [PHASE UI-2 — Doctor Management Workspace](history/changelogs/CHANGELOG-doctors-management.md)
- [Patient Financial Ecosystem — Implementation Summary](history/changelogs/CHANGELOG-financial-ecosystem.md)
- [Patient Digital Health Ecosystem — Implementation Summary](history/changelogs/CHANGELOG-health-ecosystem.md)
- [Personal Health Intelligence Platform — Implementation Summary](history/changelogs/CHANGELOG-personal-health-intelligence.md)
- [MediCore HMS — Product Hardening Pass (Process Governance ZIP)](history/changelogs/CHANGELOG-process-governance-hardening.md)
- [MediCore HMS — Product Experience Phase 1](history/changelogs/CHANGELOG-product-experience-phase1.md)
- [PHASE UI-1 — Services Management: Premium UI Reconstruction + Real Backend](history/changelogs/CHANGELOG-services-management.md)
- [MediCore HMS / HMS Pro — Global UI Foundation (Phase 1)](history/changelogs/CHANGELOG-ui-foundation-phase1.md)

### Phase reports (29)

- [Doctor Workspace → Digital Clinic — Implementation Summary](history/phase-reports/DOCTOR_WORKSPACE_PHASE_SUMMARY.md)
- [MediCore HMS — Final End-to-End Closure Report](history/phase-reports/FINAL-END-TO-END-CLOSURE-REPORT.md)
- [MediCore HMS — Final End-to-End Regression Report](history/phase-reports/FINAL-END-TO-END-REGRESSION-REPORT.md)
- [MediCore HMS — Full Data / Content / End-to-End Repair](history/phase-reports/FULL-DATA-CONTENT-END-TO-END-REPAIR.md)
- [P11 delivery notes](history/phase-reports/P11-DELIVERY-NOTES.md)
- [MediCore HMS — P11 Final QA](history/phase-reports/P11-FINAL-QA.md)
- [P12 Final Closure QA — Evidence Report](history/phase-reports/P12-FINAL-QA.md)
- [P12 Verification Status](history/phase-reports/P12-VERIFICATION-STATUS.md)
- [Patient Care Journey — Implementation Summary](history/phase-reports/PATIENT_CARE_JOURNEY_PHASE_SUMMARY.md)
- [Phase 01 — Payment core, state machine & webhook integrity](history/phase-reports/PHASE-01-PAYMENT-CORE.md)
- [Phase 02 — Final Closure Report](history/phase-reports/PHASE-02-FINAL-CLOSURE.md)
- [Phase 02 — Wallet, Recharge, Split-Payment & Coupon Integrity](history/phase-reports/PHASE-02-WALLET-SPLIT-PAYMENT.md)
- [PHASE 03 — Financial Operations Hub (completion pass, honest status)](history/phase-reports/PHASE-03-REFUND-LEDGER-OUTBOX.md)
- [Phase 1 Closure Report — MediCore HMS](history/phase-reports/PHASE-1-CLOSURE-REPORT.md)
- [Subtest: concurrent approve+approve on the same pending doctor: exactly one wins the atomi](history/phase-reports/PHASE-1-CLOSURE-TEST-RESULTS.txt)
- [Phase 1 Engineering Report — MediCore HMS Production Hardening](history/phase-reports/PHASE-1-ENGINEERING-REPORT.md)
- [Phase 1 — Identity + Email Verification + Doctor Onboarding Foundation](history/phase-reports/PHASE-1-IDENTITY-VERIFICATION-REPORT.md)
- [PHASE 2 — NOTIFICATION REALTIME CLOSURE](history/phase-reports/PHASE-2-NOTIFICATION-REALTIME-CLOSURE.md)
- [Phase 2 — Notifications + Realtime UX Report](history/phase-reports/PHASE-2-NOTIFICATION-REALTIME-REPORT.md)
- [PHASE 2-A — Real Patient/User Product Implementation & Testing Report](history/phase-reports/PHASE-2A-USER-PATIENT-REPORT.md)
- [Phase 2-B Doctor Report](history/phase-reports/PHASE-2B-DOCTOR-REPORT.md)
- [Phase 2-C Admin Report](history/phase-reports/PHASE-2C-ADMIN-REPORT.md)
- [PHASE 2-D — System Integration & Production Hardening](history/phase-reports/PHASE-2D-CROSS-ROLE-PUBLIC-REPORT.md)
- [Phase 2-D — Doctor Verification E2E: Investigation & Fixes](history/phase-reports/PHASE-2D-REPORT.md)
- [Phase 2-E — E2E Validation Status](history/phase-reports/PHASE-2E-E2E-VALIDATION.md)
- [PHASE 3 — MASTER DATA + DATA CONSISTENCY REPORT](history/phase-reports/PHASE-3-MASTER-DATA-REPORT.md)
- [PHASE 4 — PERFORMANCE + NAVIGATION REPORT](history/phase-reports/PHASE-4-PERFORMANCE-REPORT.md)
- [MediCore HMS — Phase 4 Regression Fix Report](history/phase-reports/PHASE-4-REGRESSION-FIX-REPORT.md)
- [MediCore HMS — Post Phase-4 Regression Verification](history/phase-reports/POST-PHASE-4-REGRESSION-VERIFICATION.md)

### Engineering reports (17)

- [MediCore HMS — Admin Implementation Log](history/engineering-reports/ADMIN-IMPLEMENTATION-LOG.md)
- [Appointment Engine — Implementation Report](history/engineering-reports/APPOINTMENT-IMPLEMENTATION-REPORT.md)
- [Architecture Report — A6.2.4 — Enterprise Monitoring Platform](history/engineering-reports/ARCHITECTURE-A6.2.4-monitoring-platform.md)
- [ARCHITECTURE REPORT — A6.2.5: Autonomous Workflow Intelligence & Self-Healing Platform](history/engineering-reports/ARCHITECTURE-A6.2.5-autonomous-workflow-intelligence.md)
- [MediCore HMS — Doctor ↔ Patient Communication: Implementation Report](history/engineering-reports/COMMUNICATION-IMPLEMENTATION-REPORT.md)
- [MediCore HMS — Doctor-side implementation log](history/engineering-reports/DOCTOR-IMPLEMENTATION-LOG.md)
- [MediCore-HMS Financial Implementation Map](history/engineering-reports/FINANCIAL-IMPLEMENTATION-MAP.md)
- [Frontend hardening pass (2026-10-17)](history/engineering-reports/FRONTEND-HARDENING-2026-10-17.md)
- [PAYMENT IMPLEMENTATION REPORT — 2026-10-07 (slices 1-2)](history/engineering-reports/PAYMENT-IMPLEMENTATION-REPORT.md)
- [Production Financial Verification](history/engineering-reports/PRODUCTION-FINANCIAL-VERIFICATION.md)
- [Verification Report — A6.2.4 — Enterprise Monitoring Platform](history/engineering-reports/VERIFICATION-A6.2.4-monitoring-platform.md)
- [VERIFICATION REPORT — A6.2.5: Autonomous Workflow Intelligence & Self-Healing Platform](history/engineering-reports/VERIFICATION-A6.2.5-autonomous-workflow-intelligence.md)
- [Bug Fixes Report](history/engineering-reports/bug-fixes-report.md)
- [Final Package Checklist](history/engineering-reports/final-package-checklist.md)
- [Integration Report](history/engineering-reports/integration-report.md)
- [Missing Connections Report](history/engineering-reports/missing-connections-report.md)
- [Validation Report](history/engineering-reports/validation-report.md)

### Historical status and remediation (8)

- [MediCore HMS — Production Deployment Runbook](history/historical-status/DEPLOYMENT-RUNBOOK-2026-09-15.md)
- [🧠 Engineering Decisions](history/historical-status/ENGINEERING_DECISIONS.md)
- [Phase 00 — Foundation & Production Integrity: implementation progress](history/historical-status/IMPLEMENTATION-PROGRESS.md)
- [MediCore HMS — Session Changelog & Honest Status (v3)](history/historical-status/SESSION_CHANGELOG.md)
- [APPOINTMENT ENGINE REMEDIATION — 2026-09-24](history/historical-status/remediation/APPOINTMENT-ENGINE-REMEDIATION-2026-09-24.md)
- [CHECKPOINT CHANGELOG — 2026-09-23](history/historical-status/remediation/CHECKPOINT-CHANGELOG.md)
- [CURRENT REMEDIATION CHECKPOINT — 2026-09-23](remediation/CHECKPOINT-STATUS-2026-09-23.md)
- [MediCore HMS — Master Data + Doctor Onboarding Location Flow Remediation](history/historical-status/remediation/MASTER-DATA-ONBOARDING-REMEDIATION-2026-09-24.md)

## Other

- [Changelog entry point](../CHANGELOG.md) · [Contributing](../CONTRIBUTING.md) · [Code of conduct](../CODE_OF_CONDUCT.md)
