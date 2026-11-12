import assert from "node:assert/strict";
import { validateRegister as reg, validateLogin as login, validatePasswordValue as pw } from "../validations/authValidation.js";
const good = { name: "Asha Rao", email: "asha@example.com", password: "S3cure-pass", role: "patient", termsAccepted: true };
let n = 0; const ok = (m) => { n += 1; console.log("PASS:", m); };

assert.equal(reg(good).isValid, true); assert.equal(reg(undefined).isValid, false); assert.equal(reg(null === 1 ? 1 : {}).isValid, false); ok("valid payload ok; undefined/empty payload rejected without throwing");

// type confusion used to crash (name.trim on a number) or slip through (array has .length)
for (const bad of [5, true, {}, ["Asha"], null]) assert.ok(reg({ ...good, name: bad }).errors.name, `name ${JSON.stringify(bad)}`);
for (const bad of [5, {}, ["a@b.co"], null]) assert.ok(reg({ ...good, email: bad }).errors.email, `email ${JSON.stringify(bad)}`);
assert.ok(reg({ ...good, password: ["a", "b", "c", "d", "e", "f", "g", "h"] }).errors.password, "an 8-item array is not a password");
assert.ok(reg({ ...good, password: { length: 99 } }).errors.password); ok("non-string name/email/password are rejected, not crashed on or accepted");

assert.ok(reg({ ...good, name: "A" }).errors.name); assert.ok(reg({ ...good, name: "   " }).errors.name); assert.ok(reg({ ...good, name: "x".repeat(101) }).errors.name); assert.equal(reg({ ...good, name: "x".repeat(100) }).isValid, true);
assert.ok(reg({ ...good, email: `${"a".repeat(115)}@x.com` }).errors.email); assert.ok(reg({ ...good, email: "a@b" }).errors.email); assert.equal(reg({ ...good, email: "  asha@example.com  " }).isValid, true); ok("name and email length/shape/whitespace");

assert.equal(pw("1234567"), "Password must be at least 8 characters long"); assert.equal(pw("12345678"), ""); assert.equal(pw("x".repeat(128)), ""); assert.match(pw("x".repeat(129)), /at most 128/);
assert.equal(pw("        "), "Password cannot be only spaces"); assert.equal(pw(undefined) !== "", true); assert.equal(pw(12345678) !== "", true); ok("password min/max/whitespace-only/type");

assert.equal(reg({ ...good, role: "super_admin" }).isValid, false, "public registration can never create an admin"); assert.equal(reg({ ...good, termsAccepted: "true" }).isValid, false); ok("role escalation and truthy-string terms rejected");

assert.equal(login({ email: "a@b.co", password: "x" }).isValid, true); assert.equal(login({}).isValid, false); assert.equal(login(undefined).isValid, false);
assert.ok(login({ email: "a@b.co", password: { $ne: 1 } }).errors.password, "an operator object is not a password");
assert.ok(login({ email: { $gt: "" }, password: "x" }).errors.email); assert.ok(login({ email: "a@b.co", password: "x".repeat(129) }).errors.password); assert.equal(login({ email: "a@b.co", password: "short" }).isValid, true, "login does not enforce the sign-up policy"); ok("login: operator objects, missing, oversize");
console.log(`\n${n} auth validation groups passed`);
