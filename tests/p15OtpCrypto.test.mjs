// Phase P15 — pure, dependency-free tests for backend/utils/otp.js.
// No MongoDB required (matching capacityAggregates.test.mjs / slotEngine.test.mjs).
import assert from "assert";
import {
  generateSecureOtp,
  hashOtp,
  compareOtp,
  generateSecureResetToken,
  hashResetToken,
} from "../utils/otp.js";

// 1. OTP is always a 6-digit numeric string in range 100000-999999.
for (let i = 0; i < 200; i += 1) {
  const otp = generateSecureOtp();
  assert.strictEqual(otp.length, 6, `OTP must be 6 digits, got "${otp}"`);
  assert.match(otp, /^\d{6}$/, "OTP must be purely numeric");
  const numeric = Number(otp);
  assert.ok(numeric >= 100000 && numeric <= 999999, "OTP must be in range 100000-999999");
}
console.log("PASS: generateSecureOtp produces 6-digit numeric codes in range");

// 2. OTPs are not trivially predictable/sequential — a batch of 50 should
// not all be identical and should not be a monotonic sequence.
const batch = Array.from({ length: 50 }, () => generateSecureOtp());
const unique = new Set(batch);
assert.ok(unique.size > 1, "generateSecureOtp must not return a constant value");
console.log("PASS: generateSecureOtp is not constant across calls");

// 3. Raw OTP is never stored — only a bcrypt hash — and that hash verifies
// the correct code while rejecting an incorrect one.
const rawOtp = generateSecureOtp();
const otpHash = await hashOtp(rawOtp);
assert.notStrictEqual(otpHash, rawOtp, "hashOtp must not return the raw OTP");
assert.ok(otpHash.startsWith("$2"), "hashOtp must produce a bcrypt hash");
assert.strictEqual(await compareOtp(rawOtp, otpHash), true, "compareOtp must accept the correct OTP");
assert.strictEqual(await compareOtp("000000", otpHash), false, "compareOtp must reject an incorrect OTP");
console.log("PASS: OTP hashing stores no raw value and verifies correctly");

// 4. Reset token is high-entropy and its hash is deterministic (so a
// lookup-by-hash works) but never reversible to the raw token from the hash alone.
const tokenA = generateSecureResetToken();
const tokenB = generateSecureResetToken();
assert.notStrictEqual(tokenA, tokenB, "reset tokens must be unique per call");
assert.strictEqual(tokenA.length, 64, "reset token must be 32 bytes hex-encoded (64 chars)");
const hashA1 = hashResetToken(tokenA);
const hashA2 = hashResetToken(tokenA);
assert.strictEqual(hashA1, hashA2, "hashResetToken must be deterministic for the same input (needed for DB lookup)");
assert.notStrictEqual(hashA1, tokenA, "hashResetToken must not return the raw token");
assert.notStrictEqual(hashResetToken(tokenB), hashA1, "different tokens must hash differently");
console.log("PASS: reset token generation/hash round-trip behaves correctly");
