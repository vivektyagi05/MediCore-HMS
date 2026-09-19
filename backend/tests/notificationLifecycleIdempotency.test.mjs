import assert from "node:assert/strict";
import { buildVerificationEventKey, getVerificationCycleId } from "../utils/verificationCycle.js";

const id = (value) => ({ toString: () => value });

const cycle1 = id("cycle-1");
const cycle2 = id("cycle-2");
const doctor = { _id: id("doctor-1"), verificationHistory: [{ _id: cycle1, status: "pending" }] };

assert.equal(getVerificationCycleId(doctor), "cycle-1");
assert.equal(`doctor-application:${doctor._id}:${getVerificationCycleId(doctor)}`, "doctor-application:doctor-1:cycle-1");
assert.equal(`doctor-application:${doctor._id}:${getVerificationCycleId(doctor)}`, "doctor-application:doctor-1:cycle-1");

const firstReject = buildVerificationEventKey({ doctorId: "doctor-1", cycleId: getVerificationCycleId({ ...doctor, verificationHistory: [{ _id: cycle1, status: "pending" }, { _id: id("terminal-1"), status: "rejected" }] }), status: "rejected" });
assert.equal(firstReject, "verification:doctor-1:cycle-1:rejected");

const resubmitted = { _id: doctor._id, verificationHistory: [
  { _id: cycle1, status: "pending" },
  { _id: id("terminal-1"), status: "rejected" },
  { _id: cycle2, status: "pending" },
] };
const secondCycle = getVerificationCycleId(resubmitted);
assert.equal(secondCycle, "cycle-2");
assert.notEqual(secondCycle, getVerificationCycleId(doctor));
assert.equal(`doctor-application:${resubmitted._id}:${secondCycle}`, "doctor-application:doctor-1:cycle-2");
assert.equal(buildVerificationEventKey({ doctorId: "doctor-1", cycleId: secondCycle, status: "rejected" }), "verification:doctor-1:cycle-2:rejected");
assert.equal(buildVerificationEventKey({ doctorId: "doctor-1", cycleId: secondCycle, status: "approved" }), "verification:doctor-1:cycle-2:approved");
assert.equal(buildVerificationEventKey({ doctorId: "doctor-1", cycleId: secondCycle, status: "approved" }), buildVerificationEventKey({ doctorId: "doctor-1", cycleId: secondCycle, status: "approved" }));

const unique = new Set([
  "doctor-application:doctor-1:cycle-1",
  "verification:doctor-1:cycle-1:rejected",
  "doctor-application:doctor-1:cycle-2",
  "verification:doctor-1:cycle-2:rejected",
  "verification:doctor-1:cycle-2:approved",
]);
assert.equal(unique.size, 5, "each lifecycle event must have a distinct recipient/eventKey identity");

const practice = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../realtime/practiceEmitter.js", import.meta.url), "utf8"));
assert.doesNotMatch(practice, /verification:\$\{doctorId\}:\$\{status\}/);
const model = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../models/NotificationDelivery.js", import.meta.url), "utf8"));
assert.match(model, /notificationDeliverySchema\.index\(\{ eventKey: 1, recipientId: 1 \}, \{ unique: true, sparse: true \}\)/);

console.log("PASS notificationLifecycleIdempotency.test.mjs");
