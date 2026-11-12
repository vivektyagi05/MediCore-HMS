import assert from "assert";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import qs from "qs";
import mongoose from "mongoose";
import { rejectRepeatedQuery } from "../middleware/rejectRepeatedQuery.js";
import Prescription from "../models/Prescription.js";
import { INDEX_NAME, findDuplicateActivePrescriptions, run as runMigration013 } from "../migrations/013_prescription_active_uniqueness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "..", rel), "utf8");
const results = { behavioural: 0, structural: 0 };
const behavioural = (name, fn) => { fn(); results.behavioural += 1; };
const structural = (name, fn) => { fn(); results.structural += 1; };

const guard = (query) => { let err; rejectRepeatedQuery({ query }, {}, (e) => { err = e; }); return err; };

// ── D-01 BEHAVIOURAL: the guard against the exact shapes Express' default (qs) parser produces ────────────────
behavioural("operator object", () => {
  const parsed = qs.parse("patientId[$ne]=x&page=1");
  assert.strictEqual(typeof parsed.patientId, "object", "precondition: qs turns bracket syntax into an object");
  const err = guard(parsed);
  assert.ok(err && err.statusCode === 400, "?patientId[$ne]=x must be rejected with 400");
});
behavioural("repeated key / array", () => {
  assert.strictEqual(guard(qs.parse("search=a&search=b"))?.statusCode, 400);
  assert.strictEqual(guard(qs.parse("search[]=a"))?.statusCode, 400);
});
behavioural("normal doctor/appointment queries still pass", () => {
  for (const q of ["page=2&limit=10", "status=consultation_completed,completed,review_eligible&limit=10", "quickDate=today&excludeStatus=cancelled", "attentionOnly=true&patientId=64b000000000000000000001&search=ravi%20k", ""]) {
    assert.strictEqual(guard(qs.parse(q)), undefined, `must pass: ${q}`);
  }
});

// ── D-01 STRUCTURAL: guard is mounted BEFORE the doctor routers and the appointments router ───────────────────
structural("guard mount order in app.js", () => {
  const app = read("app.js");
  const at = (needle) => { const i = app.indexOf(needle); assert.ok(i > 0, `missing: ${needle}`); return i; };
  const doctorGuard = at('app.use("/api/doctor", rejectRepeatedQuery);');
  const apptGuard = at('app.use("/api/appointments", rejectRepeatedQuery);');
  for (const mount of ['app.use("/api/doctor", doctorWorkflowRoutes);', 'app.use("/api/doctor", doctorPracticeRoutes);', 'app.use("/api/doctor", doctorCommandCenterRoutes);', 'app.use("/api/doctor", doctorOnboardingRoutes);']) {
    assert.ok(doctorGuard < at(mount), `doctor guard must precede ${mount}`);
  }
  assert.ok(apptGuard < at('app.use("/api/appointments", appointmentRoutes);'), "appointments guard must precede its router");
});

// ── D-02 BEHAVIOURAL (no DB needed): the real schema declares the partial unique index ─────────────────────────
behavioural("Prescription schema index", () => {
  const entry = Prescription.schema.indexes().find(([, o]) => o.name === INDEX_NAME);
  assert.ok(entry, "uniq_prescription_active_appointment declared on the schema");
  assert.deepStrictEqual(entry[0], { appointmentId: 1 });
  assert.strictEqual(entry[1].unique, true);
  assert.deepStrictEqual(entry[1].partialFilterExpression, { status: "active" }, "only ACTIVE rows are constrained, so a void row never blocks a re-issue");
});
behavioural("migration 013 exports", () => {
  assert.strictEqual(typeof findDuplicateActivePrescriptions, "function");
  assert.strictEqual(typeof runMigration013, "function");
});
structural("npm script for migration 013", () => {
  assert.ok(JSON.parse(read("package.json")).scripts["migrate:prescription-uniqueness"]?.includes("013_prescription_active_uniqueness.js"));
});

// ── D-04 BEHAVIOURAL (offline document, no DB): the validation step updatePrescription now depends on ──────────
const validMedicine = { name: "Paracetamol", dosage: "500 mg", frequency: "BD", duration: "3 days" };
const base = () => new Prescription({ doctorId: new mongoose.Types.ObjectId(), patientId: new mongoose.Types.ObjectId(), appointmentId: new mongoose.Types.ObjectId(), diagnosis: "Viral fever", medicines: [validMedicine] });
await (async () => {
  const ok = base(); ok.set({ diagnosis: "Viral fever, resolving", notes: "Rest" }); await ok.validate();
  const emptyDx = base(); emptyDx.set({ diagnosis: "" });
  await assert.rejects(() => emptyDx.validate(), (e) => e.name === "ValidationError", "an edit that blanks the diagnosis must fail validation BEFORE any PDF/persist");
  const badMed = base(); badMed.set({ medicines: [{ dosage: "x" }] });
  await assert.rejects(() => badMed.validate(), (e) => e.name === "ValidationError", "a medicine without a name must fail validation");
  const badDate = base(); badDate.set({ followUpDate: "not-a-date" });
  await assert.rejects(() => badDate.validate(), (e) => ["ValidationError", "CastError"].includes(e.name));
  results.behavioural += 1;
})();

// ── D-03 / D-04 STRUCTURAL: control-flow ordering inside workflowController (not executed end to end) ─────────
structural("create rollback + update render-before-persist", () => {
  const src = read("controllers/doctor/workflowController.js");
  const sliceOf = (startMarker, endMarker) => { const a = src.indexOf(startMarker); const b = src.indexOf(endMarker, a + 1); assert.ok(a > 0 && b > a, `markers ${startMarker}`); return src.slice(a, b); };

  const create = sliceOf("export const createPrescription = asyncHandler", "// Live pre-submit safety check");
  const tryAt = create.indexOf("try {\n    prescription.pdfStorageKey");
  assert.ok(tryAt > 0 && create.indexOf("Prescription.create(") < tryAt, "PDF step sits in a try block after create");
  assert.ok(create.indexOf("Prescription.deleteOne({ _id: prescription._id })") > tryAt, "failed PDF step rolls back the never-issued row");
  assert.ok(create.indexOf("throw error;") > create.indexOf("deleteOne"), "original error is still surfaced to the caller");
  assert.ok(create.indexOf("upsertHistoryLink(") > create.indexOf("throw error;"), "history link / notification happen only after the PDF succeeded");

  const update = sliceOf("export const updatePrescription = asyncHandler", "export const downloadPrescription");
  const order = ["Prescription.findOne({ _id: req.params.id, doctorId: doctor._id })", "pickPrescriptionEditableFields(req.body)", "prescription.set(edits)", "await prescription.validate()", "createPrescriptionPdf(prescription, appointment)", "await prescription.save()"].map((needle) => { const i = update.indexOf(needle); assert.ok(i >= 0, `missing: ${needle}`); return i; });
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, "ownership -> whitelist -> validate -> render PDF -> persist");
  assert.ok(!/findOneAndUpdate/.test(update), "no more unvalidated-PDF findOneAndUpdate path");
});

console.log(`PASS: doctor slice D1 (${results.behavioural} behavioural groups, ${results.structural} structural groups)`);
process.exit(0);
