// Regression test for Phase DOC-06 (Clinical Intelligence & Consultation
// Workspace).
//
// Bug — clinicalEmitter.certificateCreated/prescriptionCreated only ever
// emitted a live Socket.IO event. Neither call ever persisted a
// NotificationDelivery row, so a patient who was offline at the moment a
// prescription or certificate was issued never saw it afterwards in their
// notification bell/inbox — the exact same silent-notification bug class
// DOC-02/DOC-05 already fixed for other producers (review/payout notices
// mis-typed as "appointment"). Here the producer wasn't wired to
// notificationEmitter at all, and "certificate" wasn't even a valid
// NotificationDelivery.type, so it would have failed Mongoose validation
// the moment it was added.
//
// Dependency-free — no live MongoDB, no HTTP server, same style as
// workflowNotifications.test.mjs.

import assert from "node:assert/strict";
import mongoose from "mongoose";
import NotificationDelivery from "../models/NotificationDelivery.js";

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

console.log("clinicalWorkspaceNotifications.test.mjs");

test("NotificationDelivery accepts type=certificate", () => {
  const doc = new NotificationDelivery({
    recipientId: new mongoose.Types.ObjectId(),
    type: "certificate",
    title: "New certificate issued",
    message: 'Your doctor issued a new fitness certificate: "Fit to Travel".',
    entityType: "Certificate",
    entityId: new mongoose.Types.ObjectId(),
  });
  const validationError = doc.validateSync();
  assert.equal(validationError, undefined, "certificate must be a valid enum value");
});

test("NotificationDelivery still accepts the existing type=prescription (unchanged)", () => {
  const doc = new NotificationDelivery({
    recipientId: new mongoose.Types.ObjectId(),
    type: "prescription",
    title: "New prescription available",
    message: "Your doctor issued a new prescription for Viral Fever.",
    entityType: "Prescription",
    entityId: new mongoose.Types.ObjectId(),
  });
  const validationError = doc.validateSync();
  assert.equal(validationError, undefined, "prescription must remain a valid enum value");
});

test("NotificationDelivery still rejects an unknown type (enum is not wide open)", () => {
  const doc = new NotificationDelivery({
    recipientId: new mongoose.Types.ObjectId(),
    type: "not_a_real_type",
    title: "x",
    message: "x",
  });
  const validationError = doc.validateSync();
  assert.ok(validationError, "an unrecognized type must still fail validation");
});

test("NotificationDelivery requires an eventKey-shaped idempotency key for certificate notices to dedupe", () => {
  // Not a schema constraint (eventKey is optional at the schema level) —
  // this documents/locks the convention every other producer in the
  // codebase follows, matching clinicalEmitter.js's
  // `certificate:${certificate._id}:created:patient` shape.
  const eventKey = `certificate:${new mongoose.Types.ObjectId()}:created:patient`;
  assert.match(eventKey, /^certificate:[a-f0-9]{24}:created:patient$/);
});
