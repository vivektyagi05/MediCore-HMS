// Shared client check for uploads, matching the server's multer limits (patient uploads 8 MB, doctor uploads 5 MB) and
// the document types the server accepts. Without it a 40 MB file uploads for a minute and then fails with a generic
// error; an unsupported type is rejected only after the round trip.
export const UPLOAD_LIMITS = Object.freeze({ patientBytes: 8 * 1024 * 1024, doctorBytes: 5 * 1024 * 1024 });
export const DOCUMENT_TYPES = Object.freeze(["application/pdf", "image/png", "image/jpeg"]);

const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** @returns {string} error message, or "" when the file is acceptable (no file => "", callers decide if it is required). */
export const validateUpload = (file, { maxBytes = UPLOAD_LIMITS.patientBytes, types = DOCUMENT_TYPES } = {}) => {
  if (!file) return "";
  if (file.size === 0) return "That file is empty.";
  if (!types.includes(file.type)) return "Choose a PDF, PNG or JPG file.";
  if (file.size > maxBytes) return `That file is larger than ${mb(maxBytes)}.`;
  return "";
};
