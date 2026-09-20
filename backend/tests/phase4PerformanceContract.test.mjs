import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from this file, not process.cwd(): the suite runs from backend/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const realtime = read("src/context/RealtimeContext.jsx");
const adminDoctors = read("backend/controllers/admin/doctorAdminController.js");
const publicController = read("backend/controllers/publicController.js");

assert.match(realtime, /let initialConnection = true;/);
assert.match(realtime, /if \(initialConnection\) \{/);
assert.match(realtime, /loadNotifications\(\);\s+loadPresence\(\);\s+\}/);
const onConnect = realtime.slice(realtime.indexOf("const onConnect"), realtime.indexOf("const onDisconnect"));
assert.match(onConnect, /if \(initialConnection\)/);
assert.match(onConnect, /loadNotifications\(\);/);
assert.match(onConnect, /loadPresence\(\);/);
assert.match(onConnect, /return;/);

assert.match(adminDoctors, /from: "appointments"/);
assert.match(adminDoctors, /\$count: "count"/);
assert.doesNotMatch(adminDoctors, /as: "appointments"[\s\S]{0,180}\$size: "\$appointments"/);
assert.match(adminDoctors, /const countPipeline = \[\{ \$match: match \}\];/);

const coverage = publicController.slice(
  publicController.indexOf("export const getDoctorCoverage"),
  publicController.indexOf("// P12 discovery availability batch:", publicController.indexOf("export const getDoctorCoverage")),
);
assert.match(coverage, /\$facet:/);
assert.match(coverage, /stateAgg:/);
assert.match(coverage, /districtAgg:/);
assert.match(coverage, /cityAgg:/);
assert.match(coverage, /totalAgg:/);
assert.match(coverage, /coordinateAgg:/);
assert.doesNotMatch(coverage, /Promise\.all\(\[\s*Doctor\.aggregate\([\s\S]*Doctor\.aggregate\(/);

console.log("Phase-4 performance contract: PASS");
