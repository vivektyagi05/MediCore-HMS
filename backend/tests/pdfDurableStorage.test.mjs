// N-007: invoice / prescription / certificate PDFs persist through
// storageService (absolute root, atomic write), with legacy-path compatibility,
// traversal safety and unchanged ownership authorization.
// LEVEL: local-filesystem evidence (real temp dir). S3 driver is covered by the
// existing storage tests; a live bucket is NOT VERIFIED here.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hms-storage-"));
process.env.STORAGE_LOCAL_ROOT = root;
// Set explicitly before importing config/env.js: dotenv does not override an
// existing process.env value, while a .env file may otherwise restore a path.
process.env.INVOICE_STORAGE_DIR = path.join(root, "invoices");

const { env } = await import("../config/env.js");
const { storageService } = await import("../storage/storageService.js");
const { renderPdfBuffer, storePdf, sendStoredPdf, hasStoredPdf } = await import("../services/pdfDocumentStore.js");
const { generateEnterpriseInvoicePDF } = await import("../invoices/generateInvoicePDF.js");
const Invoice = (await import("../models/Invoice.js")).default;
const Doctor = (await import("../models/Doctor.js")).default;
const { downloadInvoice } = await import("../controllers/invoiceController.js");

console.log("pdfDurableStorage.test.mjs");

// ── the path bug: default invoice dir is under the storage root, not cwd ──
assert.equal(env.invoiceStorageDir, path.join(root, "invoices"));
assert.ok(path.isAbsolute(env.invoiceStorageDir));
assert.ok(!env.invoiceStorageDir.startsWith(path.resolve(process.cwd(), "storage")), "must not resolve against process.cwd()");
console.log("PASS: effective invoice directory resolves under STORAGE_LOCAL_ROOT (the volume), never process.cwd()");

// ── rendering + durable write ─────────────────────────────────────────────
const pdf = await renderPdfBuffer((doc) => doc.text("hello"));
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
const stored = await storePdf("invoices", pdf, "INV-1.pdf");
assert.match(stored.key, /^invoices\/[0-9a-f-]{36}\.pdf$/);
assert.ok(await storageService.exists(stored.key));
assert.ok((await storageService.read(stored.key)).equals(pdf));
assert.ok(fs.existsSync(path.join(root, stored.key)), "file is physically under the storage root");
console.log("PASS: PDF persisted via storageService under the root and read back byte-identical");

// ── atomicity: failed write leaves no temp file and never corrupts a valid file
const dir = path.join(root, "invoices");
const before = fs.readdirSync(dir).sort();
const realRename = fs.promises.rename;
fs.promises.rename = async () => { throw new Error("disk full (simulated)"); };
await assert.rejects(() => storePdf("invoices", pdf, "INV-2.pdf"), /disk full/);
fs.promises.rename = realRename;
assert.deepEqual(fs.readdirSync(dir).sort(), before, "no .tmp and no partial file left behind after a failed write");
assert.ok((await storageService.read(stored.key)).equals(pdf), "the previously stored valid invoice is untouched");
console.log("PASS: write failure is surfaced, leaves no partial/temp file and cannot corrupt an existing invoice");

// regenerate => NEW key; old key stays valid until the row is repointed
const regenerated = await storePdf("invoices", pdf, "INV-1.pdf");
assert.notEqual(regenerated.key, stored.key);
assert.ok(await storageService.exists(stored.key) && await storageService.exists(regenerated.key));
console.log("PASS: regeneration writes a new key; the old valid PDF is never overwritten in place");

// ── traversal safety ──────────────────────────────────────────────────────
for (const bad of ["../etc/passwd", "invoices/../../etc/passwd", "/etc/passwd", "invoices//x", "invoices/..", "x"]) {
  await assert.rejects(() => storageService.read(bad), /Invalid storage key|outside/, `key ${bad} must be rejected`);
}
await assert.rejects(() => storePdf("../evil", pdf, "x.pdf"), /Invalid storage category/);
console.log("PASS: path traversal in keys/categories is rejected");

// ── serving: key, missing, legacy ─────────────────────────────────────────
const fakeRes = () => {
  const r = { headers: {}, statusCode: 0, body: null, downloaded: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.end = (b) => { r.body = b; };
  r.download = (p, name) => { r.downloaded = { p, name }; };
  return r;
};
let res = fakeRes();
await sendStoredPdf(res, { storageKey: stored.key, fileName: "INV-1.pdf", legacyCategory: "invoices" });
assert.equal(res.statusCode, 200);
assert.equal(res.headers["Content-Type"], "application/pdf");
assert.ok(res.body.equals(pdf));

await assert.rejects(() => sendStoredPdf(fakeRes(), { storageKey: "invoices/00000000-0000-0000-0000-000000000000.pdf", fileName: "x.pdf", legacyCategory: "invoices" }), (e) => e.statusCode === 404);
await assert.rejects(() => sendStoredPdf(fakeRes(), { fileName: "x.pdf", legacyCategory: "invoices" }), (e) => e.statusCode === 404);

const legacyFile = path.join(root, "legacy-elsewhere.pdf");
fs.writeFileSync(legacyFile, pdf);
res = fakeRes();
await sendStoredPdf(res, { legacyPath: legacyFile, fileName: "old.pdf", legacyCategory: "invoices" });
assert.equal(res.downloaded.p, legacyFile, "legacy raw pdfPath rows still download");
fs.writeFileSync(path.join(dir, "INV-OLD.pdf"), pdf);
res = fakeRes();
await sendStoredPdf(res, { legacyPath: "/app/storage/invoices/INV-OLD.pdf", fileName: "old.pdf", legacyCategory: "invoices" });
assert.equal(res.downloaded.p, path.join(dir, "INV-OLD.pdf"), "a legacy path that moved resolves by basename under the storage root");
assert.equal(hasStoredPdf({ pdfStorageKey: "k" }), true);
assert.equal(hasStoredPdf({ pdfPath: "p" }), true);
assert.equal(hasStoredPdf({}), false);
console.log("PASS: key serving, 404 for missing, legacy pdfPath and moved-legacy-path compatibility, hasPdf flag");

// ── end-to-end generator writes via storage, returns a key ────────────────
const generated = await generateEnterpriseInvoicePDF({
  invoiceNumber: "INV-TEST-1", issuedAt: new Date(), currency: "INR", subtotal: 100, taxAmount: 18, totalAmount: 118,
  hospital: { name: "H", address: "A", gstin: "G", email: "e@x.org", phone: "" },
  patient: { name: "P", email: "p@x.org" }, doctor: { name: "D", specialization: "S" },
  lineItems: [{ description: "Consultation", quantity: 1, total: 100 }],
  paymentId: "507f1f77bcf86cd799439011",
});
assert.ok(generated.key.startsWith("invoices/"));
assert.equal((await storageService.read(generated.key)).subarray(0, 5).toString(), "%PDF-");
console.log("PASS: generateEnterpriseInvoicePDF persists through storageService and returns the key");

// ── authorization unchanged: ownership-scoped lookup, then bytes ──────────
const captured = [];
Invoice.findOne = (filter) => { captured.push(filter); return { lean: async () => (filter.userId === "patientA" || (!filter.userId && !filter.doctorId) ? { invoiceNumber: "INV-A", pdfStorageKey: stored.key } : null) }; };
const call = (user) => downloadInvoice({ params: { id: "507f1f77bcf86cd799439011" }, user }, fakeRes(), (e) => { throw e; });
await call({ _id: "patientA", role: "patient" });
assert.equal(captured.at(-1).userId, "patientA", "a patient's lookup is scoped to their own userId");
await assert.rejects(() => call({ _id: "patientB", role: "patient" }), /Invoice PDF not found/, "another patient gets 404, never the bytes");
Doctor.findOne = () => ({ select: () => ({ lean: async () => ({ _id: "docX" }) }) });
await assert.rejects(() => call({ _id: "uDoc", role: "doctor" }), /not found/i);
assert.equal(captured.at(-1).doctorId, "docX", "a doctor is scoped to their own doctorId");
await call({ _id: "root", role: "super_admin" });
assert.deepEqual(Object.keys(captured.at(-1)), ["_id"], "super_admin is unscoped (unchanged)");
await assert.rejects(() => downloadInvoice({ params: { id: "not-an-id" }, user: { _id: "x", role: "patient" } }, fakeRes(), (e) => { throw e; }), /Invalid invoice id/);
console.log("PASS: invoice download authorization (patient/doctor/admin scoping) is unchanged and enforced before any bytes are read");

fs.rmSync(root, { recursive: true, force: true });
process.exit(0);
