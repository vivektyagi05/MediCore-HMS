import assert from "assert";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// STRUCTURAL test (no MongoDB in this environment): pins the post-commit ordering in
// withdrawalAdminController.applyTransition. Behavioural coverage of the same flow needs
// `npm run test:mongo` against a safe database and is NOT RUN here.
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../controllers/admin/withdrawalAdminController.js"), "utf8");

const commitAt = src.indexOf("if (!withdrawal) {");
const accountingAt = src.indexOf("if (releasing) {\n    await releaseBalance");
const auditAt = src.indexOf("await writeAdminLog({");
const notifyAt = src.indexOf("const doctor = await Doctor.findById(withdrawal.doctorId)");
const respondAt = src.indexOf("res.status(200).json({ success: true, data: { withdrawal }");

assert.ok([commitAt, accountingAt, auditAt, notifyAt, respondAt].every((i) => i > 0), "expected markers present");
assert.ok(commitAt < accountingAt && accountingAt < auditAt, "audit is written after the committed update and balance/ledger accounting");
assert.ok(auditAt < notifyAt, "audit row is written BEFORE any best-effort notification lookup");
assert.ok(notifyAt < respondAt, "notifications run before the response");

// The notification block must be fenced so its failure cannot 500 a committed transition.
const tryAt = src.lastIndexOf("try {", notifyAt);
const catchAt = src.indexOf("} catch (error) {", notifyAt);
assert.ok(tryAt > auditAt && catchAt > notifyAt && catchAt < respondAt, "notification lookups are inside try/catch");
assert.ok(/post-commit notification failed/.test(src), "notification failure is logged, not thrown");
assert.ok(/admin audit write failed/.test(src), "audit write failure is logged, not silently swallowed");
assert.ok(/import \{ logger \} from/.test(src), "logger imported");

console.log("PASS: withdrawal admin post-commit ordering (structural)");
process.exit(0);
