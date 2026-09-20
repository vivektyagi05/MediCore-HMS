// Regression: commandCenterRoutes used `router.use(protect, authorizeRoles, requireApprovedDoctor)`
// and is mounted at /api/doctor BEFORE the onboarding router, so GET/PUT /api/doctor/onboarding
// returned 403 "Your doctor account is not yet approved" to exactly the pending doctors who need it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import commandCenterRoutes from "../routes/doctor/commandCenterRoutes.js";
import practiceRoutes from "../routes/doctor/practiceRoutes.js";
import onboardingRoutes from "../routes/doctor/onboardingRoutes.js";

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
console.log("doctorAccessRouting.test.mjs");

const routeLayers = (router) => router.stack.filter((l) => l.route);
const useLayers = (router) => router.stack.filter((l) => !l.route);
const handlerNames = (layer) => layer.route.stack.map((s) => s.name);

test("commandCenterRoutes has NO path-less router.use (which would shadow /api/doctor/onboarding)", () => {
  assert.deepEqual(useLayers(commandCenterRoutes).map((l) => l.name), []);
});
test("every commandCenter route carries requireApprovedDoctor itself", () => {
  const layers = routeLayers(commandCenterRoutes);
  assert.ok(layers.length >= 2);
  for (const l of layers) assert.ok(handlerNames(l).includes("requireApprovedDoctor"), `${l.route.path} lacks requireApprovedDoctor`);
});
test("onboarding endpoints do NOT require approval (pending doctors must reach them)", () => {
  const layers = routeLayers(onboardingRoutes);
  assert.ok(layers.length >= 3);
  for (const l of layers) assert.ok(!handlerNames(l).includes("requireApprovedDoctor"), `${l.route.path}`);
  assert.ok(useLayers(onboardingRoutes).every((l) => !/requireApprovedDoctor/.test(l.name)));
});
test("profile + verification + documents stay reachable while pending; analytics is approved-only", () => {
  const byPath = Object.fromEntries(routeLayers(practiceRoutes).map((l) => [`${Object.keys(l.route.methods)[0]} ${l.route.path}`, handlerNames(l)]));
  assert.ok(!byPath["get /practice/professional-profile"].includes("requireApprovedDoctor"));
  assert.ok(!byPath["patch /practice/professional-profile"].includes("requireApprovedDoctor"));
  assert.ok(!byPath["get /practice/verification"].includes("requireApprovedDoctor"));
  assert.ok(byPath["get /practice/analytics"].includes("requireApprovedDoctor"));
});
test("requireApprovedDoctor was not removed globally (clinical routes still gated)", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes");
  const all = ["doctorRoutes.js", "doctor/workflowRoutes.js"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  assert.ok((all.match(/requireApprovedDoctor/g) || []).length >= 10);
});
if (failed) process.exit(1);
console.log("Doctor access routing: PASS");
