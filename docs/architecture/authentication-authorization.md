# Authentication and Authorization

> **Status: derived from `backend/middleware/`, `backend/constants/roles.js`, `backend/app.js` and `backend/socket/socketAuth.js`. Nothing was executed.** For the per-route guard inventory see [API routes](../references/api-routes.md) (static extraction, not exhaustive).

## Roles
`backend/constants/roles.js` defines three roles: `super_admin`, `doctor`, `patient`. **There is no separate `admin` role** (a code comment warns against introducing one); "admin" in older documents and the UI means a `super_admin` user, possibly with restricted permissions.

## Authentication
- Clients send `Authorization: Bearer <JWT>`; the token is **not** stored in cookies (`protect` rejects requests without a `Bearer` header).
- `backend/middleware/authMiddleware.js` (`protect`) validates signature and expiry, that the user is active, and the user's `securityVersion`. A `securityVersion` bump invalidates existing sessions; the realtime layer emits `auth:invalidated` to connected clients.
- `JWT_SECRET` must be at least 32 characters in production; lifetime is `JWT_EXPIRES_IN`. Optional authentication is available for public routes that personalise output.
- Email verification and password reset use Brevo-delivered messages (`backend/services/emailVerificationService.js`, `emailService.js`).

## Authorization layers
1. **Role guard** — `authorizeRoles(ROLES.X, …)` (`roleMiddleware.js`).
2. **Permission guard** — `requirePermission("key")` (`adminMiddleware.js`) looks up the `Permission` model for the user's role; used on admin routes.
3. **Doctor access guards** — `doctorAccessMiddleware.js` (approved-doctor checks).
4. **Ownership** — enforced inside controllers/services (for example a patient reading only their own appointment). Route files do not show this, so the route table cannot prove it.

## HTTP hardening in `app.js`
`helmet`, configured CORS (`CORS_ORIGIN`), and `express-rate-limit` limiters: a general API limiter (`RATE_LIMIT_*`), a public limiter (`PUBLIC_RATE_LIMIT_*`), an auth limiter (20 per window), a forgot-password IP limiter (60), and a realtime polling limiter (120). Liveness and readiness probes are excluded from rate limiting. Behind a proxy set `TRUST_PROXY`.

## Realtime authentication
`backend/socket/socketAuth.js` authenticates the Socket.IO handshake with the same JWT rules; see [realtime architecture](realtime-architecture.md).

## Not verified
Rate-limit thresholds under real traffic, token revocation timing, and per-endpoint ownership checks were not tested. Security-control claims in historical audits are summarised in [security overview](../security/security-overview.md).
