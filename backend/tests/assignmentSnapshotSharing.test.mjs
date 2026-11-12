// S9/S10: a recommendation / reassignment request reads the live operations sources ONCE and shares that snapshot between
// "find the item" and "rank candidates" (it used to rebuild the whole queue twice). Results must be identical.
// Also documents why the scheduler sweep is NOT changed: it must re-read the queue after each assignment.
import assert from "assert";
import fs from "fs";
import User from "../models/User.js";
import OnlineSession from "../models/OnlineSession.js";
import HospitalSetting from "../models/HospitalSetting.js";
import OperationAssignment from "../models/OperationAssignment.js";
import AdminActivityLog from "../models/AdminActivityLog.js";
import { _internal } from "../controllers/admin/operationsAdminController.js";
import { getRecommendations, getReassignmentRecommendation } from "../workflow/assignment/assignmentEngine.js";
import { fakeQuery } from "./helpers/miniMongo.mjs";

const saved = { loadAttached: _internal.loadAttachedOperations, ufind: User.find, sfind: OnlineSession.find, hfind: HospitalSetting.findOne, ofind: OperationAssignment.find, afind: AdminActivityLog.find, afagg: AdminActivityLog.aggregate, oagg: OperationAssignment.aggregate };
try {
  const snapshot = [{ id: "doctor_verification:d1", type: "doctor_verification", typeLabel: "Doctor verification", priority: "high", status: "open", assignedTo: null, escalatedTo: null, pinned: false, patient: null, doctor: null, department: "x", sla: { state: "on_track" }, createdAt: new Date() }];
  let loads = 0; let overlayFinds = 0;
  _internal.loadAttachedOperations = async () => { loads++; return snapshot; };
  User.find = () => fakeQuery([], {}, {});
  OnlineSession.find = () => fakeQuery([], {}, {});
  HospitalSetting.findOne = () => ({ select: () => ({ lean: async () => null }) });
  OperationAssignment.find = () => { overlayFinds++; return fakeQuery([], {}, {}); };
  AdminActivityLog.find = () => fakeQuery([], {}, {});
  AdminActivityLog.aggregate = async () => []; OperationAssignment.aggregate = async () => [];

  const rec = await getRecommendations("doctor_verification:d1");
  assert.strictEqual(rec.item.id, "doctor_verification:d1");
  assert.strictEqual(loads, 1, "recommendations load the live snapshot once");
  const re = await getReassignmentRecommendation("doctor_verification:d1");
  assert.strictEqual(loads, 2, "reassignment loads it once too");
  assert.strictEqual(re.item.id, "doctor_verification:d1");
  await assert.rejects(() => getRecommendations("doctor_verification:missing"), (e) => e.statusCode === 404);
  console.log("PASS: one live snapshot per recommendation/reassignment request; unknown key still 404");

  // sweep must keep re-reading: ranking depends on workload that changes after each assignment
  const sweep = fs.readFileSync(new URL("../workflow/assignment/assignmentScheduler.js", import.meta.url), "utf8");
  assert.strictEqual((sweep.match(/rankCandidatesForItem\(item\)/g) || []).length, 2, "sweep ranks with a fresh queue per item (intentional)");
  console.log("PASS: sweep still ranks each item against a fresh queue (workload changes after every assignment)");
} finally {
  _internal.loadAttachedOperations = saved.loadAttached; User.find = saved.ufind; OnlineSession.find = saved.sfind; HospitalSetting.findOne = saved.hfind;
  OperationAssignment.find = saved.ofind; AdminActivityLog.find = saved.afind; AdminActivityLog.aggregate = saved.afagg; OperationAssignment.aggregate = saved.oagg;
}
