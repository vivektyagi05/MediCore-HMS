// Regression: Mongoose 9 removed the callback `next` for document middleware.
// `pre("validate", function (next) { ...; next(); })` threw "next is not a function"
// on every create()/save()/insertMany() — for MasterData, Invoice and AutomationRunLog.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MasterData from "../models/MasterData.js";
import Invoice from "../models/Invoice.js";
import AutomationRunLog from "../models/AutomationRunLog.js";

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
console.log("mongooseHookCompatibility.test.mjs");

await test("MasterData validates, trims and normalizes without a DB (no `next` callback)", async () => {
  const doc = new MasterData({ kind: "city", name: "  Jaipur  ", parentId: new MasterData()._id, source: "lgd" });
  await doc.validate();
  assert.equal(doc.name, "Jaipur"); assert.equal(doc.normalizedName, "jaipur");
});
await test("Invoice linkage hook fails validation via throw, not next(err)", async () => {
  const bad = new Invoice({});
  await assert.rejects(bad.validate(), /payment\+appointment or a subscription|Invoice/);
});
await test("AutomationRunLog exactly-one-source hook fails via throw", async () => {
  const bad = new AutomationRunLog({});
  await assert.rejects(bad.validate(), /exactly one of flowId or processDefinitionId/);
});
await test("no model in the repo still declares a callback-style pre hook `(next)`", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models");
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && /\.pre\([^)]*function\s*\w*\s*\(\s*next\s*\)/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(offenders, []);
});
if (failed) process.exit(1);
console.log("Mongoose hook compatibility: PASS");
