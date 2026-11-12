// S4 regression (A-04 stage order, A-05 user allowlist, A-08 tiebreaker) and A-14 query-parameter strictness for the
// admin Doctors list. Structural/stubbed: the real pipeline the controller sends is inspected; actual query results
// need a real MongoDB (tests/mongo) and were verified separately only with an in-memory emulator (see the log).
import assert from "assert";
import Doctor from "../models/Doctor.js";
import { listDoctorsAdmin } from "../controllers/admin/doctorAdminController.js";
import { buildDoctorCountPipeline, buildDoctorListPipeline, DOCTOR_LIST_SORTS, DOCTOR_LIST_USER_FIELDS, resolveDoctorListSort } from "../services/adminDoctorListPipeline.js";
import { queryNumber, queryString } from "../utils/queryParams.js";
import { callHandler } from "./helpers/miniMongo.mjs";

const originalAggregate = Doctor.aggregate;
const stageNames = (pipeline) => pipeline.map((s) => Object.keys(s)[0] + (s.$lookup ? `:${s.$lookup.from}` : ""));
const indexOfStage = (pipeline, name) => stageNames(pipeline).indexOf(name);

try {
  // A-05: allowlist inside the users $lookup; nothing else can come back
  const pipeline = buildDoctorListPipeline({ match: {}, sortKey: "newest", skip: 0, limit: 20 });
  const userLookup = pipeline.find((s) => s.$lookup?.from === "users").$lookup;
  const projectStage = userLookup.pipeline.find((s) => s.$project);
  assert.deepStrictEqual(projectStage.$project, { name: 1, email: 1, isActive: 1, createdAt: 1 });
  assert.deepStrictEqual(Object.keys(DOCTOR_LIST_USER_FIELDS).sort(), ["createdAt", "email", "isActive", "name"]);
  const serialized = JSON.stringify(pipeline);
  for (const forbidden of ["emailVerification", "securityVersion"]) assert(!serialized.includes(forbidden), `${forbidden} is never referenced`);
  assert.deepStrictEqual(pipeline.at(-1), { $project: { appointmentStats: 0, "documents.storageKey": 0 } }, "internal storageKey stripped from list rows");
  const countPipeline = buildDoctorCountPipeline({ match: {}, searchTerm: /x/i });
  assert(countPipeline.find((s) => s.$lookup)?.$lookup.pipeline.some((s) => s.$project), "count pipeline join is projected too");
  console.log("PASS: joined user is an allowlist (no verification hashes/password/securityVersion), storageKey stripped");

  // A-08: _id tiebreaker on every sort, same direction as the primary key
  for (const [key, spec] of Object.entries(DOCTOR_LIST_SORTS)) {
    const entries = Object.entries(spec);
    assert.strictEqual(entries.length, 2, `${key} has a tiebreaker`);
    assert.strictEqual(entries[1][0], "_id");
    assert.strictEqual(entries[1][1], entries[0][1], `${key} tiebreaker direction matches`);
  }
  assert.strictEqual(resolveDoctorListSort("bogus").sortKey, "newest");
  assert.strictEqual(resolveDoctorListSort("constructor").sortKey, "newest", "prototype keys are not sort keys");
  console.log("PASS: every sort ends with _id; unknown sort falls back to newest");

  // A-04: appointment count after paging, except when sorting by activity
  for (const key of ["newest", "rating", "experience", "name_asc"]) {
    const p = buildDoctorListPipeline({ match: {}, sortKey: key, skip: 40, limit: 20 });
    assert(indexOfStage(p, "$lookup:appointments") > indexOfStage(p, "$limit"), `${key}: appointments counted after $limit`);
    assert(indexOfStage(p, "$limit") > indexOfStage(p, "$skip") && indexOfStage(p, "$skip") > indexOfStage(p, "$sort"));
  }
  const activity = buildDoctorListPipeline({ match: {}, sortKey: "activity", skip: 0, limit: 20 });
  assert(indexOfStage(activity, "$lookup:appointments") < indexOfStage(activity, "$sort"), "activity sort needs counts before sorting");
  const searched = buildDoctorListPipeline({ match: {}, searchTerm: /a/i, sortKey: "newest", skip: 0, limit: 20 });
  assert(stageNames(searched).indexOf("$match", 1) < indexOfStage(searched, "$sort"), "search match stays before paging");
  console.log("PASS: appointment counts run after $limit (activity sort excepted); search and user join stay before paging");

  // controller wiring + A-14
  let sent;
  Doctor.aggregate = async (p) => { (sent ||= []).push(p); return p.some((s) => s.$count) ? [{ total: 3 }] : [{ _id: "d1" }]; };
  const ok = await callHandler(listDoctorsAdmin, { query: { sort: "rating", search: "  asha ", page: "2", limit: "5", minRating: "4" } });
  assert.ifError(ok.error);
  assert.strictEqual(ok.res.body.data.pagination.total, 3);
  const listPipeline = sent.find((p) => !p.some((s) => s.$count));
  assert.deepStrictEqual(listPipeline.find((s) => s.$sort).$sort, { rating: -1, _id: -1 });
  assert.strictEqual(listPipeline.find((s) => s.$skip).$skip, 5);
  assert.deepStrictEqual(listPipeline[0].$match.rating, { $gte: 4 });
  console.log("PASS: controller builds the stable-sort pipeline and keeps the response shape");

  sent = undefined;
  for (const query of [{ search: ["a", "b"] }, { city: ["x", "y"] }, { sort: ["rating", "name_asc"] }, { verificationStatus: ["pending", "approved"] }, { minRating: "abc" }, { minRating: "9" }, { search: "x".repeat(300) }]) {
    const bad = await callHandler(listDoctorsAdmin, { query });
    assert.strictEqual(bad.error?.statusCode, 400, `${JSON.stringify(query).slice(0, 60)} -> 400`);
  }
  assert.strictEqual(sent, undefined, "no database work happens for a rejected request");
  console.log("PASS: repeated keys, non-numeric/out-of-range minRating and oversize search are 400, not 500");

  // helper contract
  assert.strictEqual(queryString({ a: "  hi " }, "a"), "hi");
  assert.strictEqual(queryString({ a: "" }, "a"), undefined);
  assert.strictEqual(queryString({}, "a"), undefined);
  assert.throws(() => queryString({ a: ["1"] }, "a"), (e) => e.statusCode === 400);
  assert.throws(() => queryString({ a: { $ne: "x" } }, "a"), (e) => e.statusCode === 400);
  assert.strictEqual(queryNumber({ n: "3.5" }, "n", { min: 0, max: 5 }), 3.5);
  assert.throws(() => queryNumber({ n: "NaN" }, "n"), (e) => e.statusCode === 400);
  console.log("PASS: queryString/queryNumber helpers");
} finally {
  Doctor.aggregate = originalAggregate;
}
