// ─────────────────────────────────────────────────────────────────────────
// StorageService — the ONE place file bytes are written, read, checked for
// existence, and deleted. Every upload/download controller must go through
// this instead of calling `fs`/`path` or a vendor SDK directly.
//
// Two drivers, selected by env.storage.driver (config/env.js, guarded at
// production boot by config/productionGuards.js):
//
//   local  -- writes under env.storage.localRoot, an ABSOLUTE path. This
//             fixes the actual deployed-container bug: every upload
//             destination used to be the bare relative string "storage/..."
//             (resolved against process.cwd()). The Docker image's CMD runs
//             `node backend/server.js` from WORKDIR /app, so cwd is /app and
//             uploads landed at /app/storage/* -- while docker-compose.yml's
//             persistent volume is mounted at /app/backend/storage. Every
//             uploaded file was silently written to the ephemeral container
//             layer and lost on the next deploy/restart, even though a
//             persistent volume existed right next to it, unused.
//             env.storage.localRoot resolves relative to this backend
//             directory (see config/env.js), so it already points at
//             /app/backend/storage inside the built image -- the volume's
//             actual mount point.
//
//   s3     -- an S3-compatible bucket (AWS S3, or any S3-compatible
//             endpoint via STORAGE_S3_ENDPOINT). Required in production
//             unless local storage is explicitly confirmed persistent (see
//             productionGuards.js).
//
// Keys are opaque, server-generated identifiers (category/uuid.ext), never
// client-supplied paths -- callers must not accept a filePath/fileUrl from
// the client and hand it to this service.
// ─────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

export class StorageNotFoundError extends Error {
  constructor(key) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageNotFoundError";
    this.key = key;
  }
}

// ── key hygiene ─────────────────────────────────────────────────────────

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/** category e.g. "doctor-documents" | "patient-reports" | "insurance" | "cms" | "doctor-profile" */
export function buildStorageKey(category, originalName = "") {
  if (!SAFE_SEGMENT.test(category)) throw new Error(`Invalid storage category: ${category}`);
  const ext = path.extname(String(originalName)).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${category}/${randomUUID()}${ext.length <= 10 ? ext : ""}`;
}

/** Defence in depth against a key ever escaping its root (path traversal). */
function assertSafeKey(key) {
  const parts = String(key).split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  if (!SAFE_SEGMENT.test(parts[0])) throw new Error(`Invalid storage key category: ${key}`);
  return parts;
}

// ── local driver ────────────────────────────────────────────────────────

const localAbsolutePath = (key) => {
  assertSafeKey(key);
  const resolved = path.resolve(env.storage.localRoot, key);
  if (!resolved.startsWith(path.resolve(env.storage.localRoot) + path.sep)) {
    throw new Error(`Storage key resolved outside the storage root: ${key}`);
  }
  return resolved;
};

/**
 * For upload sites not yet migrated onto storageService.upload()/read() --
 * still using multer.diskStorage() directly. Even those must write under
 * the SAME absolute, Docker-volume-matching root as everything else, not a
 * bare "storage/..." string resolved against process.cwd(). Ensures the
 * directory exists and returns its absolute path.
 */
export function localCategoryDir(category) {
  if (!SAFE_SEGMENT.test(category)) throw new Error(`Invalid storage category: ${category}`);
  const dir = path.resolve(env.storage.localRoot, category);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const localDriver = {
  name: "local",
  async put(key, buffer) {
    const absolute = localAbsolutePath(key);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, buffer);
    return { key, size: buffer.length };
  },
  async get(key) {
    try {
      return await fs.promises.readFile(localAbsolutePath(key));
    } catch (error) {
      if (error.code === "ENOENT") throw new StorageNotFoundError(key);
      throw error;
    }
  },
  async exists(key) {
    try {
      await fs.promises.access(localAbsolutePath(key), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
  async delete(key) {
    try {
      await fs.promises.unlink(localAbsolutePath(key));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  },
  /** Only the local driver can hand back a filesystem path (for res.download/streaming). */
  absolutePathFor(key) {
    return localAbsolutePath(key);
  },
};

// ── S3 driver ───────────────────────────────────────────────────────────

let cachedS3Client = null;
const getS3Client = () => {
  if (!cachedS3Client) {
    cachedS3Client = new S3Client({
      region: env.storage.s3.region || undefined,
      endpoint: env.storage.s3.endpoint || undefined,
      forcePathStyle: env.storage.s3.forcePathStyle || undefined,
      credentials: env.storage.s3.accessKeyId
        ? { accessKeyId: env.storage.s3.accessKeyId, secretAccessKey: env.storage.s3.secretAccessKey }
        : undefined, // falls back to the platform's IAM role
    });
  }
  return cachedS3Client;
};

export const setS3ClientForTesting = (client) => {
  cachedS3Client = client;
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const s3Driver = {
  name: "s3",
  async put(key, buffer, { contentType } = {}) {
    assertSafeKey(key);
    await getS3Client().send(new PutObjectCommand({
      Bucket: env.storage.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      ServerSideEncryption: "AES256",
    }));
    return { key, size: buffer.length };
  },
  async get(key) {
    assertSafeKey(key);
    try {
      const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.storage.s3.bucket, Key: key }));
      return await streamToBuffer(result.Body);
    } catch (error) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) throw new StorageNotFoundError(key);
      throw error;
    }
  },
  async exists(key) {
    assertSafeKey(key);
    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: env.storage.s3.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  },
  async delete(key) {
    assertSafeKey(key);
    await getS3Client().send(new DeleteObjectCommand({ Bucket: env.storage.s3.bucket, Key: key }));
  },
  absolutePathFor() {
    throw new Error("The S3 driver has no local filesystem path; use storageService.get() / a signed URL instead");
  },
};

const driverFor = () => (env.storage.driver === "s3" ? s3Driver : localDriver);

// ── public API ──────────────────────────────────────────────────────────

export const storageService = {
  driverName() {
    return driverFor().name;
  },

  /**
   * @param {string} category  e.g. "patient-reports"
   * @param {Buffer} buffer
   * @param {{ originalName?: string, contentType?: string }} [meta]
   * @returns {Promise<{ key: string, size: number }>}
   */
  async upload(category, buffer, meta = {}) {
    const key = buildStorageKey(category, meta.originalName);
    return driverFor().put(key, buffer, meta);
  },

  /** @returns {Promise<Buffer>} */
  async read(key) {
    return driverFor().get(key);
  },

  /** @returns {Promise<boolean>} */
  async exists(key) {
    return driverFor().exists(key);
  },

  /** Idempotent: deleting an already-gone key is not an error. */
  async delete(key) {
    return driverFor().delete(key);
  },

  /**
   * Local-driver-only escape hatch for res.download()/streaming. Throws on
   * the S3 driver by design -- callers needing S3 delivery must stream
   * storageService.read() through the response instead of asking for a path.
   */
  localAbsolutePathFor(key) {
    return driverFor().absolutePathFor(key);
  },
};
