import bcrypt from "bcrypt";
import crypto from "crypto";
import { env } from "../config/env.js";

const OTP_MIN = 100000;
const OTP_MAX = 999999;

// Phase P15 — never Math.random()/Date.now()/anything derived from
// user-identifiable data. crypto.randomInt is a CSPRNG, unpredictable
// across the full 100000-999999 range.
export const generateSecureOtp = () => String(crypto.randomInt(OTP_MIN, OTP_MAX + 1));

// OTP is only 6 digits (900000 possibilities) — a fast hash (sha256) would
// let a leaked DB be brute-forced offline in seconds. bcrypt (same
// mechanism already used for user passwords) is deliberately slow, so it
// carries real weight here even though the input space is small; combined
// with the attempt-limit/expiry checks below, it's the appropriate choice.
export const hashOtp = (rawOtp) => bcrypt.hash(rawOtp, env.bcryptSaltRounds);
export const compareOtp = (rawOtp, otpHash) => bcrypt.compare(rawOtp, otpHash);

// The reset token is a 32-byte CSPRNG value (256 bits of entropy) — unlike
// the OTP, brute-forcing it offline is infeasible regardless of hash
// speed, so a fast sha256 hash is the right tool here (a slow hash would
// only add unnecessary latency with no real security benefit at this
// entropy level).
export const generateSecureResetToken = () => crypto.randomBytes(32).toString("hex");
export const hashResetToken = (rawToken) => crypto.createHash("sha256").update(rawToken).digest("hex");
