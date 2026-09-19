import assert from "node:assert/strict";
import {
  generateEmailVerificationToken,
  hashEmailVerificationToken,
  getEmailVerificationExpiry,
  EMAIL_VERIFICATION_EXPIRY_MS,
} from "../utils/emailVerification.js";

const token = generateEmailVerificationToken();

assert.equal(typeof token, "string");
assert.ok(token.length >= 32);
assert.notEqual(token, generateEmailVerificationToken());
assert.equal(hashEmailVerificationToken(token), hashEmailVerificationToken(token));
assert.notEqual(hashEmailVerificationToken(token), hashEmailVerificationToken(`${token}x`));

const expiry = getEmailVerificationExpiry();
const delta = expiry.getTime() - Date.now();
assert.ok(delta > EMAIL_VERIFICATION_EXPIRY_MS - 2000);
assert.ok(delta <= EMAIL_VERIFICATION_EXPIRY_MS + 2000);

console.log("email verification crypto contract: PASS");
