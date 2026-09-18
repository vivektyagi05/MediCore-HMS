// PHASE 2-D — Regression test for the reported production failure:
//
//   PUT /api/doctors/:id/approve -> 500
//   TypeError: Cannot read properties of undefined (reading 'notes')
//   doctorController.js:656
//
// Root cause (see backend/app.js sanitizeRequest and doctorController.js
// approveDoctor comments): express.json() only populates req.body when the
// request carries a body-shaped Content-Type header. A PUT request that
// omits it entirely — no data, no explicit header, exactly what a bare
// `apiClient.put(url)` call with nothing to send produces in several client
// configurations, and exactly what this test sends — reached the controller
// with req.body === undefined, not {}.
//
// This test exercises the REAL Express app (real app.js, real middleware
// order, real doctorRoutes registration, real authMiddleware/roleMiddleware,
// real approveDoctor controller) over real HTTP via supertest. The only
// things replaced are the two Mongoose models approveDoctor touches
// directly and unguarded (Doctor, User) — every other side effect on the
// approve path (practiceEmitter, emailService, emitAutomationTrigger) is
// already wrapped in its own try/catch in the real code and is left
// untouched here; without a real Brevo/DB config those calls fail safely
// and are logged, exactly as they would in a real deployment missing that
// config.
//
// This intentionally does NOT stand in for the full live E2E (real MongoDB,
// real Brevo, real browser) the task asked for — that could not be run in
// this sandbox (no local mongod; mongodb-memory-server's binary download is
// blocked by network egress rules here). This is the code-level half of
// "reproduce before fixing, then regression-test."

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

// Fail fast instead of hanging for ~10s on any *other* model this request
// path touches indirectly (AutomationFlow, notifications, etc.) that isn't
// mocked here — those calls are already wrapped in try/catch in the real
// code, so a fast rejection is exactly as safe as a slow one, just faster.
mongoose.set("bufferCommands", false);

const ADMIN_ID = new mongoose.Types.ObjectId();
const DOCTOR_USER_ID = new mongoose.Types.ObjectId();
const DOCTOR_ID = new mongoose.Types.ObjectId();

let currentDoctorStatus = "pending";

// A minimal stand-in for a Mongoose query: awaitable directly, and
// chainable through .select()/.lean() the way the real controller and
// authMiddleware use it.
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
        return fakeQuery({
          _id: ADMIN_ID,
          role: "super_admin",
          isActive: true,
          securityVersion: 0,
        });
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
      fakeQuery(
        currentDoctorStatus === null
          ? null
          : {
              _id: DOCTOR_ID,
              userId: DOCTOR_USER_ID,
              verificationStatus: currentDoctorStatus,
              specialization: "Cardiology",
            },
      ),
    findOneAndUpdate: (filter) => {
      if (filter.verificationStatus !== currentDoctorStatus) return Promise.resolve(null);
      currentDoctorStatus = "approved";
      return Promise.resolve({
        _id: DOCTOR_ID,
        userId: DOCTOR_USER_ID,
        verificationStatus: "approved",
        specialization: "Cardiology",
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
});

describe("PUT /api/doctors/:id/approve — request-body contract", () => {
  it("reproduces the exact failure mode: no Content-Type / no body at all must NOT 500", async () => {
    // supertest's .put(url) with no .send() sends no body and no
    // Content-Type header — this is the exact request shape that crashed
    // in production.
    const res = await request(app)
      .put(`/api/doctors/${DOCTOR_ID}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("still works normally when a real JSON body with notes is sent", async () => {
    const res = await request(app)
      .put(`/api/doctors/${DOCTOR_ID}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: "Looks good" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("still returns a controlled 404 for a doctor that does not exist (not the undefined-body crash)", async () => {
    currentDoctorStatus = null;
    const res = await request(app)
      .put(`/api/doctors/${new mongoose.Types.ObjectId()}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("rejects without authentication (RBAC still enforced)", async () => {
    const res = await request(app).put(`/api/doctors/${DOCTOR_ID}/approve`);
    expect(res.status).toBe(401);
  });
});
