# Documentation index

This directory separates current developer guidance from historical records. Current documents are intended to describe the repository as supplied; historical documents retain point-in-time context and may contain claims that are no longer current.

## Start here

1. [Architecture](ARCHITECTURE.md) — major components and their boundaries.
2. [System Design](SYSTEM_DESIGN.md) — request and data-flow descriptions.
3. [Features](FEATURES.md) — feature areas and evidence limits.
4. [Project Status](PROJECT_STATUS.md) — what can and cannot be concluded from the supplied repository.
5. [Remaining Risks](REMAINING_RISKS.md) — known gaps and checks still required.
6. [Deployment Guide](DEPLOYMENT_GUIDE.md) — repository-defined local/container deployment guidance.
7. [Testing and Release Gates](TESTING-AND-RELEASE-GATES.md) and [Test Matrix](TEST_MATRIX.md) — commands, scenarios, and verification boundaries.

## Domain references

- [Financial Architecture](FINANCIAL_ARCHITECTURE.md)
- [Financial Accounting Contract](FINANCIAL-ACCOUNTING-CONTRACT.md)
- [Payment Business Logic](PAYMENT-BUSINESS-LOGIC-SPEC.md)
- [Scheduler Architecture](SCHEDULER-ARCHITECTURE.md)
- [Engineering Decisions](ENGINEERING_DECISIONS.md)
- [Financial Implementation Map](FINANCIAL-IMPLEMENTATION-MAP.md)
- [Security Audit Summary](SECURITY_AUDIT_SUMMARY.md)

## Testing scenarios

Scenario descriptions are under [`testing/scenarios/`](testing/scenarios). A scenario document is a plan or description, not proof that the scenario has been executed.

## Historical records

`history/changelogs/`, `history/phases/`, `history/audits/`, and `history/remediation/` preserve dated or phase-specific reports. Treat test counts, completion statements, dependency findings, and deployment claims in these files as historical unless their exact commit, date, command, and environment are confirmed.

## Evidence language

Use these labels consistently:

- **Documented and source reference found** — the named file or symbol was located; behavior is not thereby proven.
- **Partially documented** — only part of the workflow or its boundaries are described.
- **Historical claim** — a past report records the claim; it is not a current result.
- **Unverified** — available evidence is insufficient to decide.
- **Requires runtime verification** — a live service, browser, database, gateway, CI runner, or deployment is needed.
