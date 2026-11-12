> **Historical record.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# Frontend hardening pass (2026-10-17)

Scope: the user-reported admin reason-box bug, then a systematic UI / validation / edge-case audit. Verified by 67 new frontend
tests (`npm run test:frontend`, vitest + jsdom + Testing Library, added in this pass), 7 new backend suites, ESLint 0, production build 0.
Backend: 206/206. **No real browser, MongoDB or Razorpay was available**: nothing here is browser-verified.

**Coverage statement (honest).** The project has 231 JSX files / ~47k lines. I did NOT read every line. I ranked all files with static
analysis (AST + pattern scans over every file) and read in full the ones with the highest risk or money/consent impact. Pages I did not
read line by line are listed under "Not audited".

## 1. The reported bug: reason box exits after one word
Root cause (`components/ui/Modal.jsx`): its effect depended on `onClose`, which callers pass inline, so every keystroke re-rendered the
parent, re-ran the effect and moved focus to the close button. Affected EVERY modal with a text field: refund approve/reject reason,
capture-case reason, outbox requeue, coupon form, admin forms. Fix: latest `onClose` kept in a ref, effect keyed on `isOpen` only, focus
moves once on open (first form field), Tab trap queries the DOM at event time.
Proof: `Modal.test.jsx` and `RefundActionDialog.test.jsx` reproduce the exact failure against the original effect (5 of 7 dialog tests
fail there) and pass with the fix.

## 2. Other bugs fixed (each with a test unless noted)
| Area | Problem | Fix |
|---|---|---|
| Admin Settings | autosaved every keystroke with no validation: clearing "Tax rate" saved **0%**, bad emails/timezones saved, opening the page wrote an audit "update", refunds could be switched off with one click, leaving within 700 ms lost the edit | validated autosave (client + server rules, parity-tested), no-op saves suppressed, flush on leave, confirm before turning refunds off, server returns field errors |
| Buttons | `variant="ghost"` (6 uses) is not defined, so Cancel/Back rendered as blue primary buttons | `ghost` variant added |
| Money inputs | each field parsed differently (`Number()` accepts `1e3`, `""`→0, NaN); no caps | one strict parser `utils/moneyInput.js` used in wallet recharge, withdrawal, refund request, wallet use at checkout; recharge modal also resets on reopen, blocks double click and close-while-busy |
| Window prompts | `window.prompt` for settlement reference / failure reason (no validation, cancel looked like success); `window.confirm` x7 | shared `ReasonDialog` (min/max, counter, inline server error, keeps text, double-submit guard) and `useConfirm` hook |
| Withdrawals admin | no pagination controls | added |
| Auth (server) | `{"name":5}` crashed with 500; an 8-item array passed the password check; no max length; 8 spaces accepted | type + length checks (name <=100, email <=120, password 8-128, not whitespace-only), login rejects operator objects; Register/Reset mirror |
| Patient vitals | model allowed height 0, diastolic > systolic; UI had no limits | plausible-range validation server + client, inline errors |
| Family / insurance / claims | age 3.5 or 0-only, expired policies, claim NaN/negative/over remaining coverage, **duplicate claim on double click or while one is in progress**, stale file name after save, no file type/size check | server + client validation, 409 for claim in progress, shared upload validator (8 MB / 5 MB, pdf/png/jpg) also on records, doctor documents and booking uploads |
| Forms | native `required/min/step` blocked submit with a browser tooltip so inline messages never showed | `noValidate` on family/insurance/claim forms |
| Doctor schedule | clearing "duration" snapped back to 30 (could not retype); no end>start / break checks in UI; server had no numeric ranges; `blockedDates` non-array crashed with 500 | clearable fields, per-day errors, save blocked with a named day; slot engine range checks (5-240/0-120/0-20); blockedDates validated |
| Doctor fees/experience/year | admin check `Number(x) < 0` lets `"abc"` and `""` pass | strict validator (experience 0-70, fee 0-100000 2dp, year 1940..now) server + client |
| Out-of-order responses | filter changes could be overwritten by a slower earlier response (payments, refunds, withdrawals, discrepancy report) | `useLatestRequest` guard |
| Article HTML | rendered unsanitised on public pages | DOMPurify wrapper (`utils/safeHtml.js`), external links get `rel=noopener` |
| API layer | 15 s timeout for uploads/reports; a wrong-password 401 logged the user out; silent logout on expiry | 90 s for FormData and the report; auth endpoints excluded; one-time "session ended" note on login |
| App shell | **no error boundary** (any render error = white screen; stale chunk after deploy = white screen); unknown URLs silently redirected home | `AppErrorBoundary` (try again / reload / home; one guarded auto-reload on stale chunk) and a real 404 page |
| Accessibility | 77 icon-only buttons and ~90 native controls without an accessible name | labelled (icon-derived / placeholder-derived, reviewed by hand); 16 unguarded `.map` on API data made safe |

## 3. Not audited / still open (reason, next action)
- **Every other page was not read line by line.** Highest remaining suspects by static score: `AdminAutomationStudio`, `AdminProcessDesigner`, `DoctorClinicalWorkspace`, `PrescriptionEditor`, `AdminMonitoringPlatform`, `BookAppointment` (1k+ lines). Next action: same method (AST scan, then read) page by page.
- **No real browser run**: responsive layout, visual regressions, keyboard flow and screen-reader output are unverified. Next action: Playwright against a seeded environment.
- New UI strings (validation messages, session note, dialogs) are English-only; the app has `hi` translations for existing keys.
- Hand-rolled drawers/panels outside `Modal` (e.g. clinical copilot, notification panels) were not audited for focus handling.
- ReasonDialog is used in the new finance/withdrawal/review flows; older reason UIs (capture cases, wallet reservation, refund dialog) keep their own forms (they now work, via the Modal fix) but were not unified.
- Server-side validation was added where the UI work exposed gaps (settings, auth, vitals, family/insurance/claims, schedule ranges, doctor numbers). Other endpoints were not re-audited in this pass.
