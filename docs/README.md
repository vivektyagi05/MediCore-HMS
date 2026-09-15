# Documentation Index

This directory has grown across many development phases. If you're new to
the project, read the files under **Start Here** in order — everything
else is either deeper technical detail or historical record.

## Start Here

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the system is put together
  (frontend, backend, cross-cutting concerns) and why.
- [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) — how a request actually flows
  through the system, including the financial flows in more detail.
- [`FEATURES.md`](FEATURES.md) — current feature map by product area, each
  item marked Implemented / Partial / Planned.
- [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — current engineering focus,
  what's done, what isn't, and verification status.

## Financial System

- [`FINANCIAL_ARCHITECTURE.md`](FINANCIAL_ARCHITECTURE.md) — the canonical
  reference for how payments, wallet, refunds, payouts, withdrawals, and
  the ledger relate to each other.
- [`PHASE-P23-FINANCIAL-AUDIT.md`](PHASE-P23-FINANCIAL-AUDIT.md) — audit
  notes from the P23 financial-correctness phase.
- [`financial-engine-test-scenarios.md`](financial-engine-test-scenarios.md) —
  test-scenario notes for the financial engine.
- Root-level `CHANGELOG-P23-*.md` files (repo root, not in `docs/`) — the
  detailed record of the most recent financial-correctness work; see the
  repo-root `CHANGELOG.md` for a summary and reading order.

## Deployment

- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — local dev, Docker Compose,
  environment variables, backups, and CI.

## Security

- [`SECURITY_AUDIT_SUMMARY.md`](SECURITY_AUDIT_SUMMARY.md) — findings from
  the most recent internal security review pass.
- [`REMAINING_RISKS.md`](REMAINING_RISKS.md) — the current, maintained list
  of open risks and gaps (read this one — it's kept honest and current).
- Repo-root [`SECURITY.md`](../SECURITY.md) — how to report a
  vulnerability.

## Testing & Verification

- [`TEST_MATRIX.md`](TEST_MATRIX.md) — what's covered by automated tests.
- [`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md),
  [`PRODUCTION_READINESS_REPORT.md`](PRODUCTION_READINESS_REPORT.md),
  [`PERFORMANCE_AUDIT_SUMMARY.md`](PERFORMANCE_AUDIT_SUMMARY.md),
  [`AUDIT_REPORT.md`](AUDIT_REPORT.md) — point-in-time audit/verification
  reports from specific phases. Treat these as historical snapshots, not
  live status — for live status, use `PROJECT_STATUS.md` and
  `REMAINING_RISKS.md`.
- `*-test-scenarios.md` files (`doctor-workflow-test-scenarios.md`,
  `patient-workflow-test-scenarios.md`, `ai-automation-test-scenarios.md`,
  `realtime-test-scenarios.md`) — scenario notes per domain area.

## Historical Phases

The project was built in many small, named phases. Each has its own
changelog and sometimes its own architecture/verification note:

- `CHANGELOG-<phase-name>.md` and `CHANGELOG-PHASE-<code>-<name>.md` —
  one per phase, in the order the phase codes suggest (P1, P2, ... P23;
  DOC-01 onward for the doctor workspace track; UI-4 onward for the
  admin/UI track; A5.x/A6.x for the automation/process-governance track).
- `ARCHITECTURE-<phase>.md` / `VERIFICATION-<phase>.md` — deeper
  architecture or verification notes for a specific phase, where one was
  written (e.g. the A6.2.x monitoring/workflow-intelligence phases).
- Other phase-specific summaries: `DOCTOR_WORKSPACE_PHASE_SUMMARY.md`,
  `PATIENT_CARE_JOURNEY_PHASE_SUMMARY.md`, `ENGINEERING_DECISIONS.md`,
  `ENTERPRISE_READINESS_SCORE.md`, `ARCHITECTURE_REVIEW.md`,
  `SESSION_CHANGELOG.md`, `bug-fixes-report.md`, `integration-report.md`,
  `missing-connections-report.md`, `validation-report.md`,
  `final-package-checklist.md`, and the `P11-`/`P12-` prefixed QA/delivery
  notes.

These are preserved for historical context. **Do not treat a historical
file as current status** — if a historical file says a feature was
"planned" and it has since shipped, the up-to-date answer is in
`FEATURES.md` and `PROJECT_STATUS.md`, not in the old file (which is left
as-is, as a record of what was true when it was written).
