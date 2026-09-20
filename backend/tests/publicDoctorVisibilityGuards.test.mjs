// Source guards for the public doctor-visibility audit (behavioural equivalents run live in
// scripts/runtime-verification/visibility.mjs + related.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
console.log("publicDoctorVisibilityGuards.test.mjs");

test("GET /api/doctors (unauthenticated) never exposes the doctor account email", () => {
  const s = read("controllers/doctorController.js");
  const getDoctors = s.slice(s.indexOf("export const getDoctors"), s.indexOf("export const getDoctors") + 2200);
  assert.match(getDoctors, /populate\("userId", "name role isActive"\)/);
  assert.doesNotMatch(getDoctors, /populate\("userId"[^)]*email/);
});
test("AI smart search only suggests approved + verified + active doctors of active doctor accounts", () => {
  const s = read("controllers/aiController.js");
  const fn = s.slice(s.indexOf("export const smartSearch"), s.indexOf("export const chatbotReply"));
  assert.match(fn, /isVerified: true/); assert.match(fn, /verificationStatus: "approved"/); assert.match(fn, /isActive: true/);
  assert.match(fn, /role: "doctor", isActive: true/);
  assert.doesNotMatch(fn, /populate\("userId", "name email"\)/);
});
test("next-available refuses unpublished doctors (non-admin)", () => {
  const s = read("controllers/appointmentController.js");
  const fn = s.slice(s.indexOf("export const getNextAvailableSlot"), s.indexOf("export const getNextAvailableSlot") + 1500);
  assert.match(fn, /not approved for appointments/); assert.match(fn, /SUPER_ADMIN/);
});
test("createAppointment + available-slots independently verify publication eligibility", () => {
  const s = read("controllers/appointmentController.js");
  assert.ok((s.match(/Doctor is not approved for appointments/g) || []).length >= 3);
});
test("public serializers require approved AND isVerified AND isActive for related doctors, and the populate selects those fields", () => {
  for (const f of ["services/servicePublicSerializer.js", "services/articlePublicSerializer.js"]) {
    const s = read(f);
    assert.match(s, /verificationStatus === "approved" && doctor\?\.isVerified === true && doctor\?\.isActive === true/);
  }
  const pc = read("controllers/publicController.js");
  assert.ok((pc.match(/verificationStatus isVerified isActive verifiedAt/g) || []).length >= 2);
});
test("every public doctor surface in publicController goes through publicDoctorFilter", () => {
  const s = read("controllers/publicController.js");
  const publicFns = ["getDoctorPublicProfile", "getDoctorPublicReviews", "getSimilarDoctors", "compareDoctors", "getPublicDoctorAvailability", "getPublicNextAvailability", "searchDoctors", "getFeaturedDoctors", "getPublicTestimonials", "getHomeStats"];
  for (const fn of publicFns) {
    const i = s.indexOf(`export const ${fn}`); assert.ok(i >= 0, fn);
    const body = s.slice(i, s.indexOf("\nexport const ", i + 10) > 0 ? s.indexOf("\nexport const ", i + 10) : undefined);
    assert.match(body, /publicDoctorFilter|PUBLIC_DOCTOR_BASE|baseFilter/, `${fn} lacks the public doctor filter`);
  }
});
test("search-meta facet lists only values of publicly bookable doctors (not a 500-row master slice)", () => {
  const s = read("controllers/publicController.js");
  const fn = s.slice(s.indexOf("export const getSearchMeta"), s.indexOf("// ─── Public Doctor Search"));
  assert.match(fn, /Doctor\.distinct\("city", baseFilter\)/); assert.doesNotMatch(fn, /kind: MASTER_KINDS\.CITY/);
});
if (failed) process.exit(1);
console.log("Public doctor visibility guards: PASS");
