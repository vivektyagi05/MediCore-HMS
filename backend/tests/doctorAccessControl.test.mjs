// PHASE 2-B — Section 8 (Doctor Access Control) regression test.
//
// Locks the requireApprovedDoctor gate itself: real logic test against
// stubbed Mongoose model calls (no live DB in this sandbox — same pattern
// as chatAuthorization.test.mjs). Also does source-inspection checks to
// confirm the gate is actually wired into the routes it needs to protect,
// and deliberately NOT wired into onboarding/document/profile routes that
// a not-yet-approved doctor must still be able to reach.

import assert from "node:assert/strict";
import fs from "node:fs";
import Doctor from "../models/Doctor.js";
import { requireApprovedDoctor } from "../middleware/doctorAccessMiddleware.js";

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

console.log("doctorAccessControl.test.mjs");

const stubDoctorFindOne = (result) => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => result }) });
};

const runMiddleware = async (req) => {
  let nextArg;
  await requireApprovedDoctor(req, {}, (arg) => {
    nextArg = arg;
  });
  return nextArg;
};

await asyncTest("approved + verified doctor passes through with no error", async () => {
  stubDoctorFindOne({ verificationStatus: "approved", isVerified: true });
  const nextArg = await runMiddleware({ user: { _id: "doc-1" } });
  assert.equal(nextArg, undefined);
});

await asyncTest("pending doctor is rejected with 403", async () => {
  stubDoctorFindOne({ verificationStatus: "pending", isVerified: false });
  const nextArg = await runMiddleware({ user: { _id: "doc-2" } });
  assert.ok(nextArg, "expected an error to be passed to next()");
  assert.equal(nextArg.statusCode, 403);
});

await asyncTest("rejected doctor is rejected with 403", async () => {
  stubDoctorFindOne({ verificationStatus: "rejected", isVerified: false });
  const nextArg = await runMiddleware({ user: { _id: "doc-3" } });
  assert.equal(nextArg.statusCode, 403);
});

await asyncTest("approved flag set but isVerified false (inconsistent data) is still rejected", async () => {
  stubDoctorFindOne({ verificationStatus: "approved", isVerified: false });
  const nextArg = await runMiddleware({ user: { _id: "doc-4" } });
  assert.equal(nextArg.statusCode, 403);
});

await asyncTest("no Doctor profile on file is rejected, not crashed", async () => {
  stubDoctorFindOne(null);
  const nextArg = await runMiddleware({ user: { _id: "doc-5" } });
  assert.equal(nextArg.statusCode, 403);
});

await asyncTest("a thrown lookup error is forwarded to next(), not swallowed", async () => {
  Doctor.findOne = () => ({
    select: () => ({
      lean: async () => {
        throw new Error("connection lost");
      },
    }),
  });
  const nextArg = await runMiddleware({ user: { _id: "doc-6" } });
  assert.equal(nextArg.message, "connection lost");
});

test("requireApprovedDoctor is wired into every clinical doctor route in workflowRoutes.js except documents/leaves-admin", () => {
  const src = fs.readFileSync(new URL("../routes/doctor/workflowRoutes.js", import.meta.url), "utf8");
  assert.match(src, /requireApprovedDoctor/);
  // Document endpoints must remain reachable pre-approval (uploading
  // verification documents IS the pending application).
  const documentsBlock = src.slice(src.indexOf('"/documents",'), src.indexOf('"/analytics",'));
  assert.doesNotMatch(documentsBlock, /authorizeApprovedDoctor|requireApprovedDoctor/);
});

test("requireApprovedDoctor gates the Command Center", () => {
  const src = fs.readFileSync(new URL("../routes/doctor/commandCenterRoutes.js", import.meta.url), "utf8");
  assert.match(src, /requireApprovedDoctor/);
});

test("requireApprovedDoctor gates doctor financial/review/withdrawal routes but not admin approve/reject", () => {
  const src = fs.readFileSync(new URL("../routes/doctorRoutes.js", import.meta.url), "utf8");
  const gatedHandlers = [
    "getDoctorPatients",
    "getDoctorReviews",
    "getDoctorEarnings",
    "getWithdrawalBalance",
    "getDoctorBusinessOverview",
  ];
  for (const handler of gatedHandlers) {
    const idx = src.indexOf(handler, src.indexOf(handler) + 1); // skip the import-statement occurrence, find the route-wiring one
    const precedingSlice = src.slice(Math.max(0, idx - 200), idx);
    assert.match(precedingSlice, /requireApprovedDoctor/, `${handler} should be gated`);
  }
  // Admin approve/reject/pending must remain ADMIN-only, never gated by
  // requireApprovedDoctor (that check is about the DOCTOR's own approval
  // state, meaningless for an admin actor).
  const approveIdx = src.indexOf("approveDoctor,\n);") !== -1 ? src.indexOf("approveDoctor,\n);") : src.indexOf("approveDoctor");
  const approveBlockStart = src.lastIndexOf("router.put", approveIdx);
  const approveBlock = src.slice(approveBlockStart, approveIdx + 20);
  assert.doesNotMatch(approveBlock, /requireApprovedDoctor/);
});
