// Regression test: automation/cronJobs.js (drives every reminder job, AI
// insights, and the smart assignment sweep) previously had NO standalone
// CLI entrypoint at all -- unlike the other four cron scripts, it could
// only be invoked through the admin on-demand API. Nothing scheduled it, so
// none of its 8 sub-jobs ever ran automatically.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.log("automationCronEntrypoint.test.mjs");
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(backendDir, "automation/cronJobs.js"), "utf8");

assert.match(src, /process\.argv\[1\]\?\.endsWith\("cronJobs\.js"\)/, "must gain the same CLI entrypoint pattern as the other cron scripts");
assert.match(src, /automationCronJobs\.runAll\(\)/);
assert.match(src, /process\.exit\(0\)/);
assert.match(src, /process\.exit\(1\)/);
console.log("PASS: automation/cronJobs.js now has a standalone CLI entrypoint, matching the other four cron scripts");

// The other four scripts all follow the exact same shape -- confirm the new
// one is consistent, not a one-off variant.
for (const file of ["cron/expirePaymentWindows.js", "cron/reconciliationCron.js", "cron/retryFailedPayments.js", "cron/subscriptionRenewals.js"]) {
  const other = fs.readFileSync(path.join(backendDir, file), "utf8");
  assert.match(other, /process\.argv\[1\]\?\.endsWith\("[a-zA-Z]+\.js"\)/);
}
console.log("PASS: the entrypoint pattern matches every other cron script in the repo");

// Documentation exists and actually names every scheduled command.
const docs = fs.readFileSync(path.join(backendDir, "../docs/SCHEDULER-ARCHITECTURE.md"), "utf8");
for (const command of [
  "node cron/expirePaymentWindows.js",
  "node cron/reconciliationCron.js",
  "node cron/retryFailedPayments.js",
  "node cron/subscriptionRenewals.js",
  "node automation/cronJobs.js",
]) {
  assert.ok(docs.includes(command), `SCHEDULER-ARCHITECTURE.md must document the exact command: ${command}`);
}
assert.match(docs, /partial unique index/);
assert.match(docs, /not verified in this environment/i, "must be honest that the platform-side Cron Job configuration itself is unverified here");
console.log("PASS: docs/SCHEDULER-ARCHITECTURE.md documents every scheduled command, the locking mechanism, and is honest about what's unverified");

// Loading the module (without invoking as the CLI entrypoint) must not
// auto-run anything -- process.argv[1] here is this test file, not
// cronJobs.js, so the guard must correctly stay closed.
const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
  process.env.MONGO_URI = "mongodb://localhost:27017/hms_test";
  process.env.JWT_SECRET = "test_secret_for_ci_only_not_real_do_not_use_1234";
  const mod = await import("./automation/cronJobs.js");
  console.log(typeof mod.automationCronJobs.runAll === "function" ? "EXPORT_OK" : "EXPORT_MISSING");
`], { cwd: backendDir, encoding: "utf8", timeout: 5000 });
assert.ok(probe.stdout.includes("EXPORT_OK"), `importing the module must not hang or auto-run runAll(): ${probe.stdout}${probe.stderr}`);
console.log("PASS: importing automation/cronJobs.js as a library (not as the CLI entrypoint) does not auto-run anything");
