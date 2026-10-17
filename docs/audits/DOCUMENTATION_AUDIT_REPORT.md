# Documentation Audit Report

**Review date:** 2026-10-18  
**Input archive:** `MediCore-HMS-PHASE-03-AUDITED-FIXED-2026-10-17(1).zip`  
**Scope:** documentation cleanup and consistency review only.

## Summary

The supplied project archive was extracted to a separate working directory; the original uploaded ZIP was not modified. All 178 Markdown/text documentation files found in the project snapshot were read into the review inventory and scanned for headings, duplicate content, placeholder-like language, and references. The repository's manifests, Node version selector, environment examples, and selected source/configuration paths were inspected only to verify documentation wording and commands.

The project contains a React/Vite frontend, a Node.js/Express backend, MongoDB/Mongoose persistence, and documented real-time, clinical, and financial workflows. This review did not test or audit the application.

### Main findings and actions

- Rewrote the root `README.md` and current docs index/status/risk/deployment/testing/feature pages to use clearer, evidence-qualified wording.
- Removed `docs/ARCHITECTURE_REVIEW.md` because it was byte-for-byte identical to `docs/ARCHITECTURE.md`.
- Moved historical changelogs, dated reports, phase reports, remediation notes, and scenario descriptions into categorized `docs/history/` and `docs/testing/scenarios/` directories. Historical content was retained rather than rewritten to appear current.
- Preserved the root `license`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.
- Added this report under `docs/audits/`.
- Updated relative Markdown links affected by file moves. Final link checks are recorded below.

## Contradictory and unsupported claims

### Conflicting test totals

The original documentation contains conflicting totals, including **90 passed / 4 failed**, **185/185**, and **190/190**. The reports were not proven to describe the same commit, test selection, or environment. No result was selected as current. `docs/PROJECT_STATUS.md` now marks the current result **Unverified**, and the older claims remain historical.

### Production readiness

Some historical scorecards/reports use “production-ready” language while other documentation identifies missing live integration or deployment evidence. The current status no longer asserts production readiness. Presence of source code, configuration, tests, or an old report is not proof of production behavior.

### Dependency vulnerability status

Older validation material reports a zero-vulnerability result while other historical risk material mentions dependency advisories. Vulnerability data is time-sensitive. This task did not run `npm audit`, upgrade dependencies, or choose one historical claim as current.

### Feature and integration claims

Feature documentation was revised to describe source/documentation evidence without claiming end-to-end success. MongoDB behavior, Razorpay sandbox flows, Brevo delivery, browser journeys, CI execution, container health, backups, and deployed availability remain **Unverified** or **Require runtime verification**.

## Evidence and review method

Documentation claims were checked against the repository snapshot where practical, including:

- `package.json` and `backend/package.json` for declared scripts and dependencies.
- `.nvmrc` for the repository's Node version selector.
- `.env.example` and `backend/.env.example` for documented configuration names.
- `Dockerfile`, `backend/Dockerfile`, `docker-compose.yml`, `nginx.conf`, `vercel.json`, `render.yaml.example`, and `.github/workflows/` for the existence of deployment/CI configuration.
- `src/`, `backend/routes/`, `backend/controllers/`, `backend/models/`, `backend/payments/`, and `backend/tests/` only as references when evaluating whether documentation had a corresponding source area.

This is not a complete source audit. Source references do not establish correctness, and no runtime behavior was tested.

## File changes

### Rewritten

- `README.md`
- `docs/README.md`
- `docs/FEATURES.md`
- `docs/PROJECT_STATUS.md`
- `docs/REMAINING_RISKS.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `docs/TESTING-AND-RELEASE-GATES.md`

### Removed

- `docs/ARCHITECTURE_REVIEW.md` — exact duplicate of `docs/ARCHITECTURE.md`.

### Archived/moved

Historical documents were moved into the destinations listed in the inventory below. Existing content was preserved, and relative Markdown links were adjusted where they referenced moved paths. The root aggregate `CHANGELOG.md` was retained.

### Created

- `docs/audits/DOCUMENTATION_AUDIT_REPORT.md`
- `docs/history/` categorized folders, where required by the archived files.
- `docs/testing/scenarios/` for scenario descriptions.

## Validation results

- **Relative Markdown links:** checked all Markdown files in the working repository after the report was created; no broken relative Markdown links were found.
- **Markdown rendering:** headings and tables were authored in standard Markdown; no external Markdown renderer was run.
- **Commands/configuration:** commands in the rewritten README and deployment/testing guides were compared to the root/backend package manifests and checked-in environment examples. Commands were not executed.
- **Application diff:** no application source, tests, package manifests, lockfiles, environment files, Dockerfiles, CI workflows, or deployment configuration were intentionally edited.
- **Runtime, integration, security, and production verification:** not performed.

## Remaining unknowns

1. Which historical test count corresponds to the exact candidate commit.
2. Whether MongoDB integration suites pass against a real dedicated test database.
3. Whether Razorpay sandbox payment/refund flows and webhook behavior pass end-to-end.
4. Whether email delivery, browser workflows, CI, Docker Compose, deployed health checks, and storage persistence work in the target environment.
5. Current dependency advisory status.
6. Whether every historical feature claim remains accurate for the exact supplied commit.

These are not closed by documentation edits and must not be represented as verified.

## Complete file-by-file inventory

The inventory records the original path, purpose, action, destination, and reason. “KEEP” means retained; it does not mean every claim in the file was independently verified.

| Original path | Purpose | Action | Destination | Reason |
|---|---|---|---|---|
| `AUDIT_REPORT_2026-09-12.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/root-reports/AUDIT_REPORT_2026-09-12.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-FINAL-END-TO-END-CLOSURE.md` | Historical change/phase log | ARCHIVE | `docs/history/root-reports/CHANGELOG-FINAL-END-TO-END-CLOSURE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-FINANCIAL-HARDENING-SLICE1.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/root-reports/CHANGELOG-FINANCIAL-HARDENING-SLICE1.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-FINANCIAL-HARDENING-SLICE2.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/root-reports/CHANGELOG-FINANCIAL-HARDENING-SLICE2.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-P23-CONCURRENCY-HARDENING.md` | Historical change/phase log | ARCHIVE | `docs/history/root-reports/CHANGELOG-P23-CONCURRENCY-HARDENING.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-P23-CONTINUATION.md` | Historical change/phase log | ARCHIVE | `docs/history/root-reports/CHANGELOG-P23-CONTINUATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-P23-FAKE-SUCCESS-ELIMINATION.md` | Historical change/phase log | ARCHIVE | `docs/history/root-reports/CHANGELOG-P23-FAKE-SUCCESS-ELIMINATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-PHASE-00-FOUNDATION.md` | Historical change/phase log | ARCHIVE | `docs/history/root-reports/CHANGELOG-PHASE-00-FOUNDATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-PHASE-01-PAYMENT-CORE.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/root-reports/CHANGELOG-PHASE-01-PAYMENT-CORE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-PHASE-02-WALLET-SPLIT-PAYMENT.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/root-reports/CHANGELOG-PHASE-02-WALLET-SPLIT-PAYMENT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-PHASE-03-FINANCIAL-OPERATIONS-HUB.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/root-reports/CHANGELOG-PHASE-03-FINANCIAL-OPERATIONS-HUB.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-PHASE-2B.md` | Historical change/phase log | ARCHIVE | `docs/history/root-reports/CHANGELOG-PHASE-2B.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG-PHASE-2C.md` | Historical change/phase log | ARCHIVE | `docs/history/root-reports/CHANGELOG-PHASE-2C.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CHANGELOG.md` | Historical change/phase log | KEEP | `CHANGELOG.md` | Aggregate changelog retained as historical entry point. |
| `CODE_OF_CONDUCT.md` | Community conduct policy | KEEP | `CODE_OF_CONDUCT.md` | Policy/license retained; license text not rewritten. |
| `COMMUNICATION-IMPLEMENTATION-REPORT.md` | Implementation/progress report | ARCHIVE | `docs/history/root-reports/COMMUNICATION-IMPLEMENTATION-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `CONTRIBUTING.md` | Contribution guidelines | KEEP | `CONTRIBUTING.md` | Policy/license retained; license text not rewritten. |
| `P12-FINAL-QA.md` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/history/root-reports/P12-FINAL-QA.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `PHASE-2D-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/root-reports/PHASE-2D-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `README.md` | Project entry point / documentation index | REWRITE | `README.md` | Rewritten with manifest-backed commands and explicit verification limits. |
| `SECURITY.md` | Security policy or dated security review | KEEP | `SECURITY.md` | Policy/license retained; license text not rewritten. |
| `backend/master-data/source/lgd/README.md` | Project entry point / documentation index | KEEP | `backend/master-data/source/lgd/README.md` | Retained root-level documentation/policy; no application implementation changes. |
| `docs/APPOINTMENT-BUSINESS-LOGIC-SPEC.md` | Appointment workflow/design/report | ARCHIVE | `docs/history/phases/APPOINTMENT-BUSINESS-LOGIC-SPEC.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/APPOINTMENT-IMPLEMENTATION-REPORT.md` | Implementation/progress report | ARCHIVE | `docs/history/audits/APPOINTMENT-IMPLEMENTATION-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/ARCHITECTURE-A6.2.4-monitoring-platform.md` | Architecture overview or architecture review | ARCHIVE | `docs/history/phases/ARCHITECTURE-A6.2.4-monitoring-platform.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/ARCHITECTURE-A6.2.5-autonomous-workflow-intelligence.md` | Architecture overview or architecture review | ARCHIVE | `docs/history/phases/ARCHITECTURE-A6.2.5-autonomous-workflow-intelligence.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/ARCHITECTURE.md` | Architecture overview or architecture review | KEEP | `docs/ARCHITECTURE.md` | Canonical architecture document retained; duplicate removed. |
| `docs/ARCHITECTURE_REVIEW.md` | Architecture overview or architecture review | REMOVE | `—` | Exact byte-for-byte duplicate of docs/ARCHITECTURE.md. |
| `docs/AUDIT-FIX-REPORT-2026-10-17.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/AUDIT-FIX-REPORT-2026-10-17.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/AUDIT_REPORT.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/AUDIT_REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/BUG-AND-RISK-REGISTER.md` | Risk or defect tracking | ARCHIVE | `docs/history/phases/BUG-AND-RISK-REGISTER.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A5.1.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A5.1.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A5.2.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A5.2.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A5.3.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A5.3.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.1.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.1.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.2.1-enterprise-workflow-automation-core.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.2.1-enterprise-workflow-automation-core.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.2.2-smart-assignment-engine.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.2.2-smart-assignment-engine.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.2.3-automation-studio.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.2.3-automation-studio.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.2.4-monitoring-platform.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.2.4-monitoring-platform.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.2.5-autonomous-workflow-intelligence.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.2.5-autonomous-workflow-intelligence.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.3-enterprise-process-orchestration.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.3-enterprise-process-orchestration.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.3.3-process-designer.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.3.3-process-designer.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.3.4-process-analytics-optimization.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.3.4-process-analytics-optimization.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-A6.3.5-process-governance.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-A6.3.5-process-governance.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-ADMIN-FINAL-INTEGRITY-PASS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-ADMIN-FINAL-INTEGRITY-PASS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-APPOINTMENT-REGRESSION-REPAIR.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-APPOINTMENT-REGRESSION-REPAIR.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-1-ENGINEERING-REPORT.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-1-ENGINEERING-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-01-DOCTOR-DASHBOARD.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-01-DOCTOR-DASHBOARD.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-01-FINALIZATION.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-01-FINALIZATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-02-SMART-INBOX.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-02-SMART-INBOX.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-03-PATIENT-RELATIONSHIP-CENTER.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-03-PATIENT-RELATIONSHIP-CENTER.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-03B-PATIENT-RELATIONSHIP-CENTER-FINAL.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-03B-PATIENT-RELATIONSHIP-CENTER-FINAL.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-04-DOCTOR-APPOINTMENTS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-04-DOCTOR-APPOINTMENTS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-05-REVIEWS-REPUTATION.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-05-REVIEWS-REPUTATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-06-CLINICAL-WORKSPACE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-06-CLINICAL-WORKSPACE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-07-COMMAND-CENTER-FINAL.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-07-COMMAND-CENTER-FINAL.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-07-FINAL-PASS-INTERIM.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-07-FINAL-PASS-INTERIM.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-07-SCHEDULE-CAPACITY-INTELLIGENCE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-07-SCHEDULE-CAPACITY-INTELLIGENCE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-DOC-09-EARNINGS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-DOC-09-EARNINGS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P1-DOCTOR-EXPERIENCE-FOUNDATION.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P1-DOCTOR-EXPERIENCE-FOUNDATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P10-FOLLOW-UP-CONTINUITY.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P10-FOLLOW-UP-CONTINUITY.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P11-PUBLIC-EXPERIENCE-2.0.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P11-PUBLIC-EXPERIENCE-2.0.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P12-DOCTOR-DISCOVERY-GEOGRAPHIC-INTELLIGENCE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P12-DOCTOR-DISCOVERY-GEOGRAPHIC-INTELLIGENCE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P12-FINAL-CLOSURE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P12-FINAL-CLOSURE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P13-PUBLIC-PRODUCT-EXPERIENCE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P13-PUBLIC-PRODUCT-EXPERIENCE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P14-AUTHENTICATION-UX.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P14-AUTHENTICATION-UX.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P15-PASSWORD-RECOVERY-OTP-BREVO.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P15-PASSWORD-RECOVERY-OTP-BREVO.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P16-FINAL-CLOSURE-AUDIT.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P16-FINAL-CLOSURE-AUDIT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P16-LEGAL-PRIVACY-CONSENT.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P16-LEGAL-PRIVACY-CONSENT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P17-LEAD-MANAGEMENT.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P17-LEAD-MANAGEMENT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P18-DOCTOR-PROFILE-3.0.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P18-DOCTOR-PROFILE-3.0.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P18.1-DOCTOR-PROFILE-INTELLIGENCE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P18.1-DOCTOR-PROFILE-INTELLIGENCE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P19-ARTICLE-MANAGEMENT-PUBLICATION-REPAIR.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P19-ARTICLE-MANAGEMENT-PUBLICATION-REPAIR.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P19-SERVICES-CONTENT.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P19-SERVICES-CONTENT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P2-DOCTOR-DASHBOARD-TRENDS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P2-DOCTOR-DASHBOARD-TRENDS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P20-SEO-INFRASTRUCTURE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P20-SEO-INFRASTRUCTURE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P22-BOOKING-JOURNEY-3.0.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P22-BOOKING-JOURNEY-3.0.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P23-PAYMENT-REFUND-3.0.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P23-PAYMENT-REFUND-3.0.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P3-PATIENT-RELATIONSHIP.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P3-PATIENT-RELATIONSHIP.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P4-APPOINTMENT-2.0.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P4-APPOINTMENT-2.0.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P6-CLINICAL-WORKSPACE-2.0-FINAL.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P6-CLINICAL-WORKSPACE-2.0-FINAL.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P6-CLINICAL-WORKSPACE-2.0.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P6-CLINICAL-WORKSPACE-2.0.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-P9-DOCUMENTS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-P9-DOCUMENTS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-10-MISSION-CONTROL-OPERATIONS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-10-MISSION-CONTROL-OPERATIONS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-12-AI-COMMAND-CENTER.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-12-AI-COMMAND-CENTER.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-13-FINAL-UI-14-ADMIN-PLATFORM.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-13-FINAL-UI-14-ADMIN-PLATFORM.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-13-HARDENING.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-13-HARDENING.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-13-PROCESS-AUTOMATION-GOVERNANCE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-13-PROCESS-AUTOMATION-GOVERNANCE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-5-PAYMENTS.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-5-PAYMENTS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-6-REFUNDS.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-6-REFUNDS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-7-FINANCE.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-7-FINANCE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-8-REVIEWS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-8-REVIEWS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI-9-EXECUTIVE-COMMAND-CENTER.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI-9-EXECUTIVE-COMMAND-CENTER.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-PHASE-UI4-PATIENTS.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-PHASE-UI4-PATIENTS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-appointment-operations-workspace.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-appointment-operations-workspace.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-clinical-intelligence-workspace.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-clinical-intelligence-workspace.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-doctor-ai-automation.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-doctor-ai-automation.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-doctor-command-center.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-doctor-command-center.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-doctor-practice-management.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-doctor-practice-management.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-doctors-management.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-doctors-management.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-financial-ecosystem.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/changelogs/CHANGELOG-financial-ecosystem.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-health-ecosystem.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-health-ecosystem.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-personal-health-intelligence.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-personal-health-intelligence.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-process-governance-hardening.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-process-governance-hardening.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-product-experience-phase1.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-product-experience-phase1.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-services-management.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-services-management.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/CHANGELOG-ui-foundation-phase1.md` | Historical change/phase log | ARCHIVE | `docs/history/changelogs/CHANGELOG-ui-foundation-phase1.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/DEPLOYMENT-RUNBOOK-2026-09-15.md` | Deployment/setup instructions | ARCHIVE | `docs/history/phases/DEPLOYMENT-RUNBOOK-2026-09-15.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/DEPLOYMENT_GUIDE.md` | Deployment/setup instructions | REWRITE | `docs/DEPLOYMENT_GUIDE.md` | Rewritten to distinguish source references from runtime evidence and reconcile conflicting historical claims. |
| `docs/DOCTOR_WORKSPACE_PHASE_SUMMARY.md` | Role/workflow documentation or phase report | ARCHIVE | `docs/history/phases/DOCTOR_WORKSPACE_PHASE_SUMMARY.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/ENGINEERING_DECISIONS.md` | Project-specific engineering note or historical report | KEEP | `docs/ENGINEERING_DECISIONS.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/ENTERPRISE_READINESS_SCORE.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/ENTERPRISE_READINESS_SCORE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/FEATURES.md` | Feature inventory/status | REWRITE | `docs/FEATURES.md` | Rewritten to distinguish source references from runtime evidence and reconcile conflicting historical claims. |
| `docs/FINAL-END-TO-END-CLOSURE-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/FINAL-END-TO-END-CLOSURE-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/FINAL-END-TO-END-REGRESSION-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/FINAL-END-TO-END-REGRESSION-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/FINANCIAL-ACCOUNTING-CONTRACT.md` | Financial/payment design or phase report | KEEP | `docs/FINANCIAL-ACCOUNTING-CONTRACT.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/FINANCIAL-IMPLEMENTATION-MAP.md` | Financial/payment design or phase report | KEEP | `docs/FINANCIAL-IMPLEMENTATION-MAP.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/FINANCIAL_ARCHITECTURE.md` | Architecture overview or architecture review | KEEP | `docs/FINANCIAL_ARCHITECTURE.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/FULL-DATA-CONTENT-END-TO-END-REPAIR.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/phases/FULL-DATA-CONTENT-END-TO-END-REPAIR.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/IMPLEMENTATION-PROGRESS.md` | Implementation/progress report | ARCHIVE | `docs/history/audits/IMPLEMENTATION-PROGRESS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/MEDICORE-FINANCIAL-FINAL-RE-AUDIT.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/audits/MEDICORE-FINANCIAL-FINAL-RE-AUDIT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/P11-DELIVERY-NOTES.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/phases/P11-DELIVERY-NOTES.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/P11-FINAL-QA.md` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/history/audits/P11-FINAL-QA.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/P12-VERIFICATION-STATUS.md` | Project status or phase status snapshot | ARCHIVE | `docs/history/audits/P12-VERIFICATION-STATUS.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PATIENT_CARE_JOURNEY_PHASE_SUMMARY.md` | Role/workflow documentation or phase report | ARCHIVE | `docs/history/phases/PATIENT_CARE_JOURNEY_PHASE_SUMMARY.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PAYMENT-BUSINESS-LOGIC-SPEC.md` | Financial/payment design or phase report | KEEP | `docs/PAYMENT-BUSINESS-LOGIC-SPEC.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/PAYMENT-IMPLEMENTATION-REPORT.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/audits/PAYMENT-IMPLEMENTATION-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PERFORMANCE_AUDIT_SUMMARY.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/PERFORMANCE_AUDIT_SUMMARY.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-01-PAYMENT-CORE.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/phases/PHASE-01-PAYMENT-CORE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-02-FINAL-CLOSURE.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-02-FINAL-CLOSURE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-02-WALLET-SPLIT-PAYMENT.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/phases/PHASE-02-WALLET-SPLIT-PAYMENT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-03-REFUND-LEDGER-OUTBOX.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/phases/PHASE-03-REFUND-LEDGER-OUTBOX.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-1-CLOSURE-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-1-CLOSURE-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-1-CLOSURE-TEST-RESULTS.txt` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/history/audits/PHASE-1-CLOSURE-TEST-RESULTS.txt` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-1-ENGINEERING-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-1-ENGINEERING-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-1-IDENTITY-VERIFICATION-REPORT.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/PHASE-1-IDENTITY-VERIFICATION-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-2-NOTIFICATION-REALTIME-CLOSURE.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-2-NOTIFICATION-REALTIME-CLOSURE.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-2-NOTIFICATION-REALTIME-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-2-NOTIFICATION-REALTIME-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-2A-USER-PATIENT-REPORT.md` | Role/workflow documentation or phase report | ARCHIVE | `docs/history/audits/PHASE-2A-USER-PATIENT-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-2B-DOCTOR-REPORT.md` | Role/workflow documentation or phase report | ARCHIVE | `docs/history/audits/PHASE-2B-DOCTOR-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-2C-ADMIN-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-2C-ADMIN-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-2D-CROSS-ROLE-PUBLIC-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-2D-CROSS-ROLE-PUBLIC-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-2E-E2E-VALIDATION.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/PHASE-2E-E2E-VALIDATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-3-MASTER-DATA-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-3-MASTER-DATA-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-4-PERFORMANCE-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-4-PERFORMANCE-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-4-REGRESSION-FIX-REPORT.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/PHASE-4-REGRESSION-FIX-REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PHASE-P23-FINANCIAL-AUDIT.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/audits/PHASE-P23-FINANCIAL-AUDIT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/POST-PHASE-4-REGRESSION-VERIFICATION.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/POST-PHASE-4-REGRESSION-VERIFICATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PRODUCTION-FINANCIAL-VERIFICATION.md` | Financial/payment design or phase report | ARCHIVE | `docs/history/audits/PRODUCTION-FINANCIAL-VERIFICATION.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PRODUCTION-READINESS-MASTER-AUDIT-2026-09-15.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/PRODUCTION-READINESS-MASTER-AUDIT-2026-09-15.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PRODUCTION_READINESS_REPORT.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/PRODUCTION_READINESS_REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/PROJECT_STATUS.md` | Project status or phase status snapshot | REWRITE | `docs/PROJECT_STATUS.md` | Rewritten to distinguish source references from runtime evidence and reconcile conflicting historical claims. |
| `docs/README.md` | Project entry point / documentation index | REWRITE | `docs/README.md` | Rewritten to distinguish source references from runtime evidence and reconcile conflicting historical claims. |
| `docs/REMAINING_RISKS.md` | Risk or defect tracking | REWRITE | `docs/REMAINING_RISKS.md` | Rewritten to distinguish source references from runtime evidence and reconcile conflicting historical claims. |
| `docs/SCHEDULER-ARCHITECTURE.md` | Architecture overview or architecture review | KEEP | `docs/SCHEDULER-ARCHITECTURE.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/SECURITY_AUDIT_SUMMARY.md` | Security policy or dated security review | KEEP | `docs/SECURITY_AUDIT_SUMMARY.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/SESSION_CHANGELOG.md` | Historical change/phase log | ARCHIVE | `docs/history/phases/SESSION_CHANGELOG.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/SYSTEM_DESIGN.md` | System and request/data-flow design | KEEP | `docs/SYSTEM_DESIGN.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/TESTING-AND-RELEASE-GATES.md` | Testing scenarios, test results, or QA report | REWRITE | `docs/TESTING-AND-RELEASE-GATES.md` | Rewritten to distinguish source references from runtime evidence and reconcile conflicting historical claims. |
| `docs/TEST_MATRIX.md` | Testing scenarios, test results, or QA report | KEEP | `docs/TEST_MATRIX.md` | Retained as canonical domain reference or useful existing documentation. |
| `docs/VERIFICATION-A6.2.4-monitoring-platform.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/VERIFICATION-A6.2.4-monitoring-platform.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/VERIFICATION-A6.2.5-autonomous-workflow-intelligence.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/VERIFICATION-A6.2.5-autonomous-workflow-intelligence.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/VERIFICATION_REPORT.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/VERIFICATION_REPORT.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/ai-automation-test-scenarios.md` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/testing/scenarios/ai-automation-test-scenarios.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/bug-fixes-report.md` | Risk or defect tracking | ARCHIVE | `docs/history/audits/bug-fixes-report.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/doctor-workflow-test-scenarios.md` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/testing/scenarios/doctor-workflow-test-scenarios.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/final-package-checklist.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/final-package-checklist.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/financial-engine-test-scenarios.md` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/testing/scenarios/financial-engine-test-scenarios.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/integration-report.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/integration-report.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/missing-connections-report.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/audits/missing-connections-report.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/patient-workflow-test-scenarios.md` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/testing/scenarios/patient-workflow-test-scenarios.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/realtime-test-scenarios.md` | Testing scenarios, test results, or QA report | ARCHIVE | `docs/testing/scenarios/realtime-test-scenarios.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/remediation/APPOINTMENT-ENGINE-REMEDIATION-2026-09-24.md` | Appointment workflow/design/report | ARCHIVE | `docs/history/remediation/APPOINTMENT-ENGINE-REMEDIATION-2026-09-24.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/remediation/CHECKPOINT-CHANGELOG.md` | Historical change/phase log | ARCHIVE | `docs/history/remediation/CHECKPOINT-CHANGELOG.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/remediation/CHECKPOINT-STATUS-2026-09-23.md` | Project status or phase status snapshot | ARCHIVE | `docs/history/remediation/CHECKPOINT-STATUS-2026-09-23.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/remediation/GLOBAL-FLOW-INTEGRITY-AUDIT-2026-09-25.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/remediation/GLOBAL-FLOW-INTEGRITY-AUDIT-2026-09-25.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/remediation/MASTER-DATA-ONBOARDING-REMEDIATION-2026-09-24.md` | Project-specific engineering note or historical report | ARCHIVE | `docs/history/remediation/MASTER-DATA-ONBOARDING-REMEDIATION-2026-09-24.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
| `docs/validation-report.md` | Dated audit/verification/readiness snapshot | ARCHIVE | `docs/history/audits/validation-report.md` | Moved without deleting content; retained as historical/scenario reference and links updated where applicable. |
