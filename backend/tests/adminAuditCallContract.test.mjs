import assert from "assert";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// writeAdminLog's contract is { req, action, resourceType, ... } and it dereferences req.user.
// A call without `req` throws a TypeError, and a call without `resourceType` fails model validation.
// withdrawalAdminController used { actorId, entityType, entityId, details } behind `.catch(() => {})`,
// so no withdrawal action was ever audited. This static scan pins the contract for every call site.
// Entries forwarded through `audit: (entry) => writeAdminLog({ req, ...entry })` must supply
// resourceType from the producing service; those producers are checked explicitly below.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "tests", "scripts", "migrations"]);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full); else if (/\.(js|mjs)$/.test(name)) files.push(full);
  }
};
walk(root);

const balanced = (src, from) => {
  let depth = 1, i = from;
  while (depth && i < src.length) { depth += (src[i] === "{") - (src[i] === "}"); i += 1; }
  return src.slice(from, i);
};

let checked = 0;
const problems = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const match of src.matchAll(/writeAdminLog(?:Safe)?\(\{/g)) {
    const body = balanced(src, match.index + match[0].length);
    const line = src.slice(0, match.index).split("\n").length;
    const rel = path.relative(root, file);
    checked += 1;
    if (!/\breq\b/.test(body)) problems.push(`${rel}:${line} passes no req`);
    if (/\b(entityType|entityId|actorId|details)\s*:/.test(body) && !/metadata\s*:\s*\{[^}]*\b(entityType|entityId|actorId|details)\s*:/.test(body)) {
      problems.push(`${rel}:${line} uses non-contract field names (entityType/entityId/actorId/details)`);
    }
    const spreads = /\.\.\.entry\b/.test(body);
    if (!spreads && !/\bresourceType\b/.test(body)) problems.push(`${rel}:${line} has no resourceType`);
  }
}
assert.ok(checked >= 20, `expected to scan the real call sites, scanned ${checked}`);
assert.deepStrictEqual(problems, [], `writeAdminLog contract violations:\n${problems.join("\n")}`);

// Producers behind the forwarded `audit(entry)` callbacks must set resourceType.
for (const rel of ["payments/captureResolution.js", "payments/reconciliationRepair.js", "services/finance/refundReviewService.js"]) {
  const src = readFileSync(path.join(root, rel), "utf8");
  const calls = [...src.matchAll(/await audit\(\{([^\n]*)\}\)/g)];
  assert.ok(calls.length >= 1, `${rel} has an audit() call`);
  for (const call of calls) assert.ok(/resourceType:/.test(call[1]), `${rel} audit() entry must include resourceType`);
}
console.log(`PASS: writeAdminLog call contract (${checked} call sites scanned)`);
process.exit(0);
