# Security Overview

> **Status: controls listed below were read in code; none was tested, and no penetration test or compliance assessment is claimed.** Historical findings: [security audit summary](../audits/historical-audits/SECURITY_AUDIT_SUMMARY.md) (not re-verified). Open items: [Remaining risks](../REMAINING_RISKS.md). Reporting: [SECURITY.md](../../SECURITY.md).

## Controls found in code
| Area | Control | Where |
|---|---|---|
| Sessions | Bearer JWT, expiry, active-user and `securityVersion` checks | `backend/middleware/authMiddleware.js` |
| Access control | Role guard, permission guard, doctor-access guard | `backend/middleware/` |
| Input | `$`/`.` key stripping on request bodies (NoSQL-operator injection) | `sanitizeRequest` in `backend/app.js` |
| Transport headers | `helmet`, CORS allow-list, `trust proxy` setting | `backend/app.js` |
| Abuse | Tiered `express-rate-limit` limiters (API, public, auth, forgot-password, realtime) | `backend/app.js` |
| Uploads | Content (magic-number) validation | `backend/utils/fileValidation.js` |
| Payments | Raw-body webhook route before JSON parsing; webhook de-duplication model `WebhookEvent` | `backend/app.js`, `backend/payments/` |
| Configuration | Production guards refuse weak or missing secrets, localhost URLs, test gateway | `backend/config/productionGuards.js`, `scripts/preflight.mjs` |
| Load-test tool | Multiple safety gates against touching non-test databases | [load testing](../testing/load-testing.md) |
| AI | PHI minimiser (free text not scrubbed) | [AI architecture](../AI-ARCHITECTURE.md) |

## Not claimed
PCI-DSS, SOC 2, HIPAA or DPDP compliance; encryption-at-rest or backup practices (infrastructure-level, not in the repository); effectiveness of the controls above under attack.
