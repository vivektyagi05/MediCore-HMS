import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log("storageService.test.mjs");

// env.js reads process.env at import time; point the local driver at a throwaway temp dir.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hms-storage-test-"));
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/hms_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_for_ci_only_not_real_do_not_use_1234";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_ROOT = tmpRoot;

const { storageService, buildStorageKey, StorageNotFoundError, setS3ClientForTesting } = await import("../storage/storageService.js");

// ── key hygiene ──────────────────────────────────────────────────────────
assert.match(buildStorageKey("patient-reports", "scan.pdf"), /^patient-reports\/[0-9a-f-]+\.pdf$/);
assert.match(buildStorageKey("cms", "no-extension"), /^cms\/[0-9a-f-]+$/);
assert.throws(() => buildStorageKey("../escape", "x"), /Invalid storage category/);
console.log("PASS: storage keys are opaque, category-scoped, and reject an unsafe category");

// ── local driver round-trip ──────────────────────────────────────────────
assert.equal(storageService.driverName(), "local");
const { key } = await storageService.upload("doctor-documents", Buffer.from("hello world"), { originalName: "license.pdf" });
assert.match(key, /^doctor-documents\/[0-9a-f-]+\.pdf$/);
assert.equal(await storageService.exists(key), true);
assert.equal((await storageService.read(key)).toString(), "hello world");

// the file must actually land under the resolved root, not cwd
const onDisk = fs.readFileSync(path.join(tmpRoot, key), "utf8");
assert.equal(onDisk, "hello world");
console.log("PASS: local driver writes under the configured absolute root, not process.cwd()");

await storageService.delete(key);
assert.equal(await storageService.exists(key), false);
await assert.rejects(() => storageService.read(key), StorageNotFoundError);
// deleting an already-gone key is not an error (idempotent delete)
await storageService.delete(key);
console.log("PASS: delete removes the object, is idempotent, and read()/exists() reflect it honestly");

// ── path traversal is rejected ───────────────────────────────────────────
for (const evil of ["../../etc/passwd", "doctor-documents/../../../etc/passwd", "doctor-documents/../secret", ""]) {
  await assert.rejects(() => storageService.read(evil), /Invalid storage key/);
}
console.log("PASS: a key that would escape the storage root is rejected, never resolved on disk");

// ── the local driver's escape hatch stays inside the root ───────────────
const { key: key2 } = await storageService.upload("cms", Buffer.from("banner"));
const absolute = storageService.localAbsolutePathFor(key2);
assert.ok(absolute.startsWith(path.resolve(tmpRoot) + path.sep));
await storageService.delete(key2);

// ── S3 driver: exercised through an injected fake client (no network) ───
// env.js reads process.env once at import and freezes; to select the S3
// driver we need a FRESH process (this mirrors reality -- driver selection
// happens once per process boot, same as any real deployment).
const s3ProbeScript = `
  process.env.STORAGE_DRIVER = "s3";
  process.env.STORAGE_S3_BUCKET = "medicore-test-bucket";
  process.env.STORAGE_S3_REGION = "ap-south-1";
  const mod = await import("./storage/storageService.js");
  if (mod.storageService.driverName() !== "s3") { console.log("FAIL:driver=" + mod.storageService.driverName()); process.exit(1); }

  const store = new Map();
  const fakeS3 = {
    async send(command) {
      const ctorName = command.constructor.name;
      if (ctorName === "PutObjectCommand") {
        store.set(command.input.Key, command.input.Body);
        if (command.input.Bucket !== "medicore-test-bucket") throw new Error("wrong bucket: " + command.input.Bucket);
        if (command.input.ServerSideEncryption !== "AES256") throw new Error("missing SSE");
        return {};
      }
      if (ctorName === "GetObjectCommand") {
        if (!store.has(command.input.Key)) { const e = new Error("not found"); e.name = "NoSuchKey"; throw e; }
        const body = store.get(command.input.Key);
        return { Body: (async function* () { yield Buffer.isBuffer(body) ? body : Buffer.from(body); })() };
      }
      if (ctorName === "HeadObjectCommand") {
        if (!store.has(command.input.Key)) { const e = new Error("not found"); e.name = "NotFound"; throw e; }
        return {};
      }
      if (ctorName === "DeleteObjectCommand") { store.delete(command.input.Key); return {}; }
      throw new Error("unexpected command " + ctorName);
    },
  };
  mod.setS3ClientForTesting(fakeS3);

  const { key: s3Key } = await mod.storageService.upload("patient-reports", Buffer.from("s3 content"), { originalName: "x.pdf" });
  if (!(await mod.storageService.exists(s3Key))) throw new Error("exists() false right after upload");
  if ((await mod.storageService.read(s3Key)).toString() !== "s3 content") throw new Error("read() mismatch");
  await mod.storageService.delete(s3Key);
  if (await mod.storageService.exists(s3Key)) throw new Error("exists() true after delete");
  try { await mod.storageService.read(s3Key); throw new Error("read() after delete did not throw"); }
  catch (e) { if (!(e instanceof mod.StorageNotFoundError)) throw e; }
  try { mod.storageService.localAbsolutePathFor(s3Key); throw new Error("localAbsolutePathFor did not throw on the S3 driver"); }
  catch (e) { if (!/no local filesystem path/.test(e.message)) throw e; }
  console.log("S3_PROBE_OK");
`;
const { spawnSync } = await import("node:child_process");
const probe = spawnSync(process.execPath, ["--input-type=module", "-e", s3ProbeScript], {
  cwd: new URL("..", import.meta.url).pathname,
  encoding: "utf8",
  env: { PATH: process.env.PATH, MONGO_URI: process.env.MONGO_URI, JWT_SECRET: process.env.JWT_SECRET },
});
assert.ok(probe.stdout.includes("S3_PROBE_OK"), `S3 driver probe failed: ${probe.stdout}${probe.stderr}`);
console.log("PASS: S3 driver round-trips through the real PutObject/GetObject/HeadObject/DeleteObject code path (injected client), and never exposes a local path");

fs.rmSync(tmpRoot, { recursive: true, force: true });
