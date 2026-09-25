// Regression test: several public/admin search endpoints built a MongoDB
// RegExp directly from unescaped user input (`new RegExp(req.query.x, "i")`).
// That is both a ReDoS vector (a crafted pattern can pin the event loop) and
// a regex-injection vector (metacharacters change what the "search" matches
// instead of being treated as literal text). Every one of these now goes
// through utils/regexSafe.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsRegex, escapeRegex, exactRegex } from "../utils/regexSafe.js";

console.log("publicSearchInjectionSafety.test.mjs");

// ── the helper itself ────────────────────────────────────────────────────
assert.equal(escapeRegex("a.b*c"), "a\\.b\\*c");
assert.equal(escapeRegex(""), "");
assert.equal(escapeRegex(undefined), "");
assert.ok(containsRegex("a.b").test("axb") === false, "escaped '.' must be literal, not 'any character'");
assert.ok(containsRegex("a.b").test("a.b") === true);
assert.ok(exactRegex("cardiology").test("cardiology"));
assert.ok(!exactRegex("cardio").test("cardiology"), "exactRegex must anchor, not just contain");
// The classic ReDoS pattern must be neutralised into a literal string rather
// than compiled as a pattern.
const redos = "(a+)+$";
const start = Date.now();
containsRegex(redos).test("a".repeat(40) + "!");
assert.ok(Date.now() - start < 100, "a would-be catastrophic-backtracking pattern must run as fast literal text");
console.log("PASS: escapeRegex/containsRegex/exactRegex behave correctly and neutralise ReDoS patterns");

// ── static sweep: no remaining unescaped new RegExp(<user input>) anywhere ─
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (["node_modules", "tests"].includes(e.name)) return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
});
// Matches `new RegExp(term, ...)` / `new RegExp(req.query...` etc, but not a
// call whose argument is already escapeRegex(...)/escaped/a hand-inlined
// .replace(/[...]/) sanitizer, and not utils/regexSafe.js itself.
const unsafeCall = /new RegExp\(\s*(?!escapeRegex\()[^,)]*\b(req\.query|term|query\.search|department)\b(?![^,)]*\.replace\()[^,)]*,/;
const offenders = walk(root)
  .filter((f) => !f.endsWith(path.join("utils", "regexSafe.js")))
  .map((f) => ({ f, src: fs.readFileSync(f, "utf8") }))
  .filter(({ src }) => unsafeCall.test(src))
  .map(({ f }) => path.relative(root, f));
assert.deepEqual(offenders, [], `unescaped RegExp built from request input: ${offenders.join(", ")}`);
console.log("PASS: no remaining unescaped RegExp built from request input anywhere in the backend");

// ── the legacy public /api/doctors endpoint no longer leaks raw documents ──
const doctorControllerSrc = fs.readFileSync(path.join(root, "controllers/doctorController.js"), "utf8");
const getDoctorsBody = doctorControllerSrc.slice(
  doctorControllerSrc.indexOf("export const getDoctors ="),
  doctorControllerSrc.indexOf("export const createDoctor"),
);
assert.ok(getDoctorsBody.includes("serializeDoctorPublicProfile"), "getDoctors must serialize its results, never return raw Doctor documents");
assert.ok(getDoctorsBody.includes("containsRegex(req.query.specialization)"), "getDoctors' specialization filter must be escaped");
assert.ok(!/doctors,\s*$/m.test(getDoctorsBody.split("data: {")[1]?.split("pagination")[0] ?? ""), "the raw lean() doctors array must not be sent as-is");
console.log("PASS: the legacy public /api/doctors endpoint serializes its output and escapes its search input");
