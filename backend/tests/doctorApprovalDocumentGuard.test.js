// Integration test for GLOBAL-FLOW-INTEGRITY-AUDIT-2026-09-25, item ONB-002:
//
//   approveDoctor only checked verificationStatus === "pending" via an
//   atomic findOneAndUpdate. Nothing checked document presence, so any
//   doctor that reached "pending" (including via the ONB-001 gap this same
//   audit closed) could be approved with zero uploaded verification
//   documents.
//
// This exercises the REAL Express app (real app.js, real doctorRoutes,
// real authMiddleware/roleMiddleware, real approveDoctor controller) over
// real HTTP via supertest -- same pattern as
// doctorApproveBodyContract.test.js. Only the Doctor/User models are
// replaced. A live MongoDB is not reachable in this sandbox (see that
// file's header comment and this repo's mongodb-memory-server binary-
// download restriction), so this is the same honest substitute already
// established here, not a source-string search.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-ci";
process.env.JWT_EXPIRES_IN = "7d";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/hms_unused_in_this_test";
process.env.RATE_LIMIT_MAX = "1000";
process.env.BCRYPT_SALT_ROUNDS = "4";

mongoose.set("bufferCommands", false);

const ADMIN_ID = new mongoose.Types.ObjectId();
const DOCTOR_USER_ID = new mongoose.Types.ObjectId();
const DOCTOR_ID = new mongoose.Types.ObjectId();

// Mutable per-test fixture state, reset in afterEach.
let currentDoctorStatus = "pending";
let currentDocuments = [];
let findOneAndUpdateCalls = 0;

const fakeQuery = (result) => {
  const query = {
    select: () => query,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return query;
};

vi.mock("../models/User.js", () => ({
  default: {
    findById: (id) => {
      const idStr = id?.toString?.() ?? String(id);
      if (idStr === ADMIN_ID.toString()) {
        return fakeQuery({ _id: ADMIN_ID, role: "super_admin", isActive: true, securityVersion: 0 });
      }
      if (idStr === DOCTOR_USER_ID.toString()) {
        return fakeQuery({ _id: DOCTOR_USER_ID, name: "Dr. Test", email: "" });
      }
      return fakeQuery(null);
    },
    findByIdAndUpdate: () => Promise.resolve({}),
  },
}));

vi.mock("../models/Doctor.js", () => ({
  default: {
    findById: () =>
      fakeQuery({
        _id: DOCTOR_ID,
        userId: DOCTOR_USER_ID,
        verificationStatus: currentDoctorStatus,
        specialization: "Cardiology",
        documents: currentDocuments,
      }),
    // Real findOneAndUpdate semantics: only succeeds if the filter's
    // verificationStatus still matches the current fixture state. Counting
    // calls lets the "no false approval" assertion below prove the atomic
    // update path was never reached when the document guard should have
    // stopped the flow first.
    findOneAndUpdate: (filter) => {
      findOneAndUpdateCalls += 1;
      if (filter.verificationStatus !== currentDoctorStatus) return Promise.resolve(null);
      currentDoctorStatus = "approved";
      return Promise.resolve({
        _id: DOCTOR_ID,
        userId: DOCTOR_USER_ID,
        verificationStatus: "approved",
        specialization: "Cardiology",
        documents: currentDocuments,
      });
    },
  },
}));

let app;
let generateToken;
let adminToken;

beforeAll(async () => {
  const importedApp = await import("../app.js");
  const importedToken = await import("../utils/generateToken.js");
  app = importedApp.default;
  generateToken = importedToken.generateToken;
  adminToken = generateToken({ _id: ADMIN_ID, role: "super_admin", securityVersion: 0 });
});

afterEach(() => {
  currentDoctorStatus = "pending";
  currentDocuments = [];
  findOneAndUpdateCalls = 0;
});

describe("PUT /api/doctors/:id/approve — ONB-002 document-presence guard", () => {
  it("rejects with 409 when the pending doctor has zero uploaded documents", async () => {
    currentDocuments = [];

    const res = await request(app)
      .put(`/api/doctors/${DOCTOR_ID}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message.toLowerCase()).toContain("document");
  });

  it("does not touch the atomic approval transition when the document guard blocks the request", async () => {
    currentDocuments = [];

    await request(app)
      .put(`/api/doctors/${DOCTOR_ID}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(findOneAndUpdateCalls).toBe(0);
  });

  it("leaves the doctor's status exactly as it was — no false approval", async () => {
    currentDocuments = [];

    await request(app)
      .put(`/api/doctors/${DOCTOR_ID}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(currentDoctorStatus).toBe("pending");
  });

  it("still approves normally when the pending doctor has at least one uploaded document", async () => {
    currentDocuments = [{ title: "Medical License", fileName: "license.pdf" }];

    const res = await request(app)
      .put(`/api/doctors/${DOCTOR_ID}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(currentDoctorStatus).toBe("approved");
  });
});
