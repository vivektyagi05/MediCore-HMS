import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough";
process.env.JWT_EXPIRES_IN = "7d";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.RATE_LIMIT_MAX = "1000";
process.env.BCRYPT_SALT_ROUNDS = "4";

let app;
let mongoServer;
let adminToken;
let doctorToken;
let patientToken;
let doctorUserId;
let doctorProfileId;
let appointmentId;
let User;
let Doctor;
let generateToken;

const fallbackMongoUri = "mongodb://127.0.0.1:27017/hms_api_test";

const registerUser = async (payload) => {
  const response = await request(app).post("/api/auth/register").send(payload);
  expect(response.status).toBe(201);
  expect(response.body.success).toBe(true);
  expect(response.body.data.user.password).toBeUndefined();
  expect(response.body.data.token).toBeTruthy();
  return response.body.data;
};

const connectToTestDatabase = async () => {
  const configuredMongoUri = process.env.HMS_TEST_MONGO_URI || process.env.MONGO_URI;
  const localMongoUri = configuredMongoUri || fallbackMongoUri;

  try {
    process.env.MONGO_URI = localMongoUri;
    await mongoose.connect(localMongoUri, { serverSelectionTimeoutMS: 2000 });
    await mongoose.connection.db.dropDatabase();
    return;
  } catch (error) {
    await mongoose.disconnect().catch(() => {});

    if (configuredMongoUri) {
      throw error;
    }
  }

  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.db.dropDatabase();
};

beforeAll(async () => {
  await connectToTestDatabase();

  const importedApp = await import("../app.js");
  const importedUser = await import("../models/User.js");
  const importedDoctor = await import("../models/Doctor.js");
  const importedToken = await import("../utils/generateToken.js");
  app = importedApp.default;
  User = importedUser.default;
  Doctor = importedDoctor.default;
  generateToken = importedToken.generateToken;

}, 120000);

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db.dropDatabase();
  }

  await mongoose.disconnect();

  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe("HMS backend API", () => {
  it("registers users and returns safe auth payloads", async () => {
    const adminUser = await User.create({
      name: "Admin User",
      email: "admin@hms.test",
      password: "Password123",
      role: "admin",
    });
    adminToken = generateToken(adminUser);

    const doctor = await registerUser({
      name: "Doctor User",
      email: "doctor@hms.test",
      password: "Password123",
      role: "doctor",
    });

    const patient = await registerUser({
      name: "Patient User",
      email: "patient@hms.test",
      password: "Password123",
      role: "patient",
    });

    doctorToken = doctor.token;
    patientToken = patient.token;
    doctorUserId = doctor.user._id;

    const doctorProfile = await Doctor.findOne({ userId: doctorUserId }).lean();
    expect(doctorProfile).toBeTruthy();
    expect(doctorProfile.specialization).toBe("General Medicine");
  });

  it("logs in with valid credentials", async () => {
    const response = await request(app).post("/api/auth/login").send({
      email: "patient@hms.test",
      password: "Password123",
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe("patient@hms.test");
    expect(response.body.data.user.password).toBeUndefined();
  });

  it("restricts doctor profile creation to admins", async () => {
    const denied = await request(app)
      .post("/api/doctors")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        userId: doctorUserId,
        specialization: "Cardiology",
        experience: 8,
        fees: 1200,
        availability: [{ dayOfWeek: "monday", timeSlots: ["09:00", "10:00"] }],
      });

    expect(denied.status).toBe(403);

    const created = await request(app)
      .post("/api/doctors")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        userId: doctorUserId,
        specialization: "Cardiology",
        experience: 8,
        fees: 1200,
        availability: [{ dayOfWeek: "monday", timeSlots: ["09:00", "10:00"] }],
      });

    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    doctorProfileId = created.body.data._id;
  });

  it("creates appointments only for available slots and blocks double booking", async () => {
    const created = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        doctorId: doctorProfileId,
        date: "2026-06-01",
        timeSlot: "09:00",
        notes: "Routine consultation",
      });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("pending");
    appointmentId = created.body.data._id;

    const conflict = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        doctorId: doctorProfileId,
        date: "2026-06-01",
        timeSlot: "09:00",
      });

    expect(conflict.status).toBe(409);
  });

  it("filters appointments by role and allows doctor status transitions", async () => {
    const doctorList = await request(app)
      .get("/api/appointments")
      .set("Authorization", `Bearer ${doctorToken}`);

    expect(doctorList.status).toBe(200);
    expect(doctorList.body.data.appointments).toHaveLength(1);

    const approved = await request(app)
      .put(`/api/appointments/${appointmentId}/status`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "approved" });

    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("approved");

    const invalidTransition = await request(app)
      .put(`/api/appointments/${appointmentId}/status`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "pending" });

    expect(invalidTransition.status).toBe(400);
  });
});
