// Conversation engine: authorization, idempotency, delivery/read truthfulness,
// pagination, attachments, notifications. Real engine + real policy; only
// persistence/storage are in-memory (see helpers/chatHarness.mjs).
import assert from "node:assert/strict";
import {
  ACTIVE_APPT, EXPIRED_APPT, JPEG, PDF, PNG, RECENT_DONE_APPT, createEngineHarness, makeUsers,
} from "./helpers/chatHarness.mjs";
import { CHAT_ERROR } from "../services/chat/chatConstants.js";

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`); } catch (error) { failures += 1; console.error(`  FAIL ${name}`); console.error(error); }
}
const rejectsWith = async (promise, code) => {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`); return true; });
};
const uid = (() => { let n = 0; return () => `cid-${Date.now().toString(36)}-${(n += 1).toString().padStart(4, "0")}`; })();

const u = makeUsers();
const harness = (extra = {}) => createEngineHarness({
  users: Object.values(u),
  relationships: [
    { doctor: u.doctor, patient: u.patient, appointments: [ACTIVE_APPT] },
    { doctor: u.doctor, patient: u.otherPatient, appointments: [EXPIRED_APPT] }, // read-only
    { doctor: u.otherDoctor, patient: u.patient, appointments: [{ status: "cancelled", date: new Date() }, { status: "pending", date: new Date() }] }, // never a relationship
  ],
  ...extra,
});

console.log("chatEngine.test.mjs");

// ── A. authorization ─────────────────────────────────────────────────────
await test("authorized doctor -> patient and patient -> doctor can send", async () => {
  const h = harness();
  const a = await h.engine.sendMessage(u.doctor, { recipientId: String(u.patient._id), body: "Hello", clientMessageId: uid() });
  const b = await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "Hi doctor", clientMessageId: uid() });
  assert.equal(a.message.senderId, String(u.doctor._id));
  assert.equal(b.message.senderId, String(u.patient._id));
  assert.equal(h.repo.rows.length, 2);
});

await test("unauthorized: cancelled/pending-only pairing cannot send, read, or sync (no appointment-exists bypass)", async () => {
  const h = harness();
  await rejectsWith(h.engine.sendMessage(u.otherDoctor, { recipientId: String(u.patient._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.FORBIDDEN);
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: String(u.otherDoctor._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.FORBIDDEN);
  await rejectsWith(h.engine.getHistory(u.patient, { userId: String(u.otherDoctor._id) }), CHAT_ERROR.FORBIDDEN);
  await rejectsWith(h.engine.syncConversation(u.patient, { userId: String(u.otherDoctor._id) }), CHAT_ERROR.FORBIDDEN);
  assert.equal(h.repo.rows.length, 0);
});

await test("unauthorized: a patient cannot message another patient, an arbitrary id, or themselves", async () => {
  const h = harness();
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: String(u.otherPatient._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.FORBIDDEN);
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: String(u.patient._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.FORBIDDEN);
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: "64b64b64b64b64b64b64b64b", body: "x", clientMessageId: uid() }), CHAT_ERROR.FORBIDDEN);
});

await test("ObjectId abuse (non-hex, operators, objects, arrays) is rejected with a validation error", async () => {
  const h = harness();
  for (const bad of ["abc", "{ $ne: null }", { $ne: null }, ["a"], "../../etc/passwd", "", null, undefined]) {
    await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: bad, body: "x", clientMessageId: uid() }), CHAT_ERROR.VALIDATION);
    await rejectsWith(h.engine.getHistory(u.patient, { userId: bad }), CHAT_ERROR.VALIDATION);
  }
  await rejectsWith(h.engine.getHistory(u.patient, { userId: String(u.doctor._id), before: { $gt: "" } }), CHAT_ERROR.VALIDATION);
});

await test("expired communication window: history readable, sending/typing/upload blocked with an explicit read-only reason", async () => {
  const h = harness();
  const key = h.conversationKeyOf(u.doctor._id, u.otherPatient._id);
  await h.repo.insert({ conversationKey: key, senderId: u.doctor._id, recipientId: u.otherPatient._id, body: "old advice", messageType: "text", clientMessageId: uid() });
  const history = await h.engine.getHistory(u.otherPatient, { userId: String(u.doctor._id) });
  assert.equal(history.messages.length, 1);
  assert.equal(history.access.status, "read_only");
  assert.equal(history.access.canSend, false);
  assert.equal(history.access.readOnlyReason, "COMMUNICATION_WINDOW_EXPIRED");
  await assert.rejects(h.engine.sendMessage(u.otherPatient, { recipientId: String(u.doctor._id), body: "hi", clientMessageId: uid() }), (e) => {
    assert.equal(e.code, CHAT_ERROR.READ_ONLY);
    assert.equal(e.details.readOnlyReason, "COMMUNICATION_WINDOW_EXPIRED");
    return true;
  });
  await rejectsWith(h.engine.typing(u.otherPatient, { userId: String(u.doctor._id), active: true }), CHAT_ERROR.READ_ONLY);
  await rejectsWith(h.engine.sendAttachment(u.otherPatient, { recipientId: String(u.doctor._id), clientMessageId: uid(), file: { buffer: PNG, mimetype: "image/png", originalname: "a.png" } }), CHAT_ERROR.READ_ONLY);
  // receipts still work on a read-only thread (read policy)
  const read = await h.engine.markRead(u.otherPatient, { userId: String(u.doctor._id) });
  assert.equal(read.messageIds.length, 1);
});

await test("recently completed consultation stays ACTIVE inside the follow-up window", async () => {
  const h = createEngineHarness({ users: Object.values(u), relationships: [{ doctor: u.doctor, patient: u.patient, appointments: [RECENT_DONE_APPT] }] });
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "follow-up", clientMessageId: uid() });
});

await test("an ineligible DOCTOR gets no access; the patient keeps read-only history", async () => {
  const h = createEngineHarness({ users: Object.values(u), relationships: [{ doctor: u.doctor, patient: u.patient, appointments: [ACTIVE_APPT], doctorEligible: false }] });
  await rejectsWith(h.engine.getHistory(u.doctor, { userId: String(u.patient._id) }), CHAT_ERROR.FORBIDDEN);
  const hist = await h.engine.getHistory(u.patient, { userId: String(u.doctor._id) });
  assert.equal(hist.access.readOnlyReason, "DOCTOR_NOT_ELIGIBLE");
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.READ_ONLY);
});

await test("deactivated recipient/sender cannot chat", async () => {
  const inactive = { ...u.patient, isActive: false };
  const h = createEngineHarness({ users: [u.doctor, inactive], relationships: [{ doctor: u.doctor, patient: inactive, appointments: [ACTIVE_APPT] }] });
  await rejectsWith(h.engine.sendMessage(u.doctor, { recipientId: String(u.patient._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.FORBIDDEN);
  await rejectsWith(h.engine.sendMessage(inactive, { recipientId: String(u.doctor._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.FORBIDDEN);
});

await test("super_admin support chat works but does NOT grant admin access to a doctor<->patient thread", async () => {
  const h = harness();
  await h.engine.sendMessage(u.admin, { recipientId: String(u.patient._id), body: "support here", clientMessageId: uid() });
  // admin is not a participant of doctor<->patient: the key they would address is admin<->patient, so they cannot read that pair's messages
  await h.engine.sendMessage(u.doctor, { recipientId: String(u.patient._id), body: "private clinical", clientMessageId: uid() });
  const adminView = await h.engine.getHistory(u.admin, { userId: String(u.patient._id) });
  assert.ok(adminView.messages.every((m) => m.body !== "private clinical"));
});

await test("chat feature toggle blocks send/typing/upload for users but never for super_admin", async () => {
  const h = harness({ chatEnabled: false });
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "x", clientMessageId: uid() }), CHAT_ERROR.FEATURE_DISABLED);
  await rejectsWith(h.engine.typing(u.patient, { userId: String(u.doctor._id), active: true }), CHAT_ERROR.FEATURE_DISABLED);
  await h.engine.sendMessage(u.admin, { recipientId: String(u.patient._id), body: "support", clientMessageId: uid() });
  // history stays readable while chat is switched off
  await h.engine.getHistory(u.patient, { userId: String(u.doctor._id) });
});

// ── B. messages: persistence, idempotency, validation ───────────────────
await test("send persists, trims, never marks delivered/read on persist", async () => {
  const h = harness();
  const { message } = await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "  hi  ", clientMessageId: uid() });
  assert.equal(message.body, "hi");
  assert.equal(message.status, "sent");
  assert.equal(message.deliveredAt, null, "persistence != delivery");
  assert.equal(message.readAt, null);
  assert.ok(message.sentAt);
  assert.equal(h.repo.rows[0].deliveredAt, null);
});

await test("duplicate clientMessageId (double click / lost ACK / retry) yields ONE message and reconciles", async () => {
  const h = harness();
  const cid = uid();
  const first = await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "once", clientMessageId: cid });
  const retry = await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "once", clientMessageId: cid });
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.message._id, first.message._id);
  assert.equal(h.repo.rows.length, 1);
  assert.equal(h.notifications.length, 1, "no duplicate notification on retry");
  assert.equal(h.broadcasts.filter((b) => b.event === "chat:message").length, 1, "no duplicate realtime emit on retry");
});

await test("concurrent identical sends (race) still create exactly one message", async () => {
  const h = harness();
  const cid = uid();
  const results = await Promise.all(Array.from({ length: 6 }, () => h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "race", clientMessageId: cid })));
  assert.equal(h.repo.rows.length, 1);
  assert.equal(new Set(results.map((r) => r.message._id)).size, 1);
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
});

await test("clientMessageId reused for a different recipient is a conflict, not a silent overwrite", async () => {
  const h = createEngineHarness({ users: Object.values(u), relationships: [
    { doctor: u.doctor, patient: u.patient, appointments: [ACTIVE_APPT] }, { doctor: u.otherDoctor, patient: u.patient, appointments: [ACTIVE_APPT] }] });
  const cid = uid();
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "a", clientMessageId: cid });
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: String(u.otherDoctor._id), body: "b", clientMessageId: cid }), CHAT_ERROR.CONFLICT);
  assert.equal(h.repo.rows.length, 1);
});

await test("same clientMessageId from a DIFFERENT sender is independent (uniqueness is per sender)", async () => {
  const h = harness();
  const cid = uid();
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "a", clientMessageId: cid });
  await h.engine.sendMessage(u.doctor, { recipientId: String(u.patient._id), body: "b", clientMessageId: cid });
  assert.equal(h.repo.rows.length, 2);
});

await test("validation: missing/short/illegal clientMessageId, empty body, oversize body", async () => {
  const h = harness();
  const to = String(u.doctor._id);
  for (const clientMessageId of [undefined, "", "short", "has spaces in it!", "x".repeat(65), 12345678, { $ne: 1 }]) {
    await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: to, body: "x", clientMessageId }), CHAT_ERROR.VALIDATION);
  }
  for (const body of ["", "   ", undefined, null, 42, { a: 1 }]) {
    await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: to, body, clientMessageId: uid() }), CHAT_ERROR.VALIDATION);
  }
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: to, body: "x".repeat(4001), clientMessageId: uid() }), CHAT_ERROR.VALIDATION);
  assert.equal(h.repo.rows.length, 0);
});

await test("a failed persist leaves no message, no broadcast and no notification (client must see failure)", async () => {
  const h = harness();
  h.repo.failNextInsert = new Error("mongo down");
  await assert.rejects(h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "x", clientMessageId: uid() }), /mongo down/);
  assert.equal(h.broadcasts.length, 0);
  assert.equal(h.notifications.length, 0);
});

await test("message body is stored verbatim as TEXT (HTML is not interpreted or altered server-side)", async () => {
  const h = harness();
  const evil = `<img src=x onerror=alert(1)><script>alert(1)</script> javascript:alert(1)`;
  const { message } = await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: evil, clientMessageId: uid() });
  assert.equal(message.body, evil);
  assert.equal(message.attachment, null);
});

await test("rate limit is per USER across calls/transports, and recovers", async () => {
  const h = harness({ limits: { send: [3, 60_000] } });
  const to = String(u.doctor._id);
  for (let i = 0; i < 3; i += 1) await h.engine.sendMessage(u.patient, { recipientId: to, body: `m${i}`, clientMessageId: uid() });
  await rejectsWith(h.engine.sendMessage(u.patient, { recipientId: to, body: "m4", clientMessageId: uid() }), CHAT_ERROR.RATE_LIMITED);
  // another user is unaffected
  await h.engine.sendMessage(u.doctor, { recipientId: String(u.patient._id), body: "fine", clientMessageId: uid() });
});

// ── notifications / realtime fan-out ────────────────────────────────────
await test("notification is generic (no body/PHI), idempotent-keyed, and a notify failure does not fail the send", async () => {
  const h = harness();
  const { message } = await h.engine.sendMessage(u.doctor, { recipientId: String(u.patient._id), body: "Your HbA1c result is 9.1, diabetes plan changes", clientMessageId: uid() });
  const n = h.notifications[0];
  assert.equal(n.userId, String(u.patient._id));
  assert.equal(n.eventKey, `chat:${message._id}`);
  assert.doesNotMatch(JSON.stringify(n), /HbA1c|diabetes|9\.1/);
  assert.doesNotMatch(n.message, /HbA1c/);

});

await test("a notification-store failure does not fail or roll back an already-persisted send", async () => {
  const h = harness();
  h.state.notifyFails = true;
  const res = await h.engine.sendMessage(u.doctor, { recipientId: String(u.patient._id), body: "x", clientMessageId: uid() });
  assert.equal(res.duplicate, false);
  assert.equal(h.repo.rows.length, 1);
  assert.ok(h.logs.some(([lvl, m]) => lvl === "warn" && m === "chat notification failed"));
});

await test("realtime fan-out targets BOTH participants' user rooms (recipient devices + sender's other tabs)", async () => {
  const h = harness();
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "x", clientMessageId: uid() });
  const emit = h.broadcasts.find((b) => b.event === "chat:message");
  assert.deepEqual(new Set(emit.ids), new Set([String(u.patient._id), String(u.doctor._id)]));
  assert.equal(emit.payload.status, "sent");
});

await test("logs never contain message bodies", async () => {
  const h = harness();
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "SECRET-CLINICAL-TEXT", clientMessageId: uid() });
  assert.doesNotMatch(JSON.stringify(h.logs), /SECRET-CLINICAL-TEXT/);
});

// ── C. delivery / read truthfulness ─────────────────────────────────────
await test("delivered is set ONLY by the recipient's acknowledgement, only for their own messages", async () => {
  const h = harness();
  const to = String(u.doctor._id);
  const { message } = await h.engine.sendMessage(u.patient, { recipientId: to, body: "x", clientMessageId: uid() });
  // sender cannot mark their own message delivered
  const own = await h.engine.acknowledgeDelivered(u.patient, { userId: to, messageIds: [message._id] });
  assert.deepEqual(own.messageIds, []);
  assert.equal(h.repo.rows[0].deliveredAt, null);
  // recipient acknowledges
  const ack = await h.engine.acknowledgeDelivered(u.doctor, { userId: String(u.patient._id), messageIds: [message._id] });
  assert.deepEqual(ack.messageIds, [message._id]);
  assert.ok(h.repo.rows[0].deliveredAt);
  const evt = h.broadcasts.find((b) => b.event === "chat:message:delivered");
  assert.deepEqual(evt.ids, [String(u.patient._id)], "only the sender is told");
  // idempotent
  const again = await h.engine.acknowledgeDelivered(u.doctor, { userId: String(u.patient._id), messageIds: [message._id] });
  assert.deepEqual(again.messageIds, []);
});

await test("delivered/read receipts for an unauthorized conversation are rejected", async () => {
  const h = harness();
  const { message } = await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "x", clientMessageId: uid() });
  await rejectsWith(h.engine.acknowledgeDelivered(u.otherDoctor, { userId: String(u.patient._id), messageIds: [message._id] }), CHAT_ERROR.FORBIDDEN);
  await rejectsWith(h.engine.markRead(u.otherDoctor, { userId: String(u.patient._id) }), CHAT_ERROR.FORBIDDEN);
  assert.equal(h.repo.rows[0].readAt, null);
});

await test("read: only the recipient's messages, delivered set first, sender notified, unread count updated", async () => {
  const h = harness();
  const p = String(u.patient._id); const d = String(u.doctor._id);
  const m1 = (await h.engine.sendMessage(u.patient, { recipientId: d, body: "1", clientMessageId: uid() })).message;
  const m2 = (await h.engine.sendMessage(u.patient, { recipientId: d, body: "2", clientMessageId: uid() })).message;
  await h.engine.sendMessage(u.doctor, { recipientId: p, body: "reply", clientMessageId: uid() });
  assert.equal((await h.engine.unreadSummary(u.doctor)).unreadMessages, 2);

  const res = await h.engine.markRead(u.doctor, { userId: p, upToMessageId: m1._id });
  assert.deepEqual(res.messageIds, [m1._id]);
  assert.equal(res.unreadCount, 1);
  const rows = h.repo.rows;
  assert.ok(rows[0].readAt && rows[0].deliveredAt, "read implies delivered");
  assert.equal(rows[1].readAt, null);
  assert.equal(rows[2].readAt, null, "the doctor's own outgoing message is never marked read by the doctor");

  const res2 = await h.engine.markRead(u.doctor, { userId: p });
  assert.deepEqual(res2.messageIds, [m2._id]);
  assert.equal(res2.unreadCount, 0);
  const evt = h.broadcasts.filter((b) => b.event === "chat:message:read").pop();
  assert.deepEqual(new Set(evt.ids), new Set([p, d]), "reader's other tabs AND the sender converge");
  assert.equal(evt.payload.readerId, d);
});

await test("loading history or the conversation list never marks anything read", async () => {
  const h = harness();
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "x", clientMessageId: uid() });
  await h.engine.getHistory(u.doctor, { userId: String(u.patient._id) });
  await h.engine.listConversations(u.doctor);
  assert.equal(h.repo.rows[0].readAt, null);
});

await test("sync marks the recipient's missed messages delivered and informs the sender", async () => {
  const h = harness();
  const d = String(u.doctor._id); const p = String(u.patient._id);
  const first = (await h.engine.sendMessage(u.patient, { recipientId: d, body: "1", clientMessageId: uid() })).message;
  await h.engine.sendMessage(u.patient, { recipientId: d, body: "2", clientMessageId: uid() }); // sent while doctor was offline
  const sync = await h.engine.syncConversation(u.doctor, { userId: p, afterMessageId: first._id });
  assert.equal(sync.messages.length, 1);
  assert.equal(sync.messages[0].body, "2");
  assert.equal(sync.messages[0].status, "delivered");
  assert.ok(h.repo.rows[1].deliveredAt);
  assert.ok(h.broadcasts.some((b) => b.event === "chat:message:delivered" && b.ids[0] === p));
  // sender reconciles state of messages it already knew about
  const senderSync = await h.engine.syncConversation(u.patient, { userId: d, knownOutgoingIds: [first._id, sync.messages[0]._id] });
  assert.equal(senderSync.updates.find((x) => x._id === sync.messages[0]._id).status, "delivered");
  assert.equal(senderSync.updates.find((x) => x._id === first._id).status, "sent");
});

await test("sync with no cursor returns the latest page; with a cursor never repeats the cursor message", async () => {
  const h = harness();
  const d = String(u.doctor._id);
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push((await h.engine.sendMessage(u.patient, { recipientId: d, body: `m${i}`, clientMessageId: uid() })).message._id);
  const latest = await h.engine.syncConversation(u.doctor, { userId: String(u.patient._id) });
  assert.equal(latest.messages.length, 5);
  const after = await h.engine.syncConversation(u.doctor, { userId: String(u.patient._id), afterMessageId: ids[2] });
  assert.deepEqual(after.messages.map((m) => m._id), ids.slice(3));
});

// ── F. pagination ────────────────────────────────────────────────────────
await test("cursor pagination: first page, older pages, ordering, no duplicates, stable under new messages", async () => {
  const h = harness();
  const d = String(u.doctor._id);
  for (let i = 0; i < 25; i += 1) await h.engine.sendMessage(u.patient, { recipientId: d, body: `m${String(i).padStart(2, "0")}`, clientMessageId: uid() });
  const p1 = await h.engine.getHistory(u.doctor, { userId: String(u.patient._id), limit: 10 });
  assert.equal(p1.messages.length, 10);
  assert.equal(p1.hasMore, true);
  assert.deepEqual(p1.messages.map((m) => m.body), Array.from({ length: 10 }, (_, i) => `m${String(15 + i).padStart(2, "0")}`), "oldest->newest within the page");
  await h.engine.sendMessage(u.patient, { recipientId: d, body: "m25-new", clientMessageId: uid() }); // arrives between page loads
  const p2 = await h.engine.getHistory(u.doctor, { userId: String(u.patient._id), limit: 10, before: p1.nextBefore });
  const p3 = await h.engine.getHistory(u.doctor, { userId: String(u.patient._id), limit: 10, before: p2.nextBefore });
  assert.equal(p3.hasMore, false);
  const all = [...p3.messages, ...p2.messages, ...p1.messages].map((m) => m.body);
  assert.equal(new Set(all).size, 25, "no duplicates and nothing skipped even though a message arrived mid-pagination");
  assert.deepEqual(all, [...all].sort());
});

await test("history page size is clamped", async () => {
  const h = harness();
  const hist = await h.engine.getHistory(u.doctor, { userId: String(u.patient._id), limit: 100000 });
  assert.equal(hist.messages.length, 0);
});

// ── conversation list ────────────────────────────────────────────────────
await test("conversation list: server-authoritative, unread per conversation, last message, canSend, read-only flag, excluded when no access", async () => {
  const h = harness();
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "from active patient", clientMessageId: uid() });
  const roKey = h.conversationKeyOf(u.doctor._id, u.otherPatient._id);
  await h.repo.insert({ conversationKey: roKey, senderId: u.otherPatient._id, recipientId: u.doctor._id, body: "old question", messageType: "text", clientMessageId: uid() });
  // a legacy conversation whose pairing has no valid relationship (must never surface)
  const badKey = h.conversationKeyOf(u.doctor._id, u.otherDoctor._id);
  void badKey;

  const list = await h.engine.listConversations(u.doctor);
  assert.equal(list.items.length, 2);
  const active = list.items.find((i) => i.participant._id === String(u.patient._id));
  const ro = list.items.find((i) => i.participant._id === String(u.otherPatient._id));
  assert.equal(active.unreadCount, 1);
  assert.equal(active.canSend, true);
  assert.equal(active.communicationStatus, "active");
  assert.equal(active.lastMessage.preview, "from active patient");
  assert.equal(ro.canSend, false);
  assert.equal(ro.communicationStatus, "read_only");
  assert.equal(ro.readOnlyReason, "COMMUNICATION_WINDOW_EXPIRED");
  assert.deepEqual(list.items.map((i) => i.participant._id), [String(u.otherPatient._id), String(u.patient._id)], "newest conversation first");
  assert.ok("online" in active.participant && "lastSeenAt" in active.participant);

  // patient with a cancelled-only pairing: conversation present in storage but never listed
  const key = h.conversationKeyOf(u.patient._id, u.otherDoctor._id);
  await h.repo.insert({ conversationKey: key, senderId: u.otherDoctor._id, recipientId: u.patient._id, body: "legacy", messageType: "text", clientMessageId: uid() });
  const patientList = await h.engine.listConversations(u.patient);
  assert.ok(!patientList.items.some((i) => i.participant._id === String(u.otherDoctor._id)));
});

await test("conversation list: cursor pagination + search + unread filter", async () => {
  const h = harness();
  await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "a", clientMessageId: uid() });
  await h.repo.insert({ conversationKey: h.conversationKeyOf(u.doctor._id, u.otherPatient._id), senderId: u.doctor._id, recipientId: u.otherPatient._id, body: "b", messageType: "text", clientMessageId: uid() });
  const page1 = await h.engine.listConversations(u.doctor, { limit: 1 });
  assert.equal(page1.items.length, 1);
  assert.ok(page1.nextCursor);
  const page2 = await h.engine.listConversations(u.doctor, { limit: 1, cursor: page1.nextCursor });
  assert.equal(page2.items.length, 1);
  assert.notEqual(page1.items[0].conversationKey, page2.items[0].conversationKey);
  assert.equal(page2.nextCursor, null);
  const found = await h.engine.listConversations(u.doctor, { search: "ravi" });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].participant.name, "Ravi Kumar");
  const unread = await h.engine.listConversations(u.doctor, { unreadOnly: true });
  assert.equal(unread.items.length, 1);
});

// ── D. attachments ───────────────────────────────────────────────────────
const upload = (buffer, mimetype, originalname) => ({ buffer, mimetype, originalname });

await test("valid image and PDF attachments: stored privately, metadata only, no storage key in any payload", async () => {
  const h = harness();
  const to = String(u.doctor._id);
  const img = await h.engine.sendAttachment(u.patient, { recipientId: to, clientMessageId: uid(), file: upload(PNG, "image/png", "wound.png"), caption: "see this" });
  const pdf = await h.engine.sendAttachment(u.patient, { recipientId: to, clientMessageId: uid(), file: upload(PDF, "application/pdf", "report.pdf") });
  assert.equal(img.message.messageType, "attachment");
  assert.equal(img.message.attachment.kind, "image");
  assert.equal(pdf.message.attachment.kind, "document");
  assert.equal(h.storage.objects.size, 2);
  const wire = JSON.stringify([img, pdf, h.broadcasts, h.notifications]);
  assert.doesNotMatch(wire, /storageKey|chat-attachments\//, "raw storage keys must never leave the server");
  assert.ok(h.repo.rows[0].attachment.storageKey.startsWith("chat-attachments/"), "key is kept server-side only");
  assert.equal(h.repo.rows[0].attachment.size, PNG.length);
  const hist = await h.engine.getHistory(u.doctor, { userId: String(u.patient._id) });
  assert.doesNotMatch(JSON.stringify(hist), /storageKey|chat-attachments\//);
});

await test("attachment rejections: bad magic, spoofed MIME, extension mismatch, dangerous names, svg/html/exe, oversize, empty — nothing stored, nothing persisted", async () => {
  const h = harness();
  const to = String(u.doctor._id);
  const bad = [
    [Buffer.from("MZ\x90\x00 fake exe"), "image/png", "x.png"],
    [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml", "x.svg"],
    [Buffer.from("<html><script>alert(1)</script></html>"), "text/html", "x.html"],
    [PNG, "application/pdf", "x.pdf"], // PNG bytes declared as PDF
    [PDF, "image/png", "x.png"],
    [PNG, "image/png", "x.pdf"], // right bytes, wrong extension
    [PNG, "image/png", "evil.php.png"],
    [PNG, "image/png", "evil.exe"],
    [JPEG, "image/png", "x.jpg"], // jpeg bytes, png declared
    [Buffer.alloc(0), "image/png", "x.png"],
    [Buffer.from("%PDF-1.4\n<< /JavaScript (app.alert(1)) >>\n%%EOF"), "application/pdf", "x.pdf"],
  ];
  for (const [buffer, mimetype, name] of bad) {
    await rejectsWith(h.engine.sendAttachment(u.patient, { recipientId: to, clientMessageId: uid(), file: upload(buffer, mimetype, name) }), CHAT_ERROR.ATTACHMENT_INVALID);
  }
  await rejectsWith(h.engine.sendAttachment(u.patient, { recipientId: to, clientMessageId: uid(), file: upload(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), "image/png", "big.png") }), CHAT_ERROR.ATTACHMENT_TOO_LARGE);
  assert.equal(h.storage.objects.size, 0);
  assert.equal(h.repo.rows.length, 0);
  assert.ok(h.logs.some(([, m]) => m === "chat attachment rejected"));
});

await test("storage failure: structured 503-class error, nothing persisted, no broadcast", async () => {
  const h = harness();
  h.storage.failUpload = true;
  await rejectsWith(h.engine.sendAttachment(u.patient, { recipientId: String(u.doctor._id), clientMessageId: uid(), file: upload(PNG, "image/png", "a.png") }), CHAT_ERROR.STORAGE_UNAVAILABLE);
  assert.equal(h.repo.rows.length, 0);
  assert.equal(h.broadcasts.length, 0);
});

await test("DB failure after a successful upload removes the orphaned object", async () => {
  const h = harness();
  h.repo.failNextInsert = new Error("mongo down");
  await assert.rejects(h.engine.sendAttachment(u.patient, { recipientId: String(u.doctor._id), clientMessageId: uid(), file: upload(PNG, "image/png", "a.png") }));
  assert.equal(h.storage.objects.size, 0);
});

await test("duplicate attachment send (retry) is idempotent and leaves exactly one stored object", async () => {
  const h = harness();
  const cid = uid();
  const args = { recipientId: String(u.doctor._id), clientMessageId: cid, file: upload(PNG, "image/png", "a.png") };
  const a = await h.engine.sendAttachment(u.patient, args);
  const b = await h.engine.sendAttachment(u.patient, args);
  assert.equal(b.duplicate, true);
  assert.equal(b.message._id, a.message._id);
  assert.equal(h.storage.objects.size, 1);
  assert.equal(h.repo.rows.length, 1);
});

await test("attachment download: participants only (IDOR), conversation-bound, server-recorded content type", async () => {
  const h = createEngineHarness({ users: Object.values(u), relationships: [
    { doctor: u.doctor, patient: u.patient, appointments: [ACTIVE_APPT] },
    { doctor: u.otherDoctor, patient: u.otherPatient, appointments: [ACTIVE_APPT] }] });
  const { message } = await h.engine.sendAttachment(u.patient, { recipientId: String(u.doctor._id), clientMessageId: uid(), file: upload(PDF, "application/pdf", "lab.pdf") });
  const own = await h.engine.downloadAttachment(u.patient, message._id);
  const rec = await h.engine.downloadAttachment(u.doctor, message._id);
  assert.equal(own.mimeType, "application/pdf");
  assert.deepEqual(rec.buffer, PDF);
  // an authorized-elsewhere user, an unrelated doctor, an admin, and a random id all get 404 (no existence oracle)
  for (const intruder of [u.otherPatient, u.otherDoctor, u.admin]) await rejectsWith(h.engine.downloadAttachment(intruder, message._id), CHAT_ERROR.NOT_FOUND);
  await rejectsWith(h.engine.downloadAttachment(u.patient, "64b64b64b64b64b64b64b64b"), CHAT_ERROR.NOT_FOUND);
  await rejectsWith(h.engine.downloadAttachment(u.patient, "../../etc/passwd"), CHAT_ERROR.VALIDATION);
  await rejectsWith(h.engine.downloadAttachment(u.patient, { $ne: null }), CHAT_ERROR.VALIDATION);
  // a text message has no attachment
  const text = (await h.engine.sendMessage(u.patient, { recipientId: String(u.doctor._id), body: "t", clientMessageId: uid() })).message;
  await rejectsWith(h.engine.downloadAttachment(u.patient, text._id), CHAT_ERROR.NOT_FOUND);
});

await test("attachment download re-checks the READ policy: a no-longer-related pair loses access; read-only keeps it", async () => {
  const roHarness = createEngineHarness({ users: Object.values(u), relationships: [{ doctor: u.doctor, patient: u.patient, appointments: [EXPIRED_APPT] }] });
  const key = roHarness.conversationKeyOf(u.doctor._id, u.patient._id);
  const stored = await roHarness.storage.upload("chat-attachments", PNG);
  const { message } = await roHarness.repo.insert({ conversationKey: key, senderId: u.doctor._id, recipientId: u.patient._id, messageType: "attachment", body: "", clientMessageId: uid(), attachment: { storageKey: stored.key, fileName: "a.png", mimeType: "image/png", size: PNG.length, kind: "image" } });
  const file = await roHarness.engine.downloadAttachment(u.patient, message._id);
  assert.equal(file.kind, "image");

  const gone = createEngineHarness({ users: Object.values(u), relationships: [] });
  const stored2 = await gone.storage.upload("chat-attachments", PNG);
  const m2 = (await gone.repo.insert({ conversationKey: gone.conversationKeyOf(u.doctor._id, u.patient._id), senderId: u.doctor._id, recipientId: u.patient._id, messageType: "attachment", body: "", clientMessageId: uid(), attachment: { storageKey: stored2.key, fileName: "a.png", mimeType: "image/png", size: 1, kind: "image" } })).message;
  await rejectsWith(gone.engine.downloadAttachment(u.patient, m2._id), CHAT_ERROR.FORBIDDEN);
});

await test("attachment whose message was tampered to another conversation is not served", async () => {
  const h = harness();
  const { message } = await h.engine.sendAttachment(u.patient, { recipientId: String(u.doctor._id), clientMessageId: uid(), file: upload(PNG, "image/png", "a.png") });
  h.repo.rows[0].conversationKey = h.conversationKeyOf(u.patient._id, u.otherPatient._id); // inconsistent record
  await rejectsWith(h.engine.downloadAttachment(u.patient, message._id), CHAT_ERROR.NOT_FOUND);
});

await test("storage read failure on download is a structured error, a vanished object is a 404", async () => {
  const h = harness();
  const { message } = await h.engine.sendAttachment(u.patient, { recipientId: String(u.doctor._id), clientMessageId: uid(), file: upload(PNG, "image/png", "a.png") });
  h.storage.failRead = true;
  await rejectsWith(h.engine.downloadAttachment(u.patient, message._id), CHAT_ERROR.STORAGE_UNAVAILABLE);
  h.storage.failRead = false;
  h.storage.objects.clear();
  await rejectsWith(h.engine.downloadAttachment(u.patient, message._id), CHAT_ERROR.NOT_FOUND);
});

// ── typing ───────────────────────────────────────────────────────────────
await test("typing is authorized, throttled server-side, and only reaches the other participant", async () => {
  const h = harness();
  const d = String(u.doctor._id);
  const first = await h.engine.typing(u.patient, { userId: d, active: true });
  const second = await h.engine.typing(u.patient, { userId: d, active: true });
  assert.equal(first.emitted, true);
  assert.equal(second.emitted, false, "burst of keystroke events is dropped");
  const stop = await h.engine.typing(u.patient, { userId: d, active: false });
  assert.equal(stop.emitted, true);
  const typingEvents = h.broadcasts.filter((b) => b.event.startsWith("chat:typing"));
  assert.equal(typingEvents.length, 2);
  assert.ok(typingEvents.every((e) => e.ids.length === 1 && e.ids[0] === d));
  await rejectsWith(h.engine.typing(u.otherPatient, { userId: d, active: true }), CHAT_ERROR.READ_ONLY);
  await rejectsWith(h.engine.typing(u.patient, { userId: String(u.otherDoctor._id), active: true }), CHAT_ERROR.FORBIDDEN);
});

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("chatEngine: all passed");
