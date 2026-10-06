// Client message-state rules (src/utils/chatMessageState.js): reconciliation by
// clientMessageId, no regression of status, no duplicates after reconnect,
// bounded retry, error normalisation.
import assert from "node:assert/strict";
import {
  RETRY_DELAYS_MS, addPending, applyDelivered, applyRead, applyStates, chatErrorInfo, incomingUnreadIds, knownOutgoingIds,
  lastServerMessageId, markFailed, markSending, mergeServerMessages, newClientMessageId,
} from "../../src/utils/chatMessageState.js";

let failures = 0;
const test = (name, fn) => { try { fn(); console.log(`  PASS ${name}`); } catch (e) { failures += 1; console.error(`  FAIL ${name}`); console.error(e); } };
console.log("chatMessageState.test.mjs");

const ME = "u-me"; const OTHER = "u-other";
const pending = (cid, body = "hi") => ({ clientMessageId: cid, body, senderId: ME, recipientId: OTHER, status: "sending", createdAt: new Date().toISOString() });
const server = (id, cid, extra = {}) => ({ _id: id, clientMessageId: cid, body: "hi", senderId: ME, recipientId: OTHER, status: "sent", createdAt: new Date().toISOString(), ...extra });

test("clientMessageId is generated, regex-valid for the server, and unique", () => {
  const ids = new Set(Array.from({ length: 200 }, newClientMessageId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
});

test("ack reconciles the pending bubble in place — no duplicate even if the socket event ALSO arrives", () => {
  let list = addPending([], pending("c-1"));
  list = mergeServerMessages(list, [server("a1", "c-1")]); // ack
  list = mergeServerMessages(list, [server("a1", "c-1")]); // chat:message echo to the sender's own tab
  assert.equal(list.length, 1);
  assert.equal(list[0]._id, "a1");
  assert.equal(list[0].status, "sent");
});

test("echo arriving BEFORE the ack still reconciles the same bubble", () => {
  let list = addPending([], pending("c-1"));
  list = mergeServerMessages(list, [server("a1", "c-1")]);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "sent");
});

test("status never regresses: read -> a late 'sent' copy or 'delivered' event does not downgrade", () => {
  let list = mergeServerMessages([], [server("a1", "c-1")]);
  list = applyRead(list, ["a1"], "2026-01-01T00:00:00Z");
  list = applyDelivered(list, ["a1"], "2026-01-01T00:00:01Z");
  list = mergeServerMessages(list, [server("a1", "c-1", { status: "sent" })]);
  assert.equal(list[0].status, "read");
  assert.ok(list[0].readAt && list[0].deliveredAt, "read implies delivered");
});

test("delivered/read events for unknown ids are ignored; known ones advance", () => {
  let list = mergeServerMessages([], [server("a1", "c-1"), server("a2", "c-2")]);
  list = applyDelivered(list, ["a2", "zzz"], "t");
  assert.deepEqual(list.map((m) => m.status), ["sent", "delivered"]);
});

test("failed -> retry reuses the SAME clientMessageId and resolves to one message", () => {
  let list = addPending([], pending("c-9"));
  list = markFailed(list, "c-9", { message: "offline", retryable: true });
  assert.equal(list[0].status, "failed");
  list = markSending(list, "c-9");
  assert.equal(list[0].status, "sending");
  assert.equal(list[0].clientMessageId, "c-9");
  list = mergeServerMessages(list, [server("a9", "c-9")]);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "sent");
  assert.equal(list[0].error, undefined);
});

test("markFailed never touches a message the server already confirmed (late failure after success)", () => {
  let list = mergeServerMessages([], [server("a1", "c-1")]);
  list = markFailed(list, "c-1", { message: "timeout" });
  assert.equal(list[0].status, "sent");
});

test("reconnect sync: missed messages merge once, ordering by server id, pending stay last", () => {
  let list = mergeServerMessages([], [server("a1", "c-1"), server("a2", "c-2")]);
  list = addPending(list, pending("c-3"));
  assert.equal(lastServerMessageId(list), "a2");
  const missed = [{ ...server("a3", "x-3"), senderId: OTHER, recipientId: ME }, { ...server("a4", "x-4"), senderId: OTHER, recipientId: ME }];
  list = mergeServerMessages(list, missed);
  list = mergeServerMessages(list, missed); // duplicate sync response
  assert.deepEqual(list.map((m) => m._id || m.clientMessageId), ["a1", "a2", "a3", "a4", "c-3"]);
  assert.deepEqual(incomingUnreadIds(list, ME), ["a3", "a4"]);
});

test("pagination: older page prepended in order, no duplicates, overlap tolerated", () => {
  let list = mergeServerMessages([], [server("b5", "c5"), server("b6", "c6")]);
  list = mergeServerMessages(list, [server("b3", "c3"), server("b4", "c4"), server("b5", "c5")]);
  assert.deepEqual(list.map((m) => m._id), ["b3", "b4", "b5", "b6"]);
});

test("sync state updates move outgoing messages forward (offline period receipts)", () => {
  let list = mergeServerMessages([], [server("a1", "c-1"), server("a2", "c-2")]);
  assert.deepEqual(knownOutgoingIds(list, ME), ["a1", "a2"]);
  list = applyStates(list, [{ _id: "a1", status: "read", readAt: "r", deliveredAt: "d" }, { _id: "a2", status: "delivered", deliveredAt: "d" }]);
  assert.deepEqual(list.map((m) => m.status), ["read", "delivered"]);
  assert.deepEqual(knownOutgoingIds(list, ME), ["a2"], "fully-read messages no longer need re-checking");
});

test("retry policy is bounded (no infinite loop)", () => {
  assert.ok(RETRY_DELAYS_MS.length >= 1 && RETRY_DELAYS_MS.length <= 5);
});

test("error normalisation: offline/timeout retryable; policy denials, validation, read-only, 413/415 are not; 429 is surfaced", () => {
  assert.deepEqual([chatErrorInfo({ message: "Network Error" }).code, chatErrorInfo({ message: "Network Error" }).retryable], ["NETWORK", true]);
  assert.equal(chatErrorInfo({ code: "ECONNABORTED" }).code, "TIMEOUT");
  const ro = chatErrorInfo({ response: { status: 403, data: { message: "read-only", details: { code: "CHAT_READ_ONLY", readOnlyReason: "COMMUNICATION_WINDOW_EXPIRED" } } } });
  assert.deepEqual([ro.code, ro.retryable, ro.readOnlyReason], ["CHAT_READ_ONLY", false, "COMMUNICATION_WINDOW_EXPIRED"]);
  assert.equal(chatErrorInfo({ success: false, error: { code: "CHAT_FORBIDDEN", message: "no" } }).retryable, false);
  assert.equal(chatErrorInfo({ response: { status: 415, data: { message: "bad type", details: { code: "CHAT_ATTACHMENT_INVALID" } } } }).retryable, false);
  assert.equal(chatErrorInfo({ response: { status: 429, data: { message: "slow down", details: { code: "CHAT_RATE_LIMITED" } } } }).retryable, false);
  assert.equal(chatErrorInfo({ response: { status: 503, data: {} } }).retryable, true);
  const generic500 = chatErrorInfo({ response: { status: 500, data: { message: "Internal server error" } } });
  assert.equal(generic500.retryable, true);
  assert.doesNotMatch(chatErrorInfo({ response: { status: 401, data: {} } }).message, /undefined/);
});

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("chatMessageState: all passed");
