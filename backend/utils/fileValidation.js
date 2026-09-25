import fs from "fs";
import { AppError } from "../middleware/errorMiddleware.js";

// SECURITY GAP FOUND: every upload endpoint (patient reports, insurance docs,
// doctor documents) only checked the client-supplied `mimetype` header via
// multer's fileFilter. That header is fully attacker-controlled — any HTTP
// client can label an arbitrary file as "application/pdf" regardless of its
// actual content. This checks the file's real magic bytes on disk AFTER
// multer saves it, as a second, unspoofable layer.
const SIGNATURES = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]], // %PDF
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/jpeg": [
    [0xff, 0xd8, 0xff, 0xdb],
    [0xff, 0xd8, 0xff, 0xe0],
    [0xff, 0xd8, 0xff, 0xe1],
    [0xff, 0xd8, 0xff, 0xee],
  ],
};

const matchesSignature = (buffer, signature) => signature.every((byte, i) => buffer[i] === byte);

/** True only if `buffer`'s real magic bytes match one of the signatures registered for `declaredMimeType`. */
export const bufferMatchesDeclaredType = (buffer, declaredMimeType) => {
  const signatures = SIGNATURES[declaredMimeType];
  if (!signatures || !buffer) return false;
  return signatures.some((signature) => matchesSignature(buffer, signature));
};

// Returns true only if the file's real bytes match ONE of the signatures
// registered for the declared mimetype. Unknown mimetypes (not in SIGNATURES)
// fail closed (return false) rather than being silently accepted.
export const validateFileSignature = (filePath, declaredMimeType) => {
  const signatures = SIGNATURES[declaredMimeType];
  if (!signatures) return false;

  const buffer = Buffer.alloc(8);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }

  return signatures.some((signature) => matchesSignature(buffer, signature));
};

// Validates and deletes the file + throws if it fails — the standard
// post-multer check every upload handler should call before trusting req.file.
export const assertValidUploadOrDelete = (file) => {
  if (!file) return;
  const isValid = validateFileSignature(file.path, file.mimetype);
  if (!isValid) {
    fs.unlink(file.path, () => {});
    throw new AppError("Uploaded file content does not match its declared type", 400);
  }
};

// Same check for a multer memoryStorage() upload (file.buffer, no disk path
// to clean up -- there is nothing on disk yet for a memory-storage upload).
export const assertValidBufferUpload = (file) => {
  if (!file) return;
  if (!bufferMatchesDeclaredType(file.buffer, file.mimetype)) {
    throw new AppError("Uploaded file content does not match its declared type", 400);
  }
};
