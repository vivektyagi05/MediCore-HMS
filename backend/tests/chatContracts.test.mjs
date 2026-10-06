// Cross-layer contracts: the bug class that made UI chat sends vanish (client
// emitted "chat:message", server listened on "chat:send") must never return.
// Also locks security-relevant source properties of the chat subsystem.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { CHAT_EVENTS } from "../services/chat/chatConstants.js";
import { SOCKET_EVENTS } from "../../src/socket/socketEvents.js";
import ChatMessage from "../models/ChatMessage.js";

let failures = 0;
async function test(name, fn) { try { await fn(); console.log(`  PASS ${name}`); } catch (e) { failures += 1; console.error(`  FAIL ${name}`); console.error(e); } }
console.log("chatContracts.test.mjs");

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(backend, "..");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");
const walk = (dir) => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

await test("frontend chat event names are exactly the backend's (client emit/listen == server on/emit)", () => {
  const pairs = {
    CHAT_SEND: CHAT_EVENTS.SEND, CHAT_MESSAGE: CHAT_EVENTS.MESSAGE, CHAT_DELIVERED: CHAT_EVENTS.DELIVERED, CHAT_READ: CHAT_EVENTS.READ,
    CHAT_SYNC: CHAT_EVENTS.SYNC, CHAT_ERROR: CHAT_EVENTS.ERROR, TYPING_START: CHAT_EVENTS.TYPING_START, TYPING_STOP: CHAT_EVENTS.TYPING_STOP,
  };
  for (const [clientKey, serverName] of Object.entries(pairs)) assert.equal(SOCKET_EVENTS[clientKey], serverName, clientKey);
});

await test("every event the chat client EMITS is registered by a server handler", () => {
  const hook = read("src/hooks/useConversation.js");
  const emitted = [...hook.matchAll(/(?:socketEmit|\.emit)\(\s*SOCKET_EVENTS\.(\w+)/g)].map((m) => SOCKET_EVENTS[m[1]]);
  assert.ok(emitted.length >= 5, "found the client's emits");
  const handlers = read("backend/socket/chatHandlers.js");
  for (const eventName of emitted) {
    const key = Object.entries(CHAT_EVENTS).find(([, v]) => v === eventName)?.[0];
    assert.ok(key, `${eventName} is a chat event`);
    assert.match(handlers, new RegExp(`on\\(CHAT_EVENTS\\.${key}\\b`), `${eventName} has a server handler`);
  }
});

await test("chat UI never renders message content as HTML", () => {
  for (const file of [...walk("src/components/realtime"), ...walk("src/pages/chat"), "src/hooks/useConversation.js"]) {
    if (!/\.(jsx?|mjs)$/.test(file)) continue;
    const src = read(file);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/, file);
    assert.doesNotMatch(src, /localStorage\.(set|get)Item\([^)]*(message|chat)/i, `${file} must not stash message content in localStorage`);
  }
});

await test("chat backend never falls back to a bare Appointment.exists check, and uses only the three runtime roles", () => {
  for (const file of [...walk("backend/services/chat"), ...walk("backend/socket"), "backend/controllers/chatController.js"]) {
    const src = read(file);
    assert.doesNotMatch(src, /Appointment\.exists/, file);
    assert.doesNotMatch(src, /["'`](?:receptionist|staff|moderator|support)["'`]|ROLES\.ADMIN\b|role:\s*["']admin["']/, file);
  }
});

await test("chat logging never includes message bodies or file bytes", () => {
  for (const file of [...walk("backend/services/chat"), "backend/socket/chatHandlers.js", "backend/controllers/chatController.js"]) {
    const src = read(file);
    for (const m of src.matchAll(/\blog(?:ger)?\.(?:info|warn|error)\(([\s\S]*?)\);/g)) {
      const withoutSizes = m[1].replace(/file\?\.buffer\?\.length/g, ""); // a byte COUNT is fine; bytes/bodies are not
      assert.doesNotMatch(withoutSizes, /\bbody\b|\btext\b|\bbuffer\b|storageKey/, `${file}: ${m[0].slice(0, 80)}`);
    }
  }
});

await test("storage keys: select:false in the model, selected only behind an explicit flag, never serialized", () => {
  const model = read("backend/models/ChatMessage.js");
  assert.match(model, /storageKey:\s*\{[^}]*select:\s*false/);
  const repoSrc = read("backend/services/chat/chatRepository.js");
  assert.equal((repoSrc.match(/\+attachment\.storageKey/g) || []).length, 1, "exactly one place may load the key");
  assert.match(repoSrc, /withAttachmentKey/);
  assert.match(read("backend/services/chat/conversationEngine.js"), /attachment: hasAttachment\s*\?\s*\{ fileName/, "serializer whitelists attachment fields");
});

await test("attachment download response is hardened (nosniff, no-store, sandbox CSP, server-recorded content type)", () => {
  const src = read("backend/controllers/chatController.js");
  for (const h of ["X-Content-Type-Options\", \"nosniff", "Cache-Control\", \"private, no-store", "Content-Security-Policy\", \"sandbox"]) assert.ok(src.includes(h), h);
  assert.match(src, /setHeader\("Content-Type", file\.mimeType\)/);
});

await test("routes: static chat paths are registered before /chat/:userId and every chat route is authenticated", () => {
  const src = read("backend/routes/realtimeRoutes.js");
  const order = ['router.get("/chat/conversations"', 'router.get("/chat/contacts"', 'router.get("/chat/unread-count"', 'router.get("/chat/messages/:messageId/attachment"', 'router.get("/chat/:userId"'].map((needle) => src.indexOf(needle));
  assert.ok(order.every((i) => i >= 0), "all routes present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "static before parameterised");
  for (const line of src.split("\n").filter((l) => l.startsWith("router.") && l.includes("/chat/"))) assert.match(line, /protect/, line);
  assert.match(src, /parseAttachmentUpload, sendAttachment/);
});

await test("the doctor and patient hubs exist as real routes, share ONE component, and are in navigation", () => {
  const routes = read("src/routes/AppRoutes.jsx");
  assert.match(routes, /path="communication"[^>]*element=\{<CommunicationHub \/>\}/g);
  assert.equal((routes.match(/<CommunicationHub \/>/g) || []).length, 4, "doctor + patient, with and without :userId");
  const nav = read("src/config/navigation.js");
  assert.match(nav, /path: "\/doctor\/communication"[^}]*roles: \["doctor"\]/);
  assert.match(nav, /path: "\/patient\/communication"[^}]*roles: \["patient"\]/);
  assert.equal(walk("src").filter((f) => /Chat(Engine|Service)|DoctorChat|PatientChat/.test(f)).length, 0, "no parallel chat engine files");
});

await test("legacy surfaces point at the hub (no dead links to the old chat page for doctors/patients)", () => {
  assert.doesNotMatch(read("src/pages/patient/PatientAppointments.jsx"), /navigate\(`\/chat\//);
  assert.match(read("src/pages/chat/ChatWorkspace.jsx"), /Navigate to=\{`\/doctor\/communication/);
});

await test("ChatMessage schema: validation rules, enum-restricted attachments, unique idempotency index, toJSON strips the key", async () => {
  const base = { conversationKey: "a:b", senderId: new mongoose.Types.ObjectId(), recipientId: new mongoose.Types.ObjectId() };
  await assert.rejects(new ChatMessage({ ...base, messageType: "text", body: "" }).validate(), /body/i);
  await new ChatMessage({ ...base, messageType: "attachment", body: "", attachment: { fileName: "a.png", mimeType: "image/png", size: 5, kind: "image" } }).validate();
  await assert.rejects(new ChatMessage({ ...base, messageType: "attachment", attachment: { fileName: "a.svg", mimeType: "image/svg+xml", size: 5, kind: "image" } }).validate(), /mimeType/);
  await assert.rejects(new ChatMessage({ ...base, body: "x".repeat(4001) }).validate(), /body/);
  const idx = ChatMessage.schema.indexes();
  const unique = idx.find(([keys, opts]) => keys.senderId === 1 && keys.clientMessageId === 1 && opts.unique);
  assert.ok(unique, "unique (senderId, clientMessageId)");
  assert.deepEqual(unique[1].partialFilterExpression, { clientMessageId: { $type: "string" } });
  for (const keys of [{ conversationKey: 1, _id: -1 }, { recipientId: 1, readAt: 1, conversationKey: 1 }, { senderId: 1, recipientId: 1, createdAt: -1 }]) {
    assert.ok(idx.some(([k]) => JSON.stringify(k) === JSON.stringify(keys)), JSON.stringify(keys));
  }
  const doc = new ChatMessage({ ...base, body: "hi", attachment: { storageKey: "chat-attachments/x", fileName: "a.png", mimeType: "image/png", size: 1, kind: "image" } });
  assert.equal(doc.toJSON().attachment.storageKey, undefined);
});

await test("client attachment limits match the server's (5 MB, PNG/JPEG/PDF)", async () => {
  const { CHAT_LIMITS } = await import("../services/chat/chatConstants.js");
  const hook = read("src/hooks/useConversation.js");
  assert.match(hook, /ATTACHMENT_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.equal(CHAT_LIMITS.ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024);
  assert.match(hook, /ATTACHMENT_TYPES = \["image\/png", "image\/jpeg", "application\/pdf"\]/);
});

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("chatContracts: all passed");
