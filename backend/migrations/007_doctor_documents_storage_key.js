// One-time backfill for models/Doctor.js's documents[].filePath ->
// documents[].storageKey rename (storage/storageService.js migration).
//
// Any document uploaded before this change has filePath set to a raw
// filesystem path (e.g. "storage/doctor-documents/172...-abc.pdf", itself
// resolved against whatever process.cwd() the server happened to be
// running under at the time -- see the Docker-path-mismatch fix in
// storage/storageService.js). This migration derives the equivalent
// storage key by taking the path from the LAST "doctor-documents" segment
// onward, matching the layout storageService's local driver already uses,
// and copies it into storageKey without moving or re-reading the actual
// file on disk. This is a data-shape fix only: it assumes the physical file
// is still sitting under the local storage root at that same relative
// position; it does NOT migrate a document into S3 (do that as a separate,
// explicit step if switching drivers on a deployment that already has
// uploaded documents).
//
// Uses the raw MongoDB driver (Doctor.collection), not the Mongoose model:
// the schema no longer declares `filePath` at all (it was renamed), so
// reading through the model would silently strip the very field this
// migration needs.
import path from "path";
import { connectDB, disconnectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";

const deriveKey = (filePath) => {
  const normalized = String(filePath).replace(/\\/g, "/");
  const marker = "doctor-documents/";
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  return normalized.slice(index);
};

const run = async () => {
  await connectDB();
  const cursor = Doctor.collection.find(
    { "documents.filePath": { $exists: true } },
    { projection: { documents: 1 } },
  );

  let doctorsScanned = 0;
  let migratedDocs = 0;
  let unresolvable = 0;

  for await (const doctor of cursor) {
    doctorsScanned += 1;
    const updatedDocuments = (doctor.documents || []).map((document) => {
      if (document.storageKey || !document.filePath) return document;
      const key = deriveKey(document.filePath);
      if (!key) {
        unresolvable += 1;
        return document;
      }
      migratedDocs += 1;
      const { filePath: _filePath, ...rest } = document;
      return { ...rest, storageKey: key };
    });
    await Doctor.collection.updateOne({ _id: doctor._id }, { $set: { documents: updatedDocuments } });
  }

  const summary = { doctorsScanned, migratedDocs, unresolvable };
  console.log(JSON.stringify(summary));
  return summary;
};

if (path.basename(process.argv[1] || "") === "007_doctor_documents_storage_key.js") {
  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}

export { run };
