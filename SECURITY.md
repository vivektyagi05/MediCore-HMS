# Security Policy

MediCore HMS is a healthcare-domain project under active development (see
`docs/PROJECT_STATUS.md`). It is not currently operating as a deployed
production service processing real patient data. This document explains
how to report a security issue and what security posture actually exists
today — see `docs/REMAINING_RISKS.md` for a fuller, honest list of open
gaps.

## Reporting a vulnerability

If you find a security issue in this repository:

1. **Do not open a public GitHub issue for it.** Public issues are
   searchable and would disclose the problem before it can be fixed.
2. Report it privately to the maintainer (see the repository's GitHub
   profile / commit history for current contact details).
3. Include: what you found, the affected file(s)/endpoint(s), how to
   reproduce it, and its potential impact.
4. Please allow time for a fix before any public disclosure.

There is currently no formal bug-bounty program and no dedicated security
team — this is a solo/small-scale project. Reports are still welcome and
will be taken seriously.

## Do not report or publish sensitive data

Because this is a healthcare-domain project:

- Never include real patient information, real credentials, or real
  payment details in an issue, pull request, commit, or vulnerability
  report. Use synthetic/example data only.
- If you discover real sensitive data accidentally committed to the
  repository (a leaked `.env`, a real API key, etc.), report it privately
  first rather than opening a public issue that points to it.

## What is actually in place today

- Passwords are hashed with `bcrypt`; sessions use JWTs (`jsonwebtoken`).
- Role-based access control (admin / doctor / patient) is enforced in
  backend middleware (`backend/middleware/`), not just hidden in the UI.
- `helmet` and `express-rate-limit` are applied at the Express app level;
  see `backend/app.js`.
- Financial writes (payments, refunds, wallet, payouts) go through
  explicit state machines with server-side gateway verification — see
  `docs/FINANCIAL_ARCHITECTURE.md` — rather than trusting client-reported
  outcomes.
- Environment configuration is validated at boot (`backend/config/env.js`);
  the app refuses to start in production without the required secrets set.

## What is explicitly not in place / known limitations

See `docs/REMAINING_RISKS.md` for the current, maintained list. As of this
writing that includes (non-exhaustive): no independent penetration test or
SAST/DAST scan has been run; no git-history secret scan has been run; no
formal security certification (SOC 2, HIPAA compliance audit, PCI-DSS,
etc.) has been obtained or claimed; the realtime layer's presence-tracking
and rate limiting are in-process only and not yet safe for multiple backend
instances; and dependency upgrades for two known high-severity advisories
(Vite, react-router-dom) are still pending a dedicated regression pass.

Do not treat this project as HIPAA-compliant, PCI-DSS-compliant, or
production-hardened for real patient or payment data without independently
verifying these gaps have been closed.

## Supported versions

This project does not yet follow a versioned release/support model (see
`docs/PROJECT_STATUS.md`). Security fixes are applied to the `main` branch.
