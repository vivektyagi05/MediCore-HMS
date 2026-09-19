import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const publicController = read("backend/controllers/publicController.js");
const appointmentController = read("backend/controllers/appointmentController.js");
const doctorSerializer = read("backend/services/doctorPublicSerializer.js");
const serviceSerializer = read("backend/services/servicePublicSerializer.js");
const articleSerializer = read("backend/services/articlePublicSerializer.js");

assert.match(publicController, /role:\s*"doctor"/);
assert.match(publicController, /isActive:\s*true/);
assert.match(publicController, /const publicDoctorFilter =/);
assert.match(publicController, /verificationStatus:\s*"approved"/);
assert.match(publicController, /isVerified:\s*true/);
assert.match(publicController, /const publishedServiceFilter = \{ status: "published", visibility: "public", isActive: true \}/);
assert.match(publicController, /const publishedArticleFilter = \{ status: "published", visibility: "public", isPublished: true \}/);
assert.match(publicController, /getDoctorPublicProfile/);
assert.match(publicController, /getDoctorPublicReviews/);
assert.match(publicController, /getSimilarDoctors/);
assert.match(publicController, /compareDoctors/);
assert.match(appointmentController, /match: \{ role: ROLES\.DOCTOR, isActive: true \}/);
assert.match(appointmentController, /Doctor is not approved for appointments/);
assert.match(serviceSerializer, /doctor\?\.userId\?\.role === "doctor"/);
assert.match(articleSerializer, /doctor\?\.userId\?\.role === "doctor"/);
assert.match(doctorSerializer, /verificationStatus/);

console.log("public visibility contract passed");
