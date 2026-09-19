// Regression test for the file-upload security gap found this session:
// upload endpoints only checked the client-supplied mimetype header, which
// is fully spoofable. This tests the real magic-number check against actual
// bytes on disk (no mocking).
import fs from "fs";
import path from "path";
import os from "os";
import assert from "assert";
import { validateFileSignature } from "../utils/fileValidation.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fv-test-"));

const write = (name, bytes) => {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

// Real PDF magic bytes, declared as PDF -> valid
const realPdf = write("real.pdf", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
assert.strictEqual(validateFileSignature(realPdf, "application/pdf"), true);
console.log("PASS: real PDF bytes validate as application/pdf");

// A plain-text/script file, but with the multer-accepted mimetype spoofed to
// "application/pdf" (exactly the attack this closes) -> must be rejected
const fakePdf = write("fake.pdf", Buffer.from("#!/bin/sh\nrm -rf /\n"));
assert.strictEqual(validateFileSignature(fakePdf, "application/pdf"), false);
console.log("PASS: spoofed mimetype with non-PDF content is rejected");

// Real PNG signature, declared as PNG -> valid
const realPng = write("real.png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
assert.strictEqual(validateFileSignature(realPng, "image/png"), true);
console.log("PASS: real PNG bytes validate as image/png");

// Real JPEG signature variant, declared as JPEG -> valid
const realJpeg = write("real.jpg", [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
assert.strictEqual(validateFileSignature(realJpeg, "image/jpeg"), true);
console.log("PASS: real JPEG bytes validate as image/jpeg");

// Unknown/unregistered mimetype must fail closed, not pass by default
assert.strictEqual(validateFileSignature(realPdf, "application/x-msdownload"), false);
console.log("PASS: unregistered mimetype fails closed");

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("ALL FILE VALIDATION TESTS PASSED");
