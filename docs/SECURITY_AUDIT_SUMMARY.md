# MediCore HMS — Security Audit Summary

Scope: authentication, authorization, input handling, transport/headers,
secrets, and the realtime layer. This is a code-review audit (no live
penetration test was run — no live deployment exists to test against in this
environment).

## Fixed in this phase

| Area | Finding | Fix |
|---|---|---|
| Reverse-proxy trust | `app.set("trust proxy", ...)` was never called. Behind any real load balancer (Render, Nginx), `req.ip` resolves to the proxy's IP for every request, silently collapsing per-client rate limiting into one shared bucket and making IP-based audit logging meaningless. | Added `TRUST_PROXY` env-driven config (`config/env.js`), wired into `app.set("trust proxy", ...)` in `app.js`. Defaults to `1` in production, `0` in development. |
| Production config drift | `CORS_ORIGIN`, all three `RAZORPAY_*` secrets, and `JWT_SECRET` strength were never enforced at boot — a production deploy could silently run with a localhost CORS origin or a missing payment secret until something broke at request time. | `config/env.js` now fails fast at boot in production if `CORS_ORIGIN`/`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` are unset, or `JWT_SECRET` is under 32 characters. |
| Headers | `helmet()` was used with fully default settings, which are tuned for apps that serve HTML/JS to a browser. This is a pure JSON API. | Explicit CSP (`default-src 'none'`) and `crossOriginResourcePolicy: cross-origin` (kept cross-origin, not same-site, because the SPA frontend legitimately calls this API cross-origin under existing CORS+credentials config — see Deployment Guide). |
| Realtime input validation | Every `socket.on(...)` handler destructured its payload with zero validation (`{ room }`, `{ recipientId, appointmentId }`, etc.) — a missing/malformed field threw a `TypeError` mid-handler. This was also the root cause of the backend-stability bug (see Production Readiness Report) but is a security-relevant input-validation gap in its own right: a client could reliably crash/degrade the shared realtime layer for every connected user with one malformed emit. | All handlers in `socket/eventHandlers.js` now validate required fields before use and are wrapped so a bad payload can never do more than fail that one request (see `socket/asyncSocketHandler.js`). |
| Silent failure swallowing | Several `catch (_) {}` / `catch (err) { /* comment only */ }` blocks across `appointmentController.js`, `paymentController.js`, `refundController.js`, `financeController.js`, and two review controllers discarded errors with zero logging — including one on the auto-refund-request path (a financial workflow). | All now log via `logger`/`transactionLogger` with enough context to investigate. See Production Readiness Report for the full list. |
| Query correctness | `publicController.js`'s specialty-browse aggregation had a duplicate `$ne` object key (`{ $ne: null, $ne: "" }`), which JavaScript silently resolves to only the last key — so doctors with an unset specialization were leaking into the public specialty list. Not an authorization bug, but a data-integrity/correctness issue found via the lint pass this phase added for the backend. | Replaced with `{ $nin: [null, ""] }`. |
| Backend lint coverage | The whole `backend/` directory was excluded from `eslint` (`ignores: ["backend", ...]`) — meaning none of the above `no-unused-vars`/`no-empty`/`no-dupe-keys` classes of bug were ever caught automatically. | Extended `eslint.config.js` with a Node/ESM-scoped block for `backend/**/*.js`. Backend is now linted in CI. |

## Reviewed and already solid (no change needed)

- **Auth**: JWT verification and role-based access control middleware
  (`middleware/authMiddleware.js`) are properly wrapped in `asyncHandler` and
  correctly forward errors — no gaps found here in this pass.
- **Input sanitization**: `app.js`'s `sanitizeRequest` middleware strips any
  key starting with `$` or containing `.` from `req.body`/`req.params`,
  closing the standard NoSQL-injection vector for Mongo query operators.
- **Rate limiting**: tiered limiters already existed (global API limiter,
  a stricter one for `/api/auth`, a relaxed one for `/api/realtime` polling).
  Only the trust-proxy gap above undermined their effectiveness.
- **File uploads**: prior phases already added magic-number validation
  (`utils/fileValidation.js`) rather than trusting client-supplied MIME
  types/extensions.
- **Payment webhook**: `razorpayWebhookHandler` is mounted before the JSON
  body parser with `express.raw()`, which is required for correct HMAC
  signature verification — this was already correct.
- **Secrets in logs**: spot-checked `logger`/`transactionLogger` call sites
  touched in this phase — none log raw secrets, tokens, or full card/bank
  details.

## Deferred / not addressed in this phase (see Remaining Risks)

- No live penetration test, dependency CVE scan (`npm audit` output was not
  reviewed as part of this pass), or secrets-in-git-history scan was run.
- No Web Application Firewall / DDoS-layer guidance — out of scope without a
  chosen hosting target.
- Encryption-at-rest depends entirely on the MongoDB deployment target
  (e.g. Atlas encrypts at rest by default; a self-hosted `mongo:7` container
  as in `docker-compose.yml` does not, out of the box).
