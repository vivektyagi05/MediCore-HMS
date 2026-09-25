import assert from "node:assert/strict";
import fs from "node:fs";
import { presenceManager } from "../socket/presenceManager.js";

console.log("presencePrivacy.test.mjs");

// snapshotFor is role-gated; snapshot() itself is unchanged (used internally
// and by the admin-only REST/socket paths that call snapshotFor).
assert.deepEqual(presenceManager.snapshotFor({ role: "patient" }), [], "a patient must not see who else is online");
assert.deepEqual(presenceManager.snapshotFor({ role: "doctor" }), [], "a doctor must not see who else is online");
assert.deepEqual(presenceManager.snapshotFor(null), [], "no user => no presence");
assert.deepEqual(presenceManager.snapshotFor({ role: "super_admin" }), presenceManager.snapshot(), "an admin still gets the full snapshot");
console.log("PASS: presence snapshot is role-gated (only super_admin sees other users' online status)");

// The two places that used to leak the raw snapshot to every role.
const server = fs.readFileSync(new URL("../socket/socketServer.js", import.meta.url), "utf8");
assert.ok(server.includes("presenceManager.snapshotFor(socket.user)"), "socket:ready must use the role-gated snapshot");
assert.ok(!/onlineUsers:\s*presenceManager\.snapshot\(\)/.test(server), "socket:ready must not send the raw global snapshot");
console.log("PASS: socket:ready no longer broadcasts every online user id to every connecting client");

const rest = fs.readFileSync(new URL("../controllers/realtimeController.js", import.meta.url), "utf8");
assert.ok(rest.includes("presenceManager.snapshotFor(req.user)"), "GET /realtime/presence must use the role-gated snapshot");
assert.ok(!/onlineUsers:\s*presenceManager\.snapshot\(\)/.test(rest));
console.log("PASS: GET /realtime/presence no longer returns the raw global snapshot to non-admins");
