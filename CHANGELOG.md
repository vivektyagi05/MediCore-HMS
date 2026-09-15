# Changelog

This file is the human-facing entry point. MediCore HMS has been built in
many small, phase-by-phase passes, and each phase has its own detailed
changelog file (in `docs/`, or at the repo root for the most recent P23
sub-phases). This file summarizes where the project currently stands and
points to the detailed history — it does not restate every historical
entry.

## Current state (most recent work first)

The most recent engineering focus has been the **P23 financial-correctness
phase** — payments, refunds, wallet, payouts, and withdrawals. In
chronological order, most recent last:

- **P23 — Fake-Success Elimination** (`CHANGELOG-P23-FAKE-SUCCESS-ELIMINATION.md`,
  repo root): fixed a refund-request contract bug and a real "fake success"
  defect where a wallet recharge was credited on gateway *signature*
  verification alone rather than on an authoritative captured-payment
  check. Introduced a dedicated `WalletRecharge` lifecycle and state
  machine. Also fixed a misleading-analytics bug (pending/failed ledger
  rows being summed as completed) and three refund state-machine bypasses.
  See that file for exactly what was and wasn't verified.
- **P23 — Concurrency Hardening** (`CHANGELOG-P23-CONCURRENCY-HARDENING.md`,
  repo root): socket-layer stability and shutdown-safety fixes, dependency
  audit, and the introduction of `.github/workflows/ci.yml` groundwork.
- **P23 — Continuation** (`CHANGELOG-P23-CONTINUATION.md`, repo root) and
  **P23 — Payment/Refund 3.0** (`docs/CHANGELOG-PHASE-P23-PAYMENT-REFUND-3.0.md`):
  earlier P23 work building out the payment/refund/payout domain that the
  later two passes above hardened further.

For the full, current picture of what's implemented vs. still incomplete,
see `docs/PROJECT_STATUS.md` and `docs/REMAINING_RISKS.md` — those are kept
current; this changelog is a historical record and is not re-edited to
match later findings.

## Earlier phases

The project was built through dozens of earlier phases covering public-facing
discovery (doctor search, profiles, SEO), authentication, appointment
booking, the clinical workspace, doctor practice management, patient
relationship tooling, admin operations, process automation/governance, and
more. Each has its own changelog under `docs/`, generally named
`CHANGELOG-<phase-name>.md` or `CHANGELOG-PHASE-<code>-<name>.md`. See
`docs/README.md` for the documentation index, which groups these under
"Historical Phases."

Historical changelog files are preserved as-is and are not rewritten to
reflect current status — if a historical file says a feature was "planned"
or "architecture ready" at the time, and the feature is implemented today,
that update lives in `docs/FEATURES.md` and `docs/PROJECT_STATUS.md`, not
by editing the old entry.
