// Doctor location form model (shared by DoctorOnboarding + DoctorProfessionalProfile).
import assert from "node:assert/strict";
const u = await import(new URL("../../src/utils/doctorLocation.js", import.meta.url));
const { EMPTY_LOCATION, OTHER_OPTION, changeLevel, setOtherText, locationFromDoctor, buildLocationPayload, selectValueFor, isDistrictChosen } = u;

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
console.log("doctorLocationForm.test.mjs");

const full = { ...EMPTY_LOCATION, state: "Rajasthan", stateMasterId: "S1", stateType: "MASTER", district: "Jaipur", districtMasterId: "D1", districtType: "MASTER", city: "Jaipur", cityMasterId: "C1", cityType: "MASTER" };

test("state change clears district + city (every field, no stale values)", () => {
  const next = changeLevel(full, "state", { id: "S2", name: "Uttar Pradesh" });
  assert.equal(next.stateMasterId, "S2");
  for (const k of ["district", "districtMasterId", "districtType", "districtOther", "city", "cityMasterId", "cityType", "cityOther"]) assert.equal(next[k], "", k);
});
test("district change clears city only", () => {
  const next = changeLevel(full, "district", { id: "D2", name: "Ajmer" });
  assert.equal(next.stateMasterId, "S1"); assert.equal(next.districtMasterId, "D2");
  for (const k of ["city", "cityMasterId", "cityType", "cityOther"]) assert.equal(next[k], "", k);
});
test("choosing 'Other' state clears children and marks OTHER", () => {
  const next = changeLevel(full, "state", OTHER_OPTION);
  assert.equal(next.stateType, "OTHER"); assert.equal(next.stateMasterId, ""); assert.equal(next.districtMasterId, "");
  assert.equal(selectValueFor(next, "state"), OTHER_OPTION);
});
test("selecting the empty option clears the level and below", () => {
  const next = changeLevel(full, "state", "");
  assert.equal(next.stateType, ""); assert.equal(next.districtType, "");
});
test("choosing a canonical city sets MASTER id and clears any typed 'Other' text", () => {
  const next = changeLevel(full, "city", { id: "C2", name: "Sanganer" });
  assert.equal(next.cityMasterId, "C2"); assert.equal(next.cityType, "MASTER"); assert.equal(next.cityOther, "");
});
test("choosing 'Other' city clears the canonical id and marks OTHER", () => {
  const next = changeLevel(full, "city", OTHER_OPTION);
  assert.equal(next.cityType, "OTHER"); assert.equal(next.cityMasterId, "");
  assert.equal(selectValueFor(next, "city"), OTHER_OPTION);
});
test("typing in 'Other' text does not clear children", () => {
  const o = changeLevel(full, "state", OTHER_OPTION);
  const withText = setOtherText({ ...o, districtType: "OTHER", districtOther: "D" }, "state", "Foo");
  assert.equal(withText.stateOther, "Foo"); assert.equal(withText.districtOther, "D");
});
test("schema-default OTHER with nothing stored reads as NOT chosen (no preselected 'Other')", () => {
  const loc = locationFromDoctor({ stateType: "OTHER", stateOther: "", state: "", districtType: "OTHER", cityType: "OTHER" });
  assert.equal(loc.stateType, ""); assert.equal(selectValueFor(loc, "state"), ""); assert.equal(isDistrictChosen(loc), false);
});
test("stored canonical ids/types are restored after reload (persistence)", () => {
  const loc = locationFromDoctor({ state: "Rajasthan", stateMasterId: "S1", stateType: "MASTER", district: "Jaipur", districtMasterId: "D1", districtType: "MASTER", city: "Jaipur", cityMasterId: "C1", cityType: "MASTER" });
  assert.equal(loc.stateMasterId, "S1"); assert.equal(loc.districtMasterId, "D1"); assert.equal(loc.city, "Jaipur"); assert.equal(loc.cityMasterId, "C1"); assert.equal(loc.cityType, "MASTER");
  assert.equal(selectValueFor(loc, "state"), "S1"); assert.equal(selectValueFor(loc, "city"), "C1");
});
test("stored OTHER city is restored as OTHER, not as a display name", () => {
  // The generic OTHER path never trusts the display-name field (it may be the
  // literal string "Other" written by the server) — only cityOther is real.
  const loc = locationFromDoctor({ stateMasterId: "S1", stateType: "MASTER", state: "R", districtMasterId: "D1", districtType: "MASTER", district: "J", cityType: "OTHER", city: "Other", cityOther: "Some Colony" });
  assert.equal(loc.city, ""); assert.equal(loc.cityType, "OTHER"); assert.equal(loc.cityOther, "Some Colony");
  assert.equal(selectValueFor(loc, "city"), OTHER_OPTION);
});
test("payload: canonical state+district+city ids", () => {
  const p = buildLocationPayload(changeLevel(changeLevel(changeLevel(EMPTY_LOCATION, "state", { id: "S1", name: "Rajasthan" }), "district", { id: "D1", name: "Jaipur" }), "city", { id: "C1", name: "Jaipur" }));
  assert.equal(p.stateType, "MASTER"); assert.equal(p.stateMasterId, "S1"); assert.equal(p.districtMasterId, "D1");
  assert.equal(p.cityType, "MASTER"); assert.equal(p.cityMasterId, "C1"); assert.equal(p.cityOther, "");
});
test("payload: cleared levels are sent explicitly blank (server clears stale stored values)", () => {
  const p = buildLocationPayload(changeLevel(full, "state", { id: "S2", name: "Uttar Pradesh" }));
  assert.equal(p.stateMasterId, "S2");
  for (const k of ["district", "districtMasterId", "districtType", "districtOther", "city", "cityMasterId", "cityType", "cityOther"]) assert.equal(p[k], "", k);
});
test("payload: a city selection without a chosen district is never sent", () => {
  const p = buildLocationPayload({ ...EMPTY_LOCATION, cityType: "OTHER", cityOther: "Orphan" });
  assert.equal(p.cityType, ""); assert.equal(p.cityOther, "");
});
test("payload: OTHER state + OTHER district + OTHER (typed) city", () => {
  const p = buildLocationPayload({ ...EMPTY_LOCATION, stateType: "OTHER", stateOther: "Abroad", districtType: "OTHER", districtOther: "Somewhere", cityType: "OTHER", cityOther: "Town" });
  assert.equal(p.stateType, "OTHER"); assert.equal(p.stateOther, "Abroad"); assert.equal(p.districtOther, "Somewhere"); assert.equal(p.cityType, "OTHER"); assert.equal(p.cityOther, "Town");
});
test("payload: canonical district with an explicit OTHER city", () => {
  const p = buildLocationPayload({ ...changeLevel(changeLevel(EMPTY_LOCATION, "state", { id: "S1", name: "Rajasthan" }), "district", { id: "D1", name: "Jaipur" }), cityType: "OTHER", cityOther: "Some Colony" });
  assert.equal(p.districtMasterId, "D1"); assert.equal(p.cityType, "OTHER"); assert.equal(p.cityOther, "Some Colony"); assert.equal(p.cityMasterId, "");
});
test("no geography is hardcoded in the util or the shared component", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../src/utils/doctorLocation.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../../src/components/doctor/DoctorLocationFields.jsx", import.meta.url), "utf8");
  for (const name of ["Rajasthan", "Uttar Pradesh", "Maharashtra", "Jaipur", "Mathura"]) assert.ok(!src.includes(name), name);
});
if (failed) process.exit(1);
console.log("Doctor location form model: PASS");
