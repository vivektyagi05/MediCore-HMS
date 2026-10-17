# Phase 2-C — Admin Platform

See `docs/PHASE-2C-ADMIN-REPORT.md` for the full report.

## Summary

Real, targeted admin-platform audit and fix pass. Baseline (97/97 tests, 0 eslint, clean
build/boot) re-verified before any change. 5 real defects found and fixed, all with either
new regression tests or direct code-review verification.

## Fixed

1. **Doctor approval concurrency race** — `approveDoctor` used check-then-act
   (`findById` → mutate → `.save()`); two concurrent approvals could both succeed and
   double every side effect (email/notification/automation trigger/history). Now an
   atomic `findOneAndUpdate({_id, verificationStatus:"pending"})` transition.
2. **Doctor rejection + approve-vs-reject race** — same root cause, same fix. DB state and
   its triggered side effects can no longer disagree.
3. **Super Admin promotion was completely broken** — `updateAdminRole`'s rank check
   compared the actor against the *requested* role instead of only the target's *current*
   role, so even a super_admin could never grant super_admin (100 ≤ 100 always failed).
   The Admin Hierarchy UI visibly offers this option with no other way to create a
   super_admin outside the one-time seed bootstrap. Fixed with an explicit
   "only super_admin grants super_admin" rule + added a missing self-role-change guard.
4. **CSV export formula injection + unbounded export queries** — leading `=`/`+`/`-`/`@`
   in exported names/emails was never neutralized (classic Excel formula injection); all
   four export datasets had no row cap. Fixed both; truncation now disclosed via response
   header instead of silently returned as a partial file.
5. **Withdrawal admin transition concurrency race** — same check-then-act pattern as #1,
   on a financial mutation (`markWithdrawalProcessing`/`completeWithdrawal`/etc). Same
   atomic-transition fix.

Plus a defense-in-depth fix: Mongoose `VersionError` now translates to a clean `409`
instead of falling through to a raw-internals `500`.

## Tests

- New: `backend/tests/doctorApprovalConcurrencyRace.test.mjs` (4 tests)
- Updated: 2 stale source-inspection assertions in `doctorApprovalWorkflow.test.mjs`
- Final: **98/98** passing (was 97/97 baseline)

## Verification

- ESLint: 0/0
- Frontend build: clean
- Boot check: ECONNREFUSED-only (no live Mongo in sandbox)
- Fresh-extract gate: passed
