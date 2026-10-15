// N-007: the one place generated PDFs (invoices, prescriptions, certificates)
// are rendered to bytes, persisted through storageService, and served back.
//
// Why: these used to be written to process.cwd()/storage/... with the raw
// absolute path saved in the DB. In the container cwd is /app, but the
// persistent volume is mounted at /app/backend/storage, so every PDF lived on
// the ephemeral layer and vanished on redeploy. storageService resolves the
// absolute root once (and supports S3), and its writes are atomic.
//
// Reads prefer the storage key; legacy rows that only have pdfPath still work
// (a file that survived is served, nothing is ever deleted or rewritten).
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { storageService, StorageNotFoundError } from "../storage/storageService.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorMiddleware.js";

/** Renders a PDFKit document to a Buffer. `build(doc)` draws; this ends it. */
export const renderPdfBuffer = (build, options = { margin: 48 }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument(options);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

/**
 * Persists PDF bytes. Resolves only after the storage write succeeded
 * (atomic temp+rename locally, PutObject on S3); throws otherwise, so a caller
 * never records a key for a file that does not exist.
 */
export const storePdf = async (category, buffer, fileName) => {
  const { key, size } = await storageService.upload(category, buffer, { originalName: fileName, contentType: "application/pdf" });
  return { key, size };
};

/** Legacy file lookup: the saved path, else the same basename under the storage root. */
const findLegacyFile = (legacyPath, category) => {
  if (!legacyPath) return null;
  if (fs.existsSync(legacyPath)) return legacyPath;
  const candidate = path.join(env.storage.localRoot, category, path.basename(legacyPath));
  return fs.existsSync(candidate) ? candidate : null;
};

/** True when some copy of the document can be served (used for hasPdf flags). */
export const hasStoredPdf = (doc) => Boolean(doc?.pdfStorageKey || doc?.pdfPath);

/**
 * Streams a stored PDF to the client. Authorization MUST already have been
 * enforced by the caller's ownership-scoped query; this only resolves bytes.
 */
export const sendStoredPdf = async (res, { storageKey, legacyPath, legacyCategory, fileName, notFoundMessage = "PDF not found" }) => {
  if (storageKey) {
    try {
      const buffer = await storageService.read(storageKey);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${String(fileName).replace(/[^\w.\- ]/g, "_")}"`);
      res.setHeader("Content-Length", buffer.length);
      res.status(200).end(buffer);
      return;
    } catch (error) {
      if (!(error instanceof StorageNotFoundError)) throw error;
      // fall through to the legacy copy, then 404
    }
  }
  const legacy = findLegacyFile(legacyPath, legacyCategory);
  if (!legacy) throw new AppError(notFoundMessage, 404);
  res.download(legacy, fileName);
};
