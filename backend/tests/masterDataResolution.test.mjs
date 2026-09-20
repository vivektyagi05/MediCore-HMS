// resolveDoctorMasterData / listMasterData behaviour with an in-memory MasterData
// (same stubbed-model style as chatAuthorization.test.mjs; real-DB equivalents live in
// scripts/runtime-verification/location.mjs).
import assert from "node:assert/strict";
import mongoose from "mongoose";
import MasterData from "../models/MasterData.js";
import { resolveDoctorMasterData, listMasterData } from "../services/masterDataService.js";

const oid = () => new mongoose.Types.ObjectId();
const mk = (kind, name, parentId = null) => ({ _id: oid(), kind, name, normalizedName: name.toLowerCase(), parentId, active: true });
const raj = mk("state", "Rajasthan"), up = mk("state", "Uttar Pradesh");
const jaipurD = mk("district", "Jaipur", raj._id), mathuraD = mk("district", "Mathura", up._id);
const jaipurC = mk("city", "Jaipur", jaipurD._id), mathuraC = mk("city", "Mathura", mathuraD._id);
const cardio = mk("specialization", "Cardiology");
const DB = [raj, up, jaipurD, mathuraD, jaipurC, mathuraC, cardio];
const same = (a, b) => String(a ?? "") === String(b ?? "");
const matches = (doc, f) => Object.entries(f).every(([k, v]) => (k === "_id" || k === "parentId") ? same(doc[k], v) : doc[k] === v);
const chain = (doc) => ({ select: () => chain(doc), lean: async () => doc || null });
MasterData.findOne = (f) => chain(DB.find((d) => matches(d, f)));
MasterData.findById = (id) => chain(DB.find((d) => same(d._id, id)));
MasterData.find = (f) => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => DB.filter((d) => matches(d, f)) }) }) }) });

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
const rejects = (p, status) => assert.rejects(p, (e) => (status ? e.statusCode === status : true));
const base = { specialization: "Cardiology", specializationMasterId: cardio._id, specializationType: "MASTER" };
const loc = (o) => ({ state: raj.name, stateMasterId: raj._id, stateType: "MASTER", district: "Jaipur", districtMasterId: jaipurD._id, districtType: "MASTER", ...o });
console.log("masterDataResolution.test.mjs");

await test("specialization list resolves canonical id", async () => {
  const r = await resolveDoctorMasterData(base, {});
  assert.equal(r.specialization.type, "MASTER"); assert.ok(same(r.specialization.masterId, cardio._id));
});
await test("typed city matching a canonical city of the SELECTED district -> MASTER", async () => {
  const r = await resolveDoctorMasterData(loc({ city: " jaipur ", cityType: "OTHER", cityOther: " jaipur " }), {});
  assert.equal(r.city.type, "MASTER"); assert.ok(same(r.city.masterId, jaipurC._id)); assert.equal(r.city.otherValue, ""); assert.equal(r.city.displayValue, "Jaipur");
});
await test("typed city with no cityType at all is also resolved (text-only contract)", async () => {
  const r = await resolveDoctorMasterData(loc({ city: "Jaipur" }), {});
  assert.equal(r.city.type, "MASTER");
});
await test("typed non-canonical city -> OTHER (cityMasterId null)", async () => {
  const r = await resolveDoctorMasterData(loc({ city: "Sanganer Colony", cityType: "OTHER", cityOther: "Sanganer Colony" }), {});
  assert.equal(r.city.type, "OTHER"); assert.equal(r.city.masterId, null); assert.equal(r.city.otherValue, "Sanganer Colony");
});
await test("city match is scoped by district: 'Mathura' typed under Jaipur stays OTHER (never global)", async () => {
  const r = await resolveDoctorMasterData(loc({ city: "Mathura", cityType: "OTHER", cityOther: "Mathura" }), {});
  assert.equal(r.city.type, "OTHER"); assert.equal(r.city.masterId, null);
});
await test("cross-district canonical city id is rejected (422)", async () => {
  await rejects(resolveDoctorMasterData(loc({ city: "Mathura", cityMasterId: mathuraC._id, cityType: "MASTER" }), {}), 422);
});
await test("district of another state is rejected (422)", async () => {
  await rejects(resolveDoctorMasterData(loc({ districtMasterId: mathuraD._id }), {}), 422);
});
await test("invalid / unknown master ids are rejected (400 / 422)", async () => {
  await rejects(resolveDoctorMasterData({ stateMasterId: "not-an-id", stateType: "MASTER" }, {}), 400);
  await rejects(resolveDoctorMasterData({ stateMasterId: oid(), stateType: "MASTER" }, {}), 422);
});
await test("Other state + Other district + typed city saves as OTHER throughout", async () => {
  const r = await resolveDoctorMasterData({ stateType: "OTHER", stateOther: "Abroad", districtType: "OTHER", districtOther: "Somewhere", city: "Town", cityType: "OTHER", cityOther: "Town" }, {});
  assert.equal(r.state.type, "OTHER"); assert.equal(r.district.type, "OTHER"); assert.equal(r.city.type, "OTHER"); assert.equal(r.city.otherValue, "Town");
});
await test("reset semantics: explicitly blank district/city levels are CLEARED (not merged back / not an error)", async () => {
  const r = await resolveDoctorMasterData({ state: "Uttar Pradesh", stateMasterId: up._id, stateType: "MASTER", state_: 1, district: "", districtMasterId: "", districtType: "", districtOther: "", city: "", cityMasterId: "", cityType: "", cityOther: "" }, {});
  assert.equal(r.state.type, "MASTER"); assert.equal(r.district.displayValue, ""); assert.equal(r.district.masterId, null); assert.equal(r.city.displayValue, ""); assert.equal(r.city.masterId, null);
});
await test("blank specialization is NOT clearable (still required)", async () => {
  await rejects(resolveDoctorMasterData({ specialization: "", specializationMasterId: "", specializationType: "", specializationOther: "" }, {}), 422);
});
await test("listMasterData: district/city require an existing parent of the right kind", async () => {
  await rejects(listMasterData({ kind: "district" }), 400);
  await rejects(listMasterData({ kind: "city" }), 400);
  await rejects(listMasterData({ kind: "district", parentId: "nope" }), 400);
  await rejects(listMasterData({ kind: "district", parentId: jaipurC._id }), 422); // a city is not a state
  await rejects(listMasterData({ kind: "city", parentId: raj._id }), 422);          // a state is not a district
  await rejects(listMasterData({ kind: "state", parentId: raj._id }), 400);
});
await test("listMasterData: correct parent returns only its children (no cross-parent leakage)", async () => {
  const d = await listMasterData({ kind: "district", parentId: raj._id });
  assert.deepEqual(d.map((x) => x.name), ["Jaipur"]);
  const c = await listMasterData({ kind: "city", parentId: jaipurD._id });
  assert.deepEqual(c.map((x) => x.name), ["Jaipur"]);
  assert.equal((await listMasterData({ kind: "state" })).length, 2);
  assert.equal((await listMasterData({ kind: "specialization" })).length, 1);
});
if (failed) process.exit(1);
console.log("MasterData resolution: PASS");
