import assert from "node:assert/strict";
import fs from "node:fs";
import mongoose from "mongoose";
import FamilyMember from "../models/FamilyMember.js";
import { FAMILY_MEMBER_WRITABLE_FIELDS, pickFamilyMemberFields } from "../utils/familyMemberFields.js";

console.log("familyMemberOwnership.test.mjs");

// ── allowlist ────────────────────────────────────────────────────────────
const attacker = new mongoose.Types.ObjectId().toString();
const hostile = {
  name: "Asha", relation: "mother", age: "54", gender: "female", bloodGroup: "O+",
  medicalConditions: "diabetes, hypertension",
  emergencyContact: { name: "Ravi", phone: "999", relation: "son", isAdmin: true },
  userId: attacker, isActive: true, _id: attacker, createdAt: "2001-01-01", __v: 9, role: "super_admin",
  $set: { userId: attacker }, "emergencyContact.hack": "x",
};
const picked = pickFamilyMemberFields(hostile);
assert.deepEqual(Object.keys(picked).sort(), [...FAMILY_MEMBER_WRITABLE_FIELDS].sort());
for (const forbidden of ["userId", "isActive", "_id", "createdAt", "__v", "role", "$set", "emergencyContact.hack"]) {
  assert.ok(!(forbidden in picked), `${forbidden} must never be client-writable`);
}
assert.deepEqual(picked.emergencyContact, { name: "Ravi", phone: "999", relation: "son" });
assert.deepEqual(picked.medicalConditions, ["diabetes", "hypertension"]);
assert.equal(picked.age, 54);
console.log("PASS: ownership, lifecycle and internal fields are stripped; nested emergencyContact is allowlisted too");

assert.deepEqual(pickFamilyMemberFields(null), {});
assert.deepEqual(pickFamilyMemberFields([1, 2]), {});
assert.deepEqual(pickFamilyMemberFields("x"), {});
assert.deepEqual(pickFamilyMemberFields({ userId: attacker }), {}, "a body containing only forbidden fields yields an empty patch");
assert.deepEqual(pickFamilyMemberFields({ medicalConditions: [{ $ne: 1 }, "ok", 5] }).medicalConditions, ["ok"], "operator-injection objects in arrays are dropped");
assert.equal(pickFamilyMemberFields({ medicalConditions: Array.from({ length: 200 }, (_, i) => `c${i}`) }).medicalConditions.length, 50);
console.log("PASS: non-object bodies, operator-injection arrays and oversized lists are handled");

// ── the documents that WOULD be written (real model, real casting) ───────
const created = new FamilyMember({ ...pickFamilyMemberFields(hostile), userId: "64b7f0c2a1b2c3d4e5f60718" });
assert.equal(String(created.userId), "64b7f0c2a1b2c3d4e5f60718", "userId comes from the session, never the body");
assert.equal(created.isActive, true);
assert.equal(await created.validate().then(() => undefined), undefined);
console.log("PASS: a document built from an allowlisted body keeps the server-assigned owner");

// ── controller wiring (source-level, since there is no live DB here) ─────
const src = fs.readFileSync(new URL("../controllers/patient/patientWorkflowController.js", import.meta.url), "utf8");
const body = (name) => src.slice(src.indexOf(`export const ${name}`), src.indexOf("});", src.indexOf(`export const ${name}`)) + 3);
const createBody = body("createFamilyMember");
const updateBody = body("updateFamilyMember");
assert.ok(createBody.includes("pickFamilyMemberFields(req.body)") && !/\.\.\.req\.body/.test(createBody), "create must use the allowlist");
assert.ok(updateBody.includes("pickFamilyMemberFields(req.body)"), "update must use the allowlist");
assert.ok(!/findOneAndUpdate\([^)]*,\s*req\.body/.test(updateBody), "update must never pass req.body to the DB");
assert.ok(updateBody.includes("$set: patch"), "update must $set only the picked patch");
assert.ok(updateBody.includes("...ownership(req)"), "update filter must include the session owner");
assert.ok(updateBody.includes("isActive: { $ne: false }"), "a deactivated member must not be editable");
console.log("PASS: create/update handlers use the allowlist, session ownership and $set only");

// ── repo-wide: no unsafe spread of req.body into privileged models ───────
const root = new URL("../", import.meta.url).pathname;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (["node_modules", "tests"].includes(e.name)) return [];
  const full = `${dir}${e.name}`;
  return e.isDirectory() ? walk(`${full}/`) : full.endsWith(".js") ? [full] : [];
});
const privileged = /(User|Doctor|FamilyMember)\.(create|findOneAndUpdate|findByIdAndUpdate|updateOne)\([^;]*(\.\.\.req\.body|,\s*req\.body\s*[,)])/s;
const offenders = walk(root).filter((f) => privileged.test(fs.readFileSync(f, "utf8"))).map((f) => f.replace(root, ""));
assert.deepEqual(offenders, [], `unsafe req.body writes into privileged models: ${offenders.join(", ")}`);
console.log("PASS: no privileged model receives req.body directly anywhere in the backend");

// ── insurance create must not accept workflow-controlled claim fields ────
const insBody = src.slice(src.indexOf("export const createInsurance"), src.indexOf("const assertOwnedInsurance"));
assert.ok(!/\.\.\.req\.body/.test(insBody), "createInsurance must not spread req.body");
for (const forbidden of ["claimStatus", "claimHistory", "claimAmount", "isActive"]) {
  assert.ok(!new RegExp(`${forbidden}:\\s*req\\.body`).test(insBody), `${forbidden} must not be client-settable on create`);
}
console.log("PASS: insurance create cannot forge claim status/history/amount");
