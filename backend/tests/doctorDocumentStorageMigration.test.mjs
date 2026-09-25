// Regression test for the doctor-documents storage migration: uploads now
// go through storage/storageService.js (fixing the Docker persistent-volume
// mismatch and the raw-filesystem-path leak), never multer's disk storage
// or a client-visible filePath.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.log("doctorDocumentStorageMigration.test.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// ── schema ────────────────────────────────────────────────────────────
const doctorModel = read("models/Doctor.js");
assert.match(doctorModel, /storageKey:\s*\{\s*type:\s*String,\s*required:\s*true\s*\}/);
assert.doesNotMatch(doctorModel, /filePath:\s*\{\s*type:\s*String,\s*required:\s*true\s*\}/, "the old raw-path field must be gone, not just supplemented");
console.log("PASS: Doctor.documents stores an opaque storageKey, not a raw filesystem path");

// ── upload route uses memory storage, not disk ──────────────────────────
const routes = read("routes/doctor/workflowRoutes.js");
assert.match(routes, /storage:\s*multer\.memoryStorage\(\)/);
assert.doesNotMatch(routes, /multer\.diskStorage/);
assert.doesNotMatch(routes, /"storage\/doctor-documents"/, "no cwd-relative path literal must remain");
console.log("PASS: doctor-document uploads use multer memory storage, not disk storage");

// ── controller: upload/delete/list go through storageService, never leak storageKey ─
const controller = read("controllers/doctor/workflowController.js");
const slice = (name, endMarker) => controller.slice(controller.indexOf(`export const ${name}`), endMarker ? controller.indexOf(endMarker) : undefined);

const uploadFn = slice("uploadDoctorDocument", "export const deleteDoctorDocument");
assert.match(uploadFn, /storageService\.upload\(/);
assert.match(uploadFn, /assertValidBufferUpload\(req\.file\)/, "magic-byte validation must still run, against the buffer now");
assert.match(uploadFn, /sanitizeDoctorDocument\(/, "the created document must not be returned raw (storageKey would leak)");

const deleteFn = slice("deleteDoctorDocument", "export const getDoctorDocuments");
assert.match(deleteFn, /status === "verified"/, "a verified document must not be deletable through this endpoint");
assert.match(deleteFn, /storageService\.delete\(storageKey\)/, "delete must remove the actual stored object, not just the DB row");

const listFn = slice("getDoctorDocuments", "export const downloadDoctorDocument");
assert.match(listFn, /\.map\(sanitizeDoctorDocument\)/, "listing must sanitize every document, never return storageKey");

const downloadFn = slice("downloadDoctorDocument", "// ── Certificate Generator");
assert.match(downloadFn, /storageService\.read\(document\.storageKey\)/);
assert.doesNotMatch(downloadFn, /res\.download\(/, "must stream through storageService, not res.download(filePath)");
console.log("PASS: upload validates real bytes, delete removes the stored object and blocks verified docs, list/upload never leak storageKey, download streams through storageService");

// ── admin surfaces also sanitize / migrate off res.download(filePath) ────
const adminController = read("controllers/admin/doctorAdminController.js");
assert.match(adminController, /storageKey: _storageKey, \.\.\.rest/, "doctor-detail admin view must strip storageKey");
const adminDownload = adminController.slice(adminController.indexOf("export const downloadDoctorDocumentAdmin"));
assert.match(adminDownload, /storageService\.read\(document\.storageKey\)/);
assert.doesNotMatch(adminDownload, /res\.download\(document\.filePath,/);

const doctorControllerSrc = read("controllers/doctorController.js");
assert.match(doctorControllerSrc, /storageKey: _storageKey, \.\.\.safeDocument/, "verifyDoctorDocument's response must strip storageKey");
console.log("PASS: admin doctor-detail, admin download, and admin verify-document endpoints all avoid leaking storageKey or a raw disk path");

// ── migration exists and reads the legacy field via the raw driver ──────
const migration = read("migrations/007_doctor_documents_storage_key.js");
assert.match(migration, /Doctor\.collection\.find\(/, "must bypass the Mongoose schema (which no longer declares filePath) to read legacy data");
assert.match(migration, /"documents\.filePath": \{ \$exists: true \}/);
assert.match(migration, /doctor-documents\//);
console.log("PASS: a migration exists to backfill legacy filePath data into storageKey");

// ── the four other upload categories at least fixed the Docker-path bug ──
{
  const src = read("routes/patient/workflowRoutes.js");
  assert.match(src, /localCategoryDir\(category\)/, "patient uploads must resolve against the shared, Docker-volume-matching storage root");
  assert.match(src, /makeStorage\("patient-reports"\)/);
  assert.match(src, /makeStorage\("insurance-documents"\)/);
  assert.doesNotMatch(src, /"storage\/patient-reports"/);
  assert.doesNotMatch(src, /"storage\/insurance-documents"/);
}
for (const [file, category] of [
  ["routes/doctor/practiceRoutes.js", "doctor-profile"],
  ["routes/admin/cmsAdminRoutes.js", "cms"],
]) {
  const src = read(file);
  assert.match(src, new RegExp(`localCategoryDir\\("${category}"\\)`), `${file} (${category}) must resolve against the shared, Docker-volume-matching storage root`);
  assert.doesNotMatch(src, new RegExp(`"storage/${category}"`), `${file} (${category}) must not still use a bare cwd-relative literal`);
}
const appSrc = read("app.js");
assert.match(appSrc, /env\.storage\.localRoot, "doctor-profile"/);
assert.match(appSrc, /env\.storage\.localRoot, "cms"/);
console.log("PASS: the remaining four upload categories and both static mounts resolve against the same Docker-volume-matching storage root");
