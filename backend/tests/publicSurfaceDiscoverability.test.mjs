// PHASE 2-D — Public Surface audit regression test.
//
// AUDIT FINDING: getDoctorPublicReviews and getSimilarDoctors both queried
// by doctor ID without checking isVerified/verificationStatus/isActive,
// unlike every sibling endpoint in this file (getDoctorPublicProfile,
// compareDoctors, getPublicNextAvailability, getPublicDoctorAvailability
// all gate on the same three fields). That meant a pending or rejected
// doctor's reviews — and their specialization/city, via getSimilarDoctors'
// source lookup — were reachable by ID even though the profile itself
// correctly 404s. Locks the fix: both now 404 for a non-discoverable
// doctor, using the same stubbed-Mongoose-model pattern as
// chatAuthorization.test.mjs / doctorAccessControl.test.mjs (no live DB in
// this sandbox).

import assert from "node:assert/strict";
import mongoose from "mongoose";
import Doctor from "../models/Doctor.js";
import Review from "../models/Review.js";
import User from "../models/User.js";
import { getDoctorPublicReviews, getSimilarDoctors } from "../controllers/publicController.js";

function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      console.log(`  PASS ${name}`);
    } catch (err) {
      console.error(`  FAIL ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  };
  return run();
}

console.log("publicSurfaceDiscoverability.test.mjs");

const fakeId = new mongoose.Types.ObjectId().toString();

// publicDoctorFilter() first resolves the active doctor user ids.
User.find = () => ({ select: () => ({ lean: async () => [] }) });

const fakeRes = () => ({ status: () => ({ json: () => {} }) });

const runController = async (controller, req, res = fakeRes()) => {
  let capturedError;
  await controller(req, res, (err) => { capturedError = err; });
  return capturedError;
};

await test("getDoctorPublicReviews: 404s for a doctor that isn't verified/approved/active", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => null }) });
  Review.find = () => { throw new Error("must not query reviews for a non-discoverable doctor"); };

  const err = await runController(getDoctorPublicReviews, { params: { id: fakeId }, query: {} });
  assert.ok(err, "expected an error to be passed to next()");
  assert.equal(err.statusCode, 404);
});

await test("getDoctorPublicReviews: proceeds when the doctor IS discoverable", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => ({ _id: fakeId }) }) });
  Review.find = () => ({
    populate: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) }),
  });
  Review.countDocuments = async () => 0;

  const err = await runController(getDoctorPublicReviews, { params: { id: fakeId }, query: {} });
  assert.equal(err, undefined, "a discoverable doctor must not be rejected");
});

await test("getSimilarDoctors: 404s (does not leak specialization/city) for a non-discoverable doctor", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => null }) });
  Doctor.find = () => { throw new Error("must not search for similar doctors off a non-discoverable source"); };

  const err = await runController(getSimilarDoctors, { params: { id: fakeId }, query: {} });
  assert.ok(err, "expected an error to be passed to next()");
  assert.equal(err.statusCode, 404);
});
