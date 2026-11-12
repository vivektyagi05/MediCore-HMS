# Project Status

> **Status: rebuilt during the documentation audit from the repository snapshot.** This page separates what the code contains from what has been verified. **Nothing was run** (no tests, lint, build, server or seeder), so there is no claim that the system works, passes tests, or is production-ready. The previous status page (which cited 90/94 backend tests, "no frontend test suite" and P23 as the latest phase) is out of date.

## Snapshot size (file counts)
| Area | Count |
|---|---|
| Backend controllers / models / route files / service files | 60 / 56 / 52 / 60 |
| Mounted API registrations (static extraction) | 568 ([API routes](references/api-routes.md)) |
| Database migrations (numbered) | 13 |
| Frontend pages (`.jsx`) / components / API client modules | 110 / 124 / 32 |
| Backend top-level test files / Mongo-backed test files / frontend vitest files | 221 / 5 / 21 |

Counts are files, not test cases; see the [testing guide](testing/testing-guide.md).

## Implemented (code present, not runtime-verified)
All areas in the [feature matrix](FEATURES.md): public discovery and CMS, auth with email verification, appointment booking and payment, wallet, refunds, invoices, doctor and patient workspaces, extensive admin tooling, Socket.IO realtime, AI assistance (Gemini or template provider), master data (LGD import), privacy/consent, multi-language UI. Operational structure: separate **release**, **web** and **worker** roles with an in-process scheduler using lease/fencing locks ([scheduler](SCHEDULER-ARCHITECTURE.md), [deployment](deployment/deployment-guide.md)). A dedicated load-test dataset tool exists ([load testing](testing/load-testing.md)); it is separate from the bootstrap `backend/seed.js`.

## Partially implemented / limited
- Insurance (UI and model present; depth not audited).
- Realtime and rate limiting are single-instance designs ([R-01](REMAINING_RISKS.md)).
- No load-test *runner* exists; only the dataset generator.

## Remaining
See [Remaining risks](REMAINING_RISKS.md): AI free-text privacy, incomplete `.env.example`, frontend tests outside CI, unexplained wheel files, live-integration verification.

## Unverified in this audit
Test, lint and build outcomes; CI history; Razorpay, Brevo, Gemini and storage behaviour; any deployment; the data-volume totals in the load-test plan; dependency advisories.

## Historical achievements
Phase-by-phase records are preserved, unrewritten, under [history](history/) (changelogs, phase reports, engineering reports) and [audits](audits/historical-audits/). Their completion claims describe the state at their dates and are not evidence of the current state.
