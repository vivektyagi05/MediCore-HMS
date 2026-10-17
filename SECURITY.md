# Security Policy

MediCore HMS is a healthcare-domain application under active development. The repository contains authentication, role-based access controls, clinical workflows, file handling, real-time features, and financial operations. It is **not to be assumed safe for real patient data or production financial activity** merely because security controls exist in the code. See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) and [`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md) for the documented status and open gaps.

## Reporting a vulnerability

**Please do not publish exploitable security details in a public issue or pull request.**

1. Contact the maintainer privately using the current contact route listed on the repository owner's GitHub profile.
2. Include a concise description, affected component or file, impact, prerequisites, and reproducible steps where safe.
3. Include logs or screenshots only after removing secrets, personal information, tokens, and patient/payment data.
4. Allow the maintainer reasonable time to assess and address the issue before public disclosure.

Do not test against systems or data that you do not own or have explicit permission to assess. There is currently no formal bug bounty program or dedicated security response team. Reports are welcome, but a particular response time cannot be guaranteed.

If the issue concerns the maintainer or the normal contact route is unsuitable, use the reporting mechanisms provided by GitHub where appropriate.

## Sensitive data handling

Never include real patient information, clinical records, credentials, access tokens, private keys, payment card details, gateway secrets, production database dumps, or other sensitive data in public issues, pull requests, commits, or examples.

Use synthetic data that is unmistakably fictitious. Do not use real names or payment references to make test fixtures appear production-derived.

If a secret has been committed accidentally:

- Report it privately; do not create a public issue that republishes it.
- Revoke or rotate the exposed credential promptly.
- Review the exposure window and relevant access logs where available.
- Remember that removing the value in a later commit does not remove it from Git history; follow an appropriate history-cleanup process when necessary.

## Security controls represented in the codebase

The repository currently includes code for the following controls; their presence does not replace verification of configuration and behavior in each deployment:

- Password hashing using `bcrypt` and JWT-based authentication.
- Backend middleware for patient, doctor, and administrative authorization.
- Express security headers through Helmet and request-rate limiting through `express-rate-limit`.
- Startup environment validation, including required configuration and production guards.
- Financial workflows with explicit state machines and server-side payment verification paths.
- Duplicate-processing and integrity protections in selected financial workflows.

Relevant implementation and design references include `backend/middleware/`, `backend/config/`, `backend/app.js`, and [`docs/FINANCIAL_ARCHITECTURE.md`](docs/FINANCIAL_ARCHITECTURE.md). A control's existence in source code does not establish that every route or deployment is configured correctly.

## Known limitations and unverified areas

The following are documented limitations from the current project status and should be rechecked before any production use:

- No independent penetration test, formal security certification, or comprehensive SAST/DAST assessment has been completed.
- No dedicated Git-history secret scan has been completed.
- The real Razorpay path has not been fully validated against a live Razorpay sandbox in the documented environment; test-gateway results are not proof of live integration correctness.
- Real deployment, multi-instance scaling, and full end-to-end clinical/payment flows require separate verification.
- Presence tracking and some rate-limit counters are held in process memory, which is not sufficient by itself for consistent multi-instance operation.
- Uploaded-file backup and recovery need operational configuration; database backups alone do not back up local uploaded files.
- The project status documents record dependency advisories that require a dedicated upgrade and regression pass. Re-check current advisories rather than treating that historical snapshot as a live vulnerability report.

This list is not exhaustive. Consult [`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md) for the maintained risk register.

## Production and compliance statements

Do not treat MediCore HMS as HIPAA-compliant, PCI-DSS-certified, independently audited, or production-hardened for real patient or payment data unless the relevant legal, operational, technical, and independent validation requirements have actually been met. This repository does not claim those certifications.

Before any production launch, conduct a security review, dependency and secret scanning, appropriate penetration testing, deployment hardening, backup/restore testing, incident-response planning, and a review of applicable privacy, healthcare, and payment obligations.

## Supported versions

The project does not currently maintain a formal versioned release/support policy. Security fixes are generally developed on `main`; no specific response SLA or support window is promised. See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) for release status.
