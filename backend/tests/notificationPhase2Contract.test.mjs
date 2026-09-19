import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backendRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../", import.meta.url);
const read = (file) => readFileSync(new URL(file, backendRoot), "utf8");
const readRepo = (file) => readFileSync(new URL(file, repoRoot), "utf8");

const emitter = read("realtime/notificationEmitter.js");
const auth = read("controllers/authController.js");
const onboarding = read("controllers/doctorOnboardingController.js");
const practice = read("realtime/practiceEmitter.js");
const model = read("models/NotificationDelivery.js");
const context = readRepo("src/context/RealtimeContext.jsx");
const liveCenter = readRepo("src/components/realtime/LiveNotificationCenter.jsx");
const accessControl = readRepo("src/pages/admin/AdminAccessControl.jsx");
const actionLibrary = read("automation-studio/actionLibrary.js");

assert.match(auth, /emailService\.sendNewUserAdminNotification/);
assert.match(auth, /userName:\s*user\.name/);
assert.match(auth, /userEmail:\s*user\.email/);
assert.match(auth, /userRole:\s*user\.role/);
assert.match(auth, /eventKey:\s*`user-registration:\$\{user\._id\}`/);

assert.match(onboarding, /eventKey:\s*`doctor-application:\$\{doctor\._id\}:\$\{getVerificationCycleId\(doctor\)\}`/);
assert.match(onboarding, /action:\s*\{\s*to:\s*"\/admin\/doctors"\s*\}/);

assert.match(practice, /buildVerificationEventKey/);
assert.match(practice, /buildVerificationEventKey\(\{ doctorId, cycleId: cycleId\?\.toString\(\), status \}\)/);
assert.match(emitter, /unique \(recipientId,eventKey\) index is the final idempotency guard/);
assert.match(emitter, /if \(!created\) return notification;/);
assert.match(model, /notificationDeliverySchema\.index\(\{ eventKey: 1, recipientId: 1 \}, \{ unique: true, sparse: true \}\)/);

assert.match(context, /notificationIdsRef/);
assert.match(context, /if \(isNew\)/);
assert.match(context, /activeSocket\.on\(SOCKET_EVENTS\.NOTIFICATION_NEW, onNotification\)/);
assert.match(context, /activeSocket\.off\(SOCKET_EVENTS\.NOTIFICATION_NEW, onNotification\)/);
assert.match(context, /loadNotifications\(\);/);

assert.match(liveCenter, /fixed left-1\/2 top-3/);
assert.match(liveCenter, /Dismiss notification announcement/);

assert.doesNotMatch(accessControl, /receptionist/);
assert.doesNotMatch(actionLibrary, /"receptionist"/);
assert.doesNotMatch(actionLibrary, /"admin",\s*"doctor"/);

console.log("PASS notificationPhase2Contract.test.mjs");
