// ─────────────────────────────────────────────────────────────────────────
// Presence staleness — single source of truth for every reader of
// OnlineSession "online" counts (Mission Control, Executive Dashboard,
// Platform Overview, the Live Sessions widget, /realtime/presence, and
// Smart Assignment's workload map).
//
// ROOT CAUSE this fixes: presenceManager.js only flips a session to
// "offline" when that exact socket fires a "disconnect" event on the
// SAME server process that created it. A server restart (routine during
// development/testing) wipes the in-memory activeUsers map and kills every
// socket without ever running that handler, so every OnlineSession
// document that was "online" at the moment of restart is orphaned in that
// status forever — nothing ever corrects it. Across many dev-server
// restarts against a small seed dataset (e.g. 2 doctors, 2 patients) this
// accumulates into exactly the kind of inflated count reported (100
// "online" doctors against 2 real doctor accounts): each restart leaves
// one more stale document behind for the same handful of real users.
//
// Two-part fix:
//   1. reconcileOnBoot() (presenceManager.js) — on every server start,
//      flip every OnlineSession still marked "online" to "offline". The
//      in-memory activeUsers map is empty at that point, so ANY such
//      document is definitionally stale — its socket cannot exist in this
//      process. This clears out whatever has already accumulated.
//   2. onlineFilter() below — a read-time staleness window as defense in
//      depth for the case a socket dies mid-runtime without a clean
//      disconnect (network drop, killed tab, sleeping laptop) instead of
//      via a full server restart.
// ─────────────────────────────────────────────────────────────────────────

// The frontend heartbeat (src/context/RealtimeContext.jsx) pings
// "presence:ping" every 30 seconds for as long as a socket is connected.
// Allow for two missed beats before treating a session as stale rather
// than currently online.
export const PRESENCE_STALE_MS = 90_000;

function staleCutoff() {
  return new Date(Date.now() - PRESENCE_STALE_MS);
}

// The one true "currently online" Mongo filter. Every count/find of
// online presence must use this instead of a bare { status: "online" }
// match.
export function onlineFilter(extra = {}) {
  return { ...extra, status: "online", lastActiveAt: { $gte: staleCutoff() } };
}

// Same rule, applied to an already-fetched document (used where a query
// needs every session for a user regardless of status, e.g. Smart
// Assignment's workload map, and only needs the online/offline verdict
// afterward).
export function isSessionOnline(session) {
  if (!session || session.status !== "online" || !session.lastActiveAt) return false;
  return new Date(session.lastActiveAt) >= staleCutoff();
}
