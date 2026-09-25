// Regression test for a real circular-import TDZ crash uncovered while
// adding automation/cronJobs.js's CLI entrypoint (SCHEDULER-ARCHITECTURE.md):
// workflow/assignment/{assignmentEngine,assignmentScheduler}.js used to
// destructure `_internal` from operationsAdminController.js at module TOP
// LEVEL. operationsAdminController.js is reached through more than one
// import path in this graph; when the process entry point was one of the
// files that imports assignmentScheduler.js/assignmentEngine.js BEFORE
// operationsAdminController.js's own module body finished running,
// `_internal` (its last export) was still in the temporal dead zone, and
// simply importing the module crashed with "Cannot access '_internal'
// before initialization" -- before any of its exported functions were even
// called. This reproduced for real via `node automation/cronJobs.js`, the
// exact command docs/SCHEDULER-ARCHITECTURE.md tells an operator to
// schedule, and would have made every scheduled reminder/AI-insight/
// assignment-sweep run crash on startup in production.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.log("assignmentEngineCircularImport.test.mjs");
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── the real repro: importing the module that failed before ─────────────
const probe = (entryFile) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.env.MONGO_URI = "mongodb://localhost:27017/hms_test";
    process.env.JWT_SECRET = "test_secret_for_ci_only_not_real_do_not_use_1234";
    await import("${entryFile}");
    console.log("IMPORT_OK");
  `], { cwd: backendDir, encoding: "utf8", timeout: 8000 });

for (const entry of ["./automation/cronJobs.js", "./workflow/assignment/assignmentScheduler.js", "./workflow/assignment/assignmentEngine.js"]) {
  const result = probe(entry);
  assert.ok(result.stdout.includes("IMPORT_OK"), `importing ${entry} must not crash with a TDZ error: ${result.stdout}${result.stderr}`);
  assert.ok(!/before initialization/.test(result.stderr), `${entry}: ${result.stderr}`);
}
console.log("PASS: importing automation/cronJobs.js, assignmentScheduler.js, and assignmentEngine.js standalone no longer crashes with a TDZ error");

// ── source-level: _internal must be accessed at call time, never destructured at load time ──
for (const file of ["workflow/assignment/assignmentEngine.js", "workflow/assignment/assignmentScheduler.js"]) {
  const src = fs.readFileSync(path.join(backendDir, file), "utf8");
  assert.doesNotMatch(src, /const \{[^}]*\} = _internal;/, `${file} must not destructure _internal at module load time`);
  assert.match(src, /_internal\.(buildUnifiedQueue|findOperationItem)\(/, `${file} must still call through _internal at call time`);
}
console.log("PASS: _internal's functions are read at call time, not destructured at module load time, in both files");
