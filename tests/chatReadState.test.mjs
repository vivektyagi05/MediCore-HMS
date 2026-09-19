// Regression test for the DOC-03B chat bug: ChatMessage.readAt was read in
// three places but never written, so unread counts never cleared. Locks the
// pure selection rule getConversation now uses to mark messages read.

import assert from "node:assert/strict";
import { selectUnreadMessageIdsForReader } from "../utils/chatReadState.js";

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("chatReadState.test.mjs");

const readerId = "u-patient-1";
const otherId = "u-doctor-1";

test("marks unread messages addressed to the reader", () => {
  const messages = [
    { _id: "m1", recipientId: readerId, readAt: null },
    { _id: "m2", recipientId: readerId, readAt: null },
  ];
  const ids = selectUnreadMessageIdsForReader(messages, readerId);
  assert.deepEqual(ids, ["m1", "m2"]);
});

test("does not re-mark already-read messages", () => {
  const messages = [{ _id: "m1", recipientId: readerId, readAt: new Date() }];
  assert.deepEqual(selectUnreadMessageIdsForReader(messages, readerId), []);
});

test("never marks the reader's own sent (outgoing) messages as read", () => {
  const messages = [{ _id: "m1", recipientId: otherId, readAt: null }];
  assert.deepEqual(selectUnreadMessageIdsForReader(messages, readerId), []);
});

test("handles populated recipientId (Mongoose populate shape)", () => {
  const messages = [{ _id: "m1", recipientId: { _id: readerId, name: "Reader" }, readAt: null }];
  assert.deepEqual(selectUnreadMessageIdsForReader(messages, readerId), ["m1"]);
});

test("returns [] for empty/invalid input rather than throwing", () => {
  assert.deepEqual(selectUnreadMessageIdsForReader([], readerId), []);
  assert.deepEqual(selectUnreadMessageIdsForReader(null, readerId), []);
  assert.deepEqual(selectUnreadMessageIdsForReader([{ _id: "m1", recipientId: readerId }], null), []);
});
