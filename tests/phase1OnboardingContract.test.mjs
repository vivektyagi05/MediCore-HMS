import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync(new URL("../routes/doctor/onboardingRoutes.js", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../controllers/doctorOnboardingController.js", import.meta.url), "utf8");
const auth = fs.readFileSync(new URL("../controllers/authController.js", import.meta.url), "utf8");

assert.ok(routes.includes('authorizeRoles(ROLES.DOCTOR)'));
assert.ok(!routes.includes("requireApprovedDoctor"));
assert.ok(controller.includes('doctor.verificationStatus = "pending"'));
assert.ok(controller.includes('notificationEmitter.emitToRole(ROLES.SUPER_ADMIN'));
assert.ok(controller.includes('emailService.sendNewDoctorApplicationAdminNotification'));
assert.ok(auth.includes("emailVerified: false"));

console.log("phase 1 onboarding contract: PASS");
