// Frontend API boundary: every list a consumer maps over must be an array, even for malformed responses.
import assert from "node:assert/strict";
import fs from "node:fs";

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
console.log("frontendApiContract.test.mjs");

// masterDataApi -> real module with a stubbed axios client
const stubClient = (payload) => ({ get: async () => payload });
const load = async (rel, payload) => {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8").replace('import apiClient from "./axios";', `const apiClient = globalThis.__client;`);
  globalThis.__client = stubClient(payload);
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}#${Math.random()}`);
};
for (const [label, payload] of [["envelope", { data: { success: true, data: [{ _id: "1", name: "A" }] } }], ["undefined data", { data: {} }], ["null", { data: null }], ["object instead of array", { data: { data: { a: 1 } } }], ["html string", { data: "<html>502</html>" }]]) {
  await test(`masterDataApi getStates/getSpecializations/getDistricts/getCities return arrays for: ${label}`, async () => {
    const { masterDataApi } = await load("../../src/api/masterDataApi.js", payload);
    for (const r of [await masterDataApi.getStates(), await masterDataApi.getSpecializations(), await masterDataApi.getDistricts("x"), await masterDataApi.getCities("y")]) assert.ok(Array.isArray(r));
    assert.equal((await masterDataApi.getStates()).length, label === "envelope" ? 1 : 0);
  });
}
await test("masterDataApi.getDistricts()/getCities() with no parent id return [] without a request", async () => {
  const { masterDataApi } = await load("../../src/api/masterDataApi.js", { data: { data: [{ _id: "x" }] } });
  assert.deepEqual(await masterDataApi.getDistricts(""), []); assert.deepEqual(await masterDataApi.getCities(undefined), []);
});
await test("normalizeSearchMeta guarantees arrays for malformed responses (DoctorSearch/Directory cannot .map() undefined)", async () => {
  const src = fs.readFileSync(new URL("../../src/api/publicApi.js", import.meta.url), "utf8").replace('import apiClient from "./axios";', "const apiClient = {};");
  const { normalizeSearchMeta } = await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}#n`);
  for (const bad of [undefined, null, "oops", { cities: {} }, { states: null, specializations: "x" }]) {
    const m = normalizeSearchMeta(bad);
    for (const k of ["specializations", "cities", "states", "districts", "languages", "consultationModes"]) assert.ok(Array.isArray(m[k]), `${k} for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(normalizeSearchMeta({ cities: ["Jaipur"] }).cities, ["Jaipur"]);
});
await test("DoctorSearch maps only guarded arrays", () => {
  const s = fs.readFileSync(new URL("../../src/pages/public/DoctorSearch.jsx", import.meta.url), "utf8");
  assert.match(s, /specializations: Array\.isArray\(specializations\)/); assert.match(s, /states: Array\.isArray\(states\)/);
  assert.match(s, /setDoctors\(res\.data\?\.doctors \|\| \[\]\)/);
});
if (failed) process.exit(1);
console.log("Frontend API contract: PASS");
