# Changelog

This file is the entry point to MediCore HMS history. The project was built in many phase-by-phase passes, and each pass has its own detailed changelog under [`docs/history/changelogs/`](docs/history/changelogs/) (88 files). This file does not restate them, and the historical files are preserved as written — their claims describe the state at their date, not the current state. For the current verified position use [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) and [`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md).

## Most recent recorded work
The latest dated changelogs in the repository (dates as written inside the files) are the financial-foundation phases:

- [Phase 00 — Foundation](docs/history/changelogs/CHANGELOG-PHASE-00-FOUNDATION.md) (2026-10-13)
- [Phase 01 — Payment core](docs/history/changelogs/CHANGELOG-PHASE-01-PAYMENT-CORE.md) (2026-10-13 to 2026-10-14)
- [Phase 02 — Wallet and split payment](docs/history/changelogs/CHANGELOG-PHASE-02-WALLET-SPLIT-PAYMENT.md) (undated)
- [Phase 03 — Financial operations hub](docs/history/changelogs/CHANGELOG-PHASE-03-FINANCIAL-OPERATIONS-HUB.md) (2026-10-17)

They follow the earlier P23 financial-correctness work: [Fake-success elimination](docs/history/changelogs/CHANGELOG-P23-FAKE-SUCCESS-ELIMINATION.md), [Concurrency hardening](docs/history/changelogs/CHANGELOG-P23-CONCURRENCY-HARDENING.md), [Continuation](docs/history/changelogs/CHANGELOG-P23-CONTINUATION.md), [Payment/Refund 3.0](docs/history/changelogs/CHANGELOG-PHASE-P23-PAYMENT-REFUND-3.0.md), and the [financial hardening slices](docs/history/changelogs/CHANGELOG-FINANCIAL-HARDENING-SLICE1.md) ([slice 2](docs/history/changelogs/CHANGELOG-FINANCIAL-HARDENING-SLICE2.md)). Ordering beyond the dates above was not established from file contents.

## Earlier phases
Public discovery and SEO, authentication, booking, the clinical workspace, doctor practice management, patient relationship tooling, admin operations, workflow automation and governance, and others. The complete list is indexed in [`docs/README.md`](docs/README.md#history).

## Documentation changes
The documentation was audited and reorganised against the repository snapshot; see [`docs/audits/DOCUMENTATION_AUDIT_REPORT.md`](docs/audits/DOCUMENTATION_AUDIT_REPORT.md). Reports that previously sat in the repository root now live under `docs/history/` and `docs/audits/historical-audits/` with unchanged filenames.
