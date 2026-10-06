// REST transport: multer limits mapped to the chat error contract, structured
// error shape through the real errorMiddleware, duplicate => 200, download
// hardening headers. Auth (protect) is replaced by a test middleware and the
// engine's methods are stubbed on the singleton — this tests the transport
// layer only; engine behaviour is covered by chatEngine.test.mjs.
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { chatEngine } from "../services/chat/chatEngine.js";
import { ChatError, CHAT_ERROR } from "../services/chat/chatConstants.js";
import {
  downloadAttachment, getConversation, parseAttachmentUpload, sendAttachment, sendMessage,
} from "../controllers/chatController.js";
import { errorMiddleware } from "../middleware/errorMiddleware.js";
import { PNG } from "./helpers/chatHarness.mjs";

let failures = 0;
async function test(name, fn) { try { await fn(); console.log(`  PASS ${name}`); } catch (e) { failures += 1; console.error(`  FAIL ${name}`); console.error(e); } }
console.log("chatRest.test.mjs");

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { _id: "u1", role: "patient" }; next(); });
app.get("/chat/messages/:messageId/attachment", downloadAttachment);
app.get("/chat/:userId", getConversation);
app.post("/chat/:userId/messages", sendMessage);
app.post("/chat/:userId/attachments", parseAttachmentUpload, sendAttachment);
app.use(errorMiddleware);

const quiet = console.error; // errorMiddleware logs structured JSON for 5xx/4xx; keep test output readable
console.error = () => {};

await test("send: 201 for a new message, 200 + duplicate flag for a retry (same clientMessageId)", async () => {
  let calls = 0;
  chatEngine.sendMessage = async (user, input) => { calls += 1; return { message: { _id: "m1", clientMessageId: input.clientMessageId }, duplicate: calls > 1 }; };
  const first = await request(app).post("/chat/u2/messages").send({ body: "hi", clientMessageId: "abcdefgh1" });
  const retry = await request(app).post("/chat/u2/messages").send({ body: "hi", clientMessageId: "abcdefgh1" });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.duplicate, true);
});

await test("engine denials surface in the standard error format with the chat code (403/422/429/404), no stack or internals", async () => {
  for (const [code, status] of [[CHAT_ERROR.FORBIDDEN, 403], [CHAT_ERROR.READ_ONLY, 403], [CHAT_ERROR.VALIDATION, 422], [CHAT_ERROR.RATE_LIMITED, 429], [CHAT_ERROR.NOT_FOUND, 404]]) {
    chatEngine.getHistory = async () => { throw new ChatError(code, "nope", code === CHAT_ERROR.READ_ONLY ? { readOnlyReason: "COMMUNICATION_WINDOW_EXPIRED" } : {}); };
    const res = await request(app).get("/chat/u2");
    assert.equal(res.status, status, code);
    assert.equal(res.body.success, false);
    assert.equal(res.body.details.code, code);
    assert.deepEqual(Object.keys(res.body).sort(), ["details", "message", "success"]);
    assert.doesNotMatch(JSON.stringify(res.body), /stack|node_modules|mongo/i);
  }
});

await test("oversize upload => 413 CHAT_ATTACHMENT_TOO_LARGE before the engine is ever called", async () => {
  let called = false;
  chatEngine.sendAttachment = async () => { called = true; return { message: {}, duplicate: false }; };
  const res = await request(app).post("/chat/u2/attachments").field("clientMessageId", "abcdefgh2").attach("file", Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), { filename: "big.png", contentType: "image/png" });
  assert.equal(res.status, 413);
  assert.equal(res.body.details.code, CHAT_ERROR.ATTACHMENT_TOO_LARGE);
  assert.equal(called, false);
});

await test("upload without a file => 422; extra files/unexpected field names are not accepted", async () => {
  chatEngine.sendAttachment = async () => ({ message: {}, duplicate: false });
  const none = await request(app).post("/chat/u2/attachments").field("clientMessageId", "abcdefgh3");
  assert.equal(none.status, 422);
  const wrongField = await request(app).post("/chat/u2/attachments").attach("document", PNG, { filename: "a.png", contentType: "image/png" });
  assert.equal(wrongField.status, 415);
});

await test("valid upload reaches the engine with the multipart buffer, and the client-claimed type is only a claim", async () => {
  let seen;
  chatEngine.sendAttachment = async (user, input) => { seen = input; return { message: { _id: "m9" }, duplicate: false }; };
  const res = await request(app).post("/chat/u2/attachments").field("clientMessageId", "abcdefgh4").field("caption", "look").attach("file", PNG, { filename: "a.png", contentType: "image/png" });
  assert.equal(res.status, 201);
  assert.equal(seen.recipientId, "u2");
  assert.equal(seen.clientMessageId, "abcdefgh4");
  assert.equal(seen.caption, "look");
  assert.deepEqual(seen.file.buffer, PNG);
});

await test("download: hardened headers, server-recorded content type, inline for images / attachment for PDFs, filename can't inject headers", async () => {
  chatEngine.downloadAttachment = async () => ({ buffer: PNG, mimeType: "image/png", fileName: "a\r\nX-Evil: 1\".png", kind: "image" });
  const img = await request(app).get("/chat/messages/m1/attachment");
  assert.equal(img.status, 200);
  assert.equal(img.headers["content-type"], "image/png");
  assert.equal(img.headers["x-content-type-options"], "nosniff");
  assert.equal(img.headers["cache-control"], "private, no-store");
  assert.match(img.headers["content-security-policy"], /sandbox/);
  assert.match(img.headers["content-disposition"], /^inline;/);
  assert.equal(img.headers["x-evil"], undefined);
  chatEngine.downloadAttachment = async () => ({ buffer: Buffer.from("%PDF-1.4"), mimeType: "application/pdf", fileName: "r.pdf", kind: "document" });
  const pdf = await request(app).get("/chat/messages/m2/attachment");
  assert.match(pdf.headers["content-disposition"], /^attachment;/);
  chatEngine.downloadAttachment = async () => { throw new ChatError(CHAT_ERROR.NOT_FOUND, "Attachment not found"); };
  assert.equal((await request(app).get("/chat/messages/m3/attachment")).status, 404);
});

console.error = quiet;
if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("chatRest: all passed");
process.exit(0);
