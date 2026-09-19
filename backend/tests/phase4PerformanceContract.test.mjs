import assert from "node:assert/strict";
import fs from "node:fs";

const realtime = fs.readFileSync("src/context/RealtimeContext.jsx", "utf8");
const adminDoctors = fs.readFileSync("backend/controllers/admin/doctorAdminController.js", "utf8");
const publicController = fs.readFileSync("backend/controllers/publicController.js", "utf8");

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
