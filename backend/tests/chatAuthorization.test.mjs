// Regression test for the DOC-03 chat security gap: chat:send, the "chat:"
// room join, and getConversation previously had no relationship check at
// all beyond "the requester is one of the two participant ids" — any
// authenticated user could message, or read the history of, any other
// user. This locks the authorization rule itself using stubbed Mongoose
// model calls (no live DB in this sandbox — see repo-wide pattern).

import assert from "node:assert/strict";
import Doctor from "../models/Doctor.js";
import Appointment from "../models/Appointment.js";
import { usersCanChat } from "../utils/chatAuthorization.js";

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

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("chatAuthorization.test.mjs");

const doctorUser = { _id: "u-doctor-1", role: "doctor" };
const patientUser = { _id: "u-patient-1", role: "patient" };
const otherPatientUser = { _id: "u-patient-2", role: "patient" };
const adminUser = { _id: "u-admin-1", role: "admin" };

await asyncTest("same user cannot chat with themself", async () => {
  assert.equal(await usersCanChat(doctorUser, doctorUser), false);
});

await asyncTest("admin participant is always allowed, no DB lookup needed", async () => {
  assert.equal(await usersCanChat(adminUser, patientUser), true);
  assert.equal(await usersCanChat(patientUser, adminUser), true);
});

await asyncTest("patient-patient pairing is denied (no such chat feature exists)", async () => {
  assert.equal(await usersCanChat(patientUser, otherPatientUser), false);
});

await asyncTest("doctor-patient with no Doctor profile on file is denied", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => null }) });
  assert.equal(await usersCanChat(doctorUser, patientUser), false);
});

await asyncTest("doctor-patient with a Doctor profile but no real appointment relationship is denied", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => ({ _id: "doc-profile-1" }) }) });
  Appointment.exists = async () => null;
  assert.equal(await usersCanChat(doctorUser, patientUser), false);
});

await asyncTest("doctor-patient WITH a real appointment relationship is allowed", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => ({ _id: "doc-profile-1" }) }) });
  let queried = null;
  Appointment.exists = async (filter) => {
    queried = filter;
    return { _id: "appt-1" };
  };
  assert.equal(await usersCanChat(doctorUser, patientUser), true);
  // Confirms the relationship check is scoped to THIS doctor/patient pair,
  // not a bare "some appointment exists somewhere" check.
  assert.equal(queried.doctorId, "doc-profile-1");
  assert.equal(queried.patientId, "u-patient-1");
});
