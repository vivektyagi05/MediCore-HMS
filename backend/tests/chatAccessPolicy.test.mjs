// The ONE chat policy: pure matrix, batch resolver parity, socket room join
// (REST/socket agreement), attachment-name hardening.
import assert from "node:assert/strict";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import User from "../models/User.js";
import {
  evaluateChatAccess, resolveChatAccess, resolveChatAccessBatch, summarizeChatRelationship,
} from "../services/clinicalAccessService.js";
import { roomManager } from "../socket/roomManager.js";
import { sanitizeAttachmentName, validateChatAttachment } from "../services/chat/chatAttachmentService.js";
import { PNG } from "./helpers/chatHelpersShim.mjs";

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`); } catch (e) { failures += 1; console.error(`  FAIL ${name}`); console.error(e); }
}
console.log("chatAccessPolicy.test.mjs");

const DAY = 86_400_000;
const now = Date.now();
const ev = (appointments, o = {}) => evaluateChatAccess({ summary: summarizeChatRelationship(appointments), doctorEligible: true, requesterIsDoctor: false, now, windowDays: 30, ...o });
const appt = (status, daysAgo = 0) => ({ status, date: new Date(now - daysAgo * DAY) });

await test("matrix: pending / cancelled / payment-less pairings never grant ANY access", () => {
  for (const status of ["pending", "cancelled"]) {
    const r = ev([appt(status)]);
    assert.deepEqual([r.status, r.canRead, r.canSend], ["none", false, false], status);
  }
  assert.equal(ev([]).status, "none");
  assert.equal(ev([appt("pending"), appt("cancelled")]).canRead, false);
});

await test("matrix: active statuses => active; completed inside window => active; outside => read_only with reason", () => {
  for (const status of ["approved", "payment_pending", "payment_completed", "consultation_started", "consultation_completed"]) {
    assert.equal(ev([appt(status, 400)]).status, "active", status);
  }
  assert.equal(ev([appt("completed", 29)]).status, "active");
  assert.equal(ev([appt("review_eligible", 29)]).canSend, true);
  const expired = ev([appt("completed", 31)]);
  assert.deepEqual([expired.status, expired.canRead, expired.canSend, expired.readOnlyReason], ["read_only", true, false, "COMMUNICATION_WINDOW_EXPIRED"]);
  assert.equal(ev([appt("completed", 400), appt("cancelled", 1)]).status, "read_only", "a later cancelled appointment does not reopen chat");
  assert.equal(ev([appt("completed", 400), appt("approved", 0)]).status, "active", "a new active appointment reopens it");
});

await test("matrix: doctor eligibility — doctor loses everything, patient keeps read-only history", () => {
  const doctorSide = ev([appt("approved")], { doctorEligible: false, requesterIsDoctor: true });
  assert.deepEqual([doctorSide.canRead, doctorSide.canSend], [false, false]);
  const patientSide = ev([appt("approved")], { doctorEligible: false, requesterIsDoctor: false });
  assert.deepEqual([patientSide.canRead, patientSide.canSend, patientSide.readOnlyReason], [true, false, "DOCTOR_NOT_ELIGIBLE"]);
});

const D = { _id: "64b000000000000000000001", role: "doctor", isActive: true };
const P = { _id: "64b000000000000000000002", role: "patient", isActive: true };
const P2 = { _id: "64b000000000000000000003", role: "patient", isActive: true };
const approvedDoctor = { _id: "d-1", userId: D._id, verificationStatus: "approved", isVerified: true, isActive: true };
const chain = (rows) => { const c = { select: () => c, sort: () => c, limit: () => c, lean: async () => rows }; return c; };

await test("resolveChatAccess + resolveChatAccessBatch agree for every counterpart (list can never disagree with the per-request decision)", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => approvedDoctor }) });
  Doctor.find = () => ({ select: () => ({ lean: async () => [approvedDoctor] }) });
  const rows = [{ status: "completed", date: new Date(now - 90 * DAY), patientId: P._id, doctorId: "d-1" }];
  Appointment.find = () => chain(rows);
  const single = await resolveChatAccess(D, P);
  const batch = await resolveChatAccessBatch(D, [P, P2, { ...P2, _id: "x" }]);
  assert.deepEqual(batch.get(P._id), single);
  assert.equal(single.status, "read_only");
  assert.equal(batch.get(P2._id).status, "none");
  // patient side batch
  const patientBatch = await resolveChatAccessBatch(P, [D]);
  assert.equal(patientBatch.get(D._id).status, "read_only");
  assert.equal((await resolveChatAccess(P, D)).status, "read_only");
});

await test("batch resolver issues a constant number of queries regardless of page size (no N+1)", async () => {
  let doctorQueries = 0; let apptQueries = 0;
  Doctor.findOne = () => { doctorQueries += 1; return { select: () => ({ lean: async () => approvedDoctor }) }; };
  Appointment.find = () => { apptQueries += 1; return chain([]); };
  const many = Array.from({ length: 40 }, (_, i) => ({ _id: `64b0000000000000000001${String(i).padStart(2, "0")}`, role: "patient", isActive: true }));
  await resolveChatAccessBatch(D, many);
  assert.deepEqual([doctorQueries, apptQueries], [1, 1]);
});

await test("admin<->user support conversation is allowed; admin never obtains a doctor<->patient pair", async () => {
  const admin = { _id: "a1", role: "super_admin", isActive: true };
  assert.equal((await resolveChatAccess(admin, P)).canSend, true);
  assert.equal((await resolveChatAccess(D, admin)).canSend, true);
  assert.equal((await resolveChatAccess(admin, { ...P, isActive: false })).canRead, false);
});

await test("only the three runtime roles are accepted as chat participants", async () => {
  for (const role of ["admin", "receptionist", "staff", "moderator", "support"]) {
    assert.equal((await resolveChatAccess({ _id: "z1", role, isActive: true }, P)).canRead, false, role);
  }
});

// ── socket room join follows READ policy; key format is strict ───────────
const withUsers = (map) => { User.findById = (id) => ({ select: () => ({ lean: async () => map[String(id)] || null }) }); };
const keyOf = (a, b) => [a, b].sort().join(":");

await test("room join: strict key parsing; non-participant, forged, non-canonical, extra segments and non-hex all refused", async () => {
  withUsers({ [P._id]: P, [D._id]: D, [P2._id]: P2 });
  Doctor.findOne = () => ({ select: () => ({ lean: async () => approvedDoctor }) });
  Appointment.find = () => chain([{ status: "approved", date: new Date(), patientId: P._id }]);
  const ok = `chat:${keyOf(P._id, D._id)}`;
  assert.equal(await roomManager.canJoinRoom(P, ok), true);
  assert.equal(await roomManager.canJoinRoom(D, ok), true);
  assert.equal(await roomManager.canJoinRoom(P2, ok), false, "knowing the string is not enough");
  for (const bad of [`chat:${P._id}:${D._id}`, `chat:${P._id}:${D._id}:${P2._id}`, `chat:${P._id}`, `chat:${P._id}:zzzz`, "chat:", "chat:../../x", `chat:${P._id}:${P._id}`, `chat:${keyOf(P._id, D._id)}\n`]) {
    assert.equal(await roomManager.canJoinRoom(P, bad), false, bad);
  }
  assert.equal(await roomManager.canJoinRoom(P, `chat:${keyOf(P._id, P2._id)}`), false, "patient<->patient never");
});

await test("room join agrees with REST history: read-only thread joinable, no-relationship not", async () => {
  withUsers({ [P._id]: P, [D._id]: D });
  Doctor.findOne = () => ({ select: () => ({ lean: async () => approvedDoctor }) });
  const room = `chat:${keyOf(P._id, D._id)}`;
  Appointment.find = () => chain([{ status: "completed", date: new Date(now - 200 * DAY) }]);
  assert.equal(await roomManager.canJoinRoom(P, room), true, "read-only: REST can read => socket can join");
  Appointment.find = () => chain([{ status: "cancelled", date: new Date() }]);
  assert.equal(await roomManager.canJoinRoom(P, room), false);
});

// ── attachment name hardening ────────────────────────────────────────────
await test("attachment names: traversal, control chars, separators, length are neutralised; storage keys never derive from them", () => {
  assert.equal(sanitizeAttachmentName("../../../etc/passwd.png", "image/png"), "passwd.png");
  assert.equal(sanitizeAttachmentName("..\\..\\win\\x.png", "image/png"), "x.png");
  assert.equal(sanitizeAttachmentName("a\u0000b\u202e.png", "image/png").includes("\u0000"), false);
  assert.equal(sanitizeAttachmentName("", "application/pdf"), "attachment.pdf");
  assert.equal(sanitizeAttachmentName("x".repeat(500) + ".png", "image/png").length <= 120, true);
  const meta = validateChatAttachment({ originalName: "../../x/scan.PNG", declaredMimeType: "image/png", buffer: PNG });
  assert.equal(meta.fileName, "scan.PNG");
  assert.equal(meta.kind, "image");
});

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("chatAccessPolicy: all passed");
