# Remaining risks and verification gaps

This page records documentation-supported gaps and verification work that cannot be closed by editing prose. It is not a full security, infrastructure, financial, or application audit.

## 1. Test results are inconsistent across reports

Historical reports list 90 passed / 4 failed, 185/185, and 190/190 results. The reports have not been tied to one exact source commit and execution environment here. The current result is **Unverified**. Run the documented suite on the exact candidate commit before publishing a fresh result; retain command output and environment details.

## 2. Live integrations need runtime verification

The repository documents MongoDB, Razorpay, and Brevo-related configuration. Live connection, gateway signature handling, webhook delivery, email delivery, and complete user journeys require the appropriate test environment and cannot be established by source inspection alone.

## 3. Deployment is not verified by this documentation pass

Dockerfiles, Compose configuration, CI workflow files, and hosting-related configuration exist in the repository. This task did not build containers, start services, deploy the application, or inspect external service state. Verify health checks, environment variables, CORS, frontend API URL, storage persistence, and logs in the intended deployment environment.

## 4. Uploaded-file persistence and backups

Deployment and risk documents describe local/volume-backed uploaded files. Confirm the actual storage configuration and backup/restore procedure for the target deployment. A MongoDB backup alone may not include files stored outside MongoDB.

## 5. Dependency advisories are time-sensitive

Historical validation and audit reports disagree about dependency vulnerability status. Do not rely on old “zero vulnerabilities” claims. Check the lockfiles and current package advisory data at release time, record the date and command, and assess required upgrades separately. This documentation-only task did not run dependency audits or change packages.

## 6. Security and compliance claims

Security-related middleware and authentication code may be present, but this review does not establish security effectiveness, regulatory compliance, privacy compliance, or suitability for real patient data. Such claims require dedicated review and operational evidence.

## 7. Release evidence required

Before calling a build verified, record the exact commit, runtime versions, commands, exit codes, test totals, relevant environment constraints, and which external systems were exercised. Separate unit/static checks from real-database, browser, gateway, container, CI, and production verification.

## Scope note

No application code, tests, dependencies, environment configuration, deployment configuration, or external services were modified or tested as part of this documentation cleanup.
