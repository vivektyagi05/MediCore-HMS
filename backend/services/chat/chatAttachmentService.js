// ─────────────────────────────────────────────────────────────────────────
// Chat attachment validation (PURE — no I/O, fully unit-testable).
//
// A user who may SEE a message must not be able to smuggle anything else
// through the upload path, so the decision is made from the file's REAL
// bytes, never from the client-supplied MIME type or extension alone:
//   1. non-empty and within the server-enforced size cap
//   2. magic bytes must identify one of: PNG, JPEG, PDF   (no SVG / HTML / exe)
//   3. the declared MIME type must equal the sniffed type (spoof => reject)
//   4. the extension must belong to the sniffed type, and no segment of the
//      file name may be an executable/script/markup extension (evil.php.png)
//   5. PDFs carrying active-content markers (/JavaScript, /JS, /Launch,
//      /EmbeddedFile, /OpenAction) are rejected — chat is for plain clinical
//      documents; an active PDF is never needed to answer a patient.
// The original file name is reduced to a safe display label; storage keys
// are generated server-side by storageService and never derive from it.
// ─────────────────────────────────────────────────────────────────────────
import path from "path";
import { bufferMatchesDeclaredType } from "../../utils/fileValidation.js";
import { CHAT_ERROR, CHAT_LIMITS, ChatError } from "./chatConstants.js";

const TYPES = Object.freeze({
  "image/png": { extensions: [".png"], kind: "image" },
  "image/jpeg": { extensions: [".jpg", ".jpeg"], kind: "image" },
  "application/pdf": { extensions: [".pdf"], kind: "document" },
});

const DANGEROUS_SEGMENTS = new Set([
  "exe", "dll", "bat", "cmd", "com", "scr", "msi", "ps1", "vbs", "js", "mjs", "jar", "sh", "php", "phtml",
  "html", "htm", "xhtml", "svg", "xml", "swf", "py", "rb", "pl", "app", "apk", "lnk", "hta", "wsf",
]);

const PDF_ACTIVE_CONTENT = [/\/JavaScript/, /\/JS[\s(<]/, /\/Launch/, /\/EmbeddedFile/, /\/OpenAction/];

export const sniffAttachmentMimeType = (buffer) =>
  Object.keys(TYPES).find((mimeType) => bufferMatchesDeclaredType(buffer, mimeType)) || null;

export function sanitizeAttachmentName(originalName, mimeType) {
  const fallback = `attachment${TYPES[mimeType]?.extensions[0] || ""}`;
  const base = path.basename(String(originalName || "").replace(/\\/g, "/"));
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

/**
 * @param {{ originalName?: string, declaredMimeType?: string, buffer?: Buffer, maxBytes?: number }} file
 * @returns {{ mimeType: string, kind: "image"|"document", fileName: string, size: number }}
 * @throws {ChatError}
 */
export function validateChatAttachment({ originalName, declaredMimeType, buffer, maxBytes = CHAT_LIMITS.ATTACHMENT_MAX_BYTES } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ChatError(CHAT_ERROR.ATTACHMENT_INVALID, "The uploaded file is empty");
  }
  if (buffer.length > maxBytes) {
    throw new ChatError(CHAT_ERROR.ATTACHMENT_TOO_LARGE, `Attachments can be at most ${Math.floor(maxBytes / (1024 * 1024))} MB`);
  }

  const sniffed = sniffAttachmentMimeType(buffer);
  if (!sniffed) {
    throw new ChatError(CHAT_ERROR.ATTACHMENT_INVALID, "Only PNG, JPEG images and PDF documents can be sent");
  }
  if (declaredMimeType !== sniffed) {
    throw new ChatError(CHAT_ERROR.ATTACHMENT_INVALID, "The file's content does not match its declared type");
  }

  const rawName = String(originalName || "");
  const segments = path.basename(rawName.replace(/\\/g, "/")).toLowerCase().split(".").slice(1);
  const extension = segments.length ? `.${segments[segments.length - 1]}` : "";
  if (extension && !TYPES[sniffed].extensions.includes(extension)) {
    throw new ChatError(CHAT_ERROR.ATTACHMENT_INVALID, "The file extension does not match the file's content");
  }
  if (segments.some((segment) => DANGEROUS_SEGMENTS.has(segment))) {
    throw new ChatError(CHAT_ERROR.ATTACHMENT_INVALID, "This file name is not allowed");
  }

  if (sniffed === "application/pdf") {
    const text = buffer.toString("latin1");
    if (PDF_ACTIVE_CONTENT.some((pattern) => pattern.test(text))) {
      throw new ChatError(CHAT_ERROR.ATTACHMENT_INVALID, "PDFs containing scripts or embedded files cannot be sent");
    }
  }

  return { mimeType: sniffed, kind: TYPES[sniffed].kind, fileName: sanitizeAttachmentName(rawName, sniffed), size: buffer.length };
}
