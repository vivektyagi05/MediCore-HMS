// S6 / A-11: admin access to patient workspace and report/prescription downloads is audited with ids only; a failing
// audit write never blocks the response; missing records are not logged.
import assert from "assert";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import Payment from "../models/Payment.js";
import Insurance from "../models/Insurance.js";
import MedicalReport from "../models/MedicalReport.js";
import Prescription from "../models/Prescription.js";
import FamilyMember from "../models/FamilyMember.js";
import AdminActivityLog from "../models/AdminActivityLog.js";
import { getPatientWorkspaceAdmin, downloadPatientReportAdmin, downloadPatientPrescriptionAdmin } from "../controllers/admin/patientAdminController.js";
import { callHandler, fakeQuery } from "./helpers/miniMongo.mjs";

const models = { User, Appointment, Payment, Insurance, MedicalReport, Prescription, FamilyMember, AdminActivityLog };
const saved = Object.fromEntries(Object.entries(models).map(([k, m]) => [k, { find: m.find, findOne: m.findOne, findById: m.findById, create: m.create }]));
const admin = { _id: "a1", role: "super_admin" };
const PID = "64b000000000000000000001";
const thisFile = fileURLToPath(import.meta.url);
const logs = []; let failLog = false;
AdminActivityLog.create = async (doc) => { if (failLog) throw new Error("log down"); logs.push(doc); return doc; };

try {
  const patient = { _id: PID, name: "Secret Name", email: "secret@x.io", role: "patient", isActive: true, patientProfile: { allergies: ["penicillin"] } };
  User.findOne = () => { const q = { select: () => q, lean: async () => patient, then: (r, j) => Promise.resolve(patient).then(r, j) }; return q; };
  for (const M of [Appointment, Payment, Insurance, MedicalReport, Prescription, FamilyMember]) M.find = () => fakeQuery([], {}, {});
  const ws = await callHandler(getPatientWorkspaceAdmin, { params: { id: PID }, user: admin });
  assert.ifError(ws.error);
  assert.strictEqual(logs.length, 1);
  assert.deepStrictEqual([logs[0].action, logs[0].resourceType, String(logs[0].resourceId), String(logs[0].actorId)], ["patient.phi_view", "Patient", PID, "a1"]);
  assert(!/Secret Name|secret@x\.io|penicillin/.test(JSON.stringify(logs[0])), "no PHI in the audit entry");
  console.log("PASS: workspace view is audited (ids only)");

  failLog = true;
  const ws2 = await callHandler(getPatientWorkspaceAdmin, { params: { id: PID }, user: admin });
  assert.ifError(ws2.error);
  assert.strictEqual(ws2.res.statusCode, 200);
  failLog = false;
  console.log("PASS: audit write failure does not block the workspace");

  logs.length = 0;
  const report = { _id: "r1", userId: PID, title: "HIV panel", fileName: "hiv.pdf", filePath: thisFile };
  MedicalReport.findById = () => ({ lean: async () => report });
  const dl = []; const res = { download: (p, n) => dl.push([p, n]) };
  const direct = downloadPatientReportAdmin({ params: { reportId: "r1" }, user: admin, ip: "1.1.1.1" }, res, (e) => { throw e; });
  await direct;
  assert.strictEqual(dl.length, 1);
  const reportLog = logs.filter((l) => l.action === "patient.report_download").at(-1);
  assert.deepStrictEqual([reportLog.resourceType, reportLog.resourceId], ["MedicalReport", "r1"]);
  assert.deepStrictEqual(reportLog.metadata, { patientId: PID });
  assert(!/HIV|hiv\.pdf/.test(JSON.stringify(reportLog)), "no title/file name in the audit entry");
  console.log("PASS: report download audited with ids only");

  failLog = true; dl.length = 0;
  await downloadPatientReportAdmin({ params: { reportId: "r1" }, user: admin }, res, (e) => { throw e; });
  assert.strictEqual(dl.length, 1, "download still served when audit write fails");
  failLog = false;

  const before = logs.length;
  MedicalReport.findById = () => ({ lean: async () => null });
  Prescription.findById = () => ({ lean: async () => null });
  assert.strictEqual((await callHandler(downloadPatientReportAdmin, { params: { reportId: "x" }, user: admin })).error.statusCode, 404);
  assert.strictEqual((await callHandler(downloadPatientPrescriptionAdmin, { params: { prescriptionId: "x" }, user: admin })).error.statusCode, 404);
  Prescription.findById = () => ({ lean: async () => ({ _id: "p1", patientId: PID }) });
  assert.strictEqual((await callHandler(downloadPatientPrescriptionAdmin, { params: { prescriptionId: "p1" }, user: admin })).error.statusCode, 404, "no PDF on file");
  assert.strictEqual(logs.length, before, "404s are not logged as accesses");
  console.log("PASS: missing records / no PDF are not logged; failures never block");
} finally {
  for (const [k, m] of Object.entries(models)) Object.assign(m, saved[k]);
}
