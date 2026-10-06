// REAL Socket.IO transport test: a real http + socket.io server, real
// socket.io-client connections, the real chatHandlers + conversation engine +
// access policy. Only persistence/storage are in-memory (no MongoDB in the
// sandbox) and auth is a test middleware that attaches the user.
import assert from "node:assert/strict";
import http from "node:http";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";
import { registerChatHandlers } from "../socket/chatHandlers.js";
import { roomManager } from "../socket/roomManager.js";
import { ACTIVE_APPT, EXPIRED_APPT, createEngineHarness, makeUsers } from "./helpers/chatHarness.mjs";

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`); } catch (e) { failures += 1; console.error(`  FAIL ${name}`); console.error(e); }
}
const uid = (() => { let n = 0; return () => `sock-${Date.now().toString(36)}-${(n += 1).toString().padStart(4, "0")}`; })();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (socket, event, ms = 2000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
  socket.once(event, (p) => { clearTimeout(t); resolve(p); });
});
const emit = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

const u = makeUsers();
let revalidateResult = null; // test control: simulate password reset / deactivation
const harnessState = { current: null };

// A fresh harness + server per scenario group keeps state isolated.
async function boot() {
  let io;
  const h = createEngineHarness({
    users: Object.values(u),
    relationships: [
      { doctor: u.doctor, patient: u.patient, appointments: [ACTIVE_APPT] },
      { doctor: u.doctor, patient: u.otherPatient, appointments: [EXPIRED_APPT] },
    ],
    broadcastSink: (ids, event, payload) => {
      let target = io;
      for (const id of new Set(ids)) target = target.to(roomManager.userRoom(id));
      target.emit(event, payload);
    },
  });
  const server = http.createServer();
  io = new Server(server, { cors: { origin: "*" } });
  const usersById = new Map(Object.values(u).map((x) => [String(x._id), x]));
  io.use((socket, next) => {
    const user = usersById.get(String(socket.handshake.auth?.userId));
    if (!user) return next(new Error("auth required"));
    socket.user = user;
    socket.tokenSecurityVersion = 0;
    next();
  });
  io.on("connection", async (socket) => {
    await socket.join(roomManager.userRoom(socket.user._id)); // mirrors defaultRoomsForUser
    registerChatHandlers(io, socket, { engine: h.engine, revalidate: async () => revalidateResult, sessionTtlMs: 0 });
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const client = async (user, opts = {}) => {
    const c = connect(url, { auth: { userId: String(user._id) }, transports: ["websocket"], reconnection: false, forceNew: true, ...opts });
    clients.push(c);
    await once(c, "connect");
    return c;
  };
  const close = async () => { clients.forEach((c) => c.close()); io.close(); await new Promise((r) => server.close(r)); };
  harnessState.current = h;
  return { h, client, close, io };
}

console.log("chatSocket.test.mjs");
const D = String(u.doctor._id); const P = String(u.patient._id);

await test("send over a real socket: ack, persisted truthfully (sent, not delivered), recipient AND sender's second tab receive it", async () => {
  const { h, client, close } = await boot();
  try {
    const patientTab1 = await client(u.patient); const patientTab2 = await client(u.patient); const doctor = await client(u.doctor);
    const toDoctor = once(doctor, "chat:message"); const toTab2 = once(patientTab2, "chat:message");
    const ack = await emit(patientTab1, "chat:send", { recipientId: D, body: "hello doctor", clientMessageId: uid() });
    assert.equal(ack.success, true);
    assert.equal(ack.message.status, "sent");
    assert.equal(ack.message.deliveredAt, null);
    assert.equal((await toDoctor)._id, ack.message._id);
    assert.equal((await toTab2)._id, ack.message._id);
    assert.equal(h.repo.rows.length, 1);
    assert.equal(h.repo.rows[0].deliveredAt, null, "socket emit != delivery");
  } finally { await close(); }
});

await test("sender identity comes from the socket, never the payload (spoofed senderId/role ignored)", async () => {
  const { h, client, close } = await boot();
  try {
    const patient = await client(u.patient);
    const ack = await emit(patient, "chat:send", { recipientId: D, body: "x", clientMessageId: uid(), senderId: D, role: "doctor", conversationKey: "evil" });
    assert.equal(ack.success, true);
    assert.equal(String(h.repo.rows[0].senderId), P);
    assert.notEqual(h.repo.rows[0].conversationKey, "evil");
  } finally { await close(); }
});

await test("replayed / retried chat:send with the same clientMessageId is idempotent over the wire", async () => {
  const { h, client, close } = await boot();
  try {
    const patient = await client(u.patient);
    const cid = uid();
    const a = await emit(patient, "chat:send", { recipientId: D, body: "once", clientMessageId: cid });
    const b = await emit(patient, "chat:send", { recipientId: D, body: "once", clientMessageId: cid });
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(a.message._id, b.message._id);
    assert.equal(h.repo.rows.length, 1);
  } finally { await close(); }
});

await test("arbitrary recipient / unauthorized pair / malformed ids get structured errors and persist nothing", async () => {
  const { h, client, close } = await boot();
  try {
    const patient = await client(u.patient);
    for (const recipientId of [String(u.otherPatient._id), String(u.otherDoctor._id), "64b64b64b64b64b64b64b64b", "nope", { $ne: 1 }, undefined]) {
      const ack = await emit(patient, "chat:send", { recipientId, body: "x", clientMessageId: uid() });
      assert.equal(ack.success, false);
      assert.ok(["CHAT_FORBIDDEN", "CHAT_VALIDATION"].includes(ack.error.code), ack.error.code);
    }
    assert.equal(h.repo.rows.length, 0);
    const garbage = await emit(patient, "chat:send", undefined);
    assert.equal(garbage.success, false);
    const ackless = patient.emit("chat:send", "not an object"); void ackless; // must not crash the server
    await wait(50);
    assert.ok(patient.connected);
  } finally { await close(); }
});

await test("read-only conversation: send is refused with the read-only reason, sync still works", async () => {
  const { h, client, close } = await boot();
  try {
    const OP = String(u.otherPatient._id);
    await h.repo.insert({ conversationKey: h.conversationKeyOf(u.doctor._id, u.otherPatient._id), senderId: u.doctor._id, recipientId: u.otherPatient._id, body: "old", messageType: "text", clientMessageId: uid() });
    const patient = await client(u.otherPatient);
    const ack = await emit(patient, "chat:send", { recipientId: D, body: "hi", clientMessageId: uid() });
    assert.equal(ack.success, false);
    assert.equal(ack.error.code, "CHAT_READ_ONLY");
    assert.equal(ack.error.readOnlyReason, "COMMUNICATION_WINDOW_EXPIRED");
    const sync = await emit(patient, "chat:sync", { userId: D });
    assert.equal(sync.success, true);
    assert.equal(sync.messages.length, 1);
    assert.equal(sync.access.canSend, false);
    void OP;
  } finally { await close(); }
});

await test("delivery + read receipts over the wire: sender sees delivered then read; both of the reader's tabs converge", async () => {
  const { h, client, close } = await boot();
  try {
    const patient = await client(u.patient); const doctorA = await client(u.doctor); const doctorB = await client(u.doctor);
    const sent = await emit(patient, "chat:send", { recipientId: D, body: "ping", clientMessageId: uid() });
    const id = sent.message._id;
    await once(doctorA, "chat:message");

    const deliveredAtPatient = once(patient, "chat:message:delivered");
    const dAck = await emit(doctorA, "chat:message:delivered", { userId: P, messageIds: [id] });
    assert.deepEqual(dAck.messageIds, [id]);
    const delivered = await deliveredAtPatient;
    assert.deepEqual(delivered.messageIds, [id]);
    assert.ok(h.repo.rows[0].deliveredAt && !h.repo.rows[0].readAt);

    const readAtPatient = once(patient, "chat:message:read"); const readAtTabB = once(doctorB, "chat:message:read");
    const rAck = await emit(doctorA, "chat:message:read", { userId: P });
    assert.equal(rAck.unreadCount, 0);
    assert.deepEqual((await readAtPatient).messageIds, [id]);
    assert.deepEqual((await readAtTabB).messageIds, [id], "multi-tab: the other doctor tab learns the messages were read");
    assert.ok(h.repo.rows[0].readAt);
  } finally { await close(); }
});

await test("an attacker cannot mark someone else's conversation delivered/read", async () => {
  const { h, client, close } = await boot();
  try {
    const patient = await client(u.patient); const intruder = await client(u.otherPatient);
    const sent = await emit(patient, "chat:send", { recipientId: D, body: "private", clientMessageId: uid() });
    // otherPatient has a (read-only) thread with the doctor but not THIS pair; naming the patient as counterparty is not a doctor<->patient pair
    const r1 = await emit(intruder, "chat:message:read", { userId: P });
    const r2 = await emit(intruder, "chat:message:delivered", { userId: P, messageIds: [sent.message._id] });
    assert.equal(r1.success, false);
    assert.equal(r2.success, false);
    assert.equal(h.repo.rows[0].readAt, null);
    assert.equal(h.repo.rows[0].deliveredAt, null);
  } finally { await close(); }
});

await test("typing: reaches only the counterpart, unauthorized typing yields chat:error and no broadcast, disconnect auto-stops", async () => {
  const { client, close } = await boot();
  try {
    const patient = await client(u.patient); const doctor = await client(u.doctor); const bystander = await client(u.otherPatient);
    let leaked = false; bystander.on("chat:typing:start", () => { leaked = true; });
    const started = once(doctor, "chat:typing:start");
    patient.emit("chat:typing:start", { recipientId: D });
    assert.equal((await started).senderId, P);
    // spamming keystroke events: only the first is relayed
    let extra = 0; doctor.on("chat:typing:start", () => { extra += 1; });
    for (let i = 0; i < 20; i += 1) patient.emit("chat:typing:start", { recipientId: D });
    await wait(150);
    assert.equal(extra, 0);

    const stopped = once(doctor, "chat:typing:stop");
    patient.close(); // disconnect while typing
    assert.equal((await stopped).senderId, P, "typing is cleaned up on disconnect");

    const errored = once(bystander, "chat:error");
    bystander.emit("chat:typing:start", { recipientId: String(u.otherDoctor._id) });
    assert.equal((await errored).code, "CHAT_FORBIDDEN");
    assert.equal(leaked, false);
  } finally { await close(); }
});

await test("RECONNECT: message sent while the recipient is offline is NOT delivered, then synced exactly once after reconnect", async () => {
  const { h, client, close } = await boot();
  try {
    const patient = await client(u.patient);
    let doctor = await client(u.doctor);
    const first = await emit(patient, "chat:send", { recipientId: P === "" ? D : D, body: "m1", clientMessageId: uid() });
    await once(doctor, "chat:message");
    await emit(doctor, "chat:message:delivered", { userId: P, messageIds: [first.message._id] });

    doctor.close(); await wait(50); // laptop sleeps / network drop
    const second = await emit(patient, "chat:send", { recipientId: D, body: "m2-while-offline", clientMessageId: uid() });
    assert.equal(second.success, true);
    assert.equal(h.repo.rows[1].deliveredAt, null, "offline recipient => deliveredAt stays null");
    // the patient's client retries the same message after a lost ack: still one row
    const retry = await emit(patient, "chat:send", { recipientId: D, body: "m2-while-offline", clientMessageId: second.message.clientMessageId });
    assert.equal(retry.duplicate, true);

    doctor = await client(u.doctor); // reconnect: re-authenticate
    const deliveredAtPatient = once(patient, "chat:message:delivered");
    const sync = await emit(doctor, "chat:sync", { userId: P, afterMessageId: first.message._id });
    assert.equal(sync.success, true);
    assert.deepEqual(sync.messages.map((m) => m.body), ["m2-while-offline"], "exactly the missed message, no duplicate of m1");
    assert.deepEqual((await deliveredAtPatient).messageIds, [second.message._id]);
    assert.equal(h.repo.rows.length, 2);

    // second sync is a no-op (no duplicates, nothing re-delivered)
    const again = await emit(doctor, "chat:sync", { userId: P, afterMessageId: sync.messages[0]._id });
    assert.equal(again.messages.length, 0);
    // the patient reconciles state of messages it already had
    const sSync = await emit(patient, "chat:sync", { userId: D, knownOutgoingIds: [first.message._id, second.message._id] });
    assert.deepEqual(sSync.updates.map((x) => x.status).sort(), ["delivered", "delivered"]);
  } finally { await close(); }
});

await test("SESSION INVALIDATION (password reset / deactivation): next chat event disconnects the socket and sends nothing", async () => {
  const { h, client, close } = await boot();
  try {
    const patient = await client(u.patient);
    revalidateResult = "SESSION_INVALIDATED";
    const invalidated = once(patient, "auth:invalidated");
    const disconnected = once(patient, "disconnect");
    const ack = await emit(patient, "chat:send", { recipientId: D, body: "x", clientMessageId: uid() });
    assert.equal(ack.success, false);
    assert.equal(ack.error.code, "CHAT_SESSION_INVALID");
    assert.equal((await invalidated).reason, "SESSION_INVALIDATED");
    await disconnected;
    assert.equal(h.repo.rows.length, 0);
    revalidateResult = "USER_INACTIVE";
    const p2 = await client(u.doctor);
    const ack2 = await emit(p2, "chat:sync", { userId: P });
    assert.equal(ack2.success, false);
    assert.equal(ack2.error.code, "CHAT_SESSION_INVALID");
  } finally { revalidateResult = null; await close(); }
});

await test("per-user rate limit holds across multiple sockets (reconnect cannot bypass it)", async () => {
  const closeRef = {};
  let io;
  const h = createEngineHarness({
    users: Object.values(u), relationships: [{ doctor: u.doctor, patient: u.patient, appointments: [ACTIVE_APPT] }], limits: { send: [4, 60_000] },
    broadcastSink: () => {},
  });
  const server = http.createServer();
  io = new Server(server);
  io.use((s, next) => { s.user = u.patient; s.tokenSecurityVersion = 0; next(); });
  io.on("connection", (s) => registerChatHandlers(io, s, { engine: h.engine, revalidate: async () => null }));
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  for (let i = 0; i < 3; i += 1) { // three different sockets, two messages each
    const c = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    await once(c, "connect");
    for (let j = 0; j < 2; j += 1) results.push(await emit(c, "chat:send", { recipientId: D, body: `m${i}${j}`, clientMessageId: uid() }));
    c.close();
  }
  io.close(); await new Promise((r) => server.close(r)); void closeRef;
  assert.equal(results.filter((r) => r.success).length, 4);
  assert.ok(results.filter((r) => !r.success).every((r) => r.error.code === "CHAT_RATE_LIMITED"));
  assert.equal(h.repo.rows.length, 4);
});

// room join policy is exercised against the real roomManager with stubbed lookups elsewhere (chatAccessPolicy.test.mjs)
if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("chatSocket: all passed");
process.exit(0);
