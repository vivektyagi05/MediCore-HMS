# Changelog — Phase 1 Engineering Report / Re-verification Pass

Date: 2026-09-15

## Summary

Independent re-verification pass over the `MediCore-HMS-PRODUCTION-HARDENED-2026-09-15`
extract. Did not trust the existing `PRODUCTION-READINESS-MASTER-AUDIT-2026-09-15.md`
claims — re-traced code, re-ran the real test suite, re-ran lint/build, and boot-tested
in a simulated production configuration. Found and fixed two real defects the prior
audit had missed, plus one log-hygiene issue.

## Fixed

- **Stale test masking a real fix**: `backend/tests/p15ProviderFailureContract.test.mjs`
  asserted a literal error-code string that no longer matched the (already-correct,
  already-improved) provider-failure taxonomy in `passwordRecoveryController.js`.
  Rewrote the assertions to verify the real taxonomy instead of weakening or deleting
  the test.
- **Real duplicate index**: `backend/models/OnlineSession.js` declared both
  `lastActiveAt: { index: true }` and `.index({ lastActiveAt: -1 })` on the same field.
  Removed the redundant field-level declaration.
- **Log hygiene**: `dotenv@17` prints non-JSON "tip" lines on every `config()` call,
  breaking structured-log parsing on every boot. Added `quiet: true` to both
  `dotenv.config()` calls in `backend/config/env.js`.

## Added

- `docs/PHASE-1-ENGINEERING-REPORT.md` — evidence-based report (root cause /
  implementation / test / result / production verification) for every defect found in
  this pass, plus a re-verification record for all twelve historical failures named in
  the assignment brief.

## Verification

- `node backend/tests/run-all.mjs` → 94/94 passing (0 failing, up from 1 failing before
  this pass's fix)
- `npx eslint .` → 0 errors
- `npm run build` → clean
- Simulated production boot (`NODE_ENV=production` + well-formed placeholder
  credentials, no live services in this sandbox) → passes all env validation, fails only
  on `ECONNREFUSED` to the placeholder MongoDB URI, clean structured JSON logs, correct
  bounded shutdown on `SIGTERM`
- Missing-required-env-var boot → throws immediately naming every missing variable

## Not done in this pass (disclosed, not fabricated)

- No live MongoDB/Brevo/Razorpay/OpenAI credentials in this sandbox — see
  `docs/PHASE-1-ENGINEERING-REPORT.md` "Explicitly NOT verified" for the full list.
- Did not re-run the full ~20-domain per-route classification matrix from Part A of the
  brief as a standalone artifact; targeted the concrete historical-failure list instead,
  which is where the real defects were actually found.
