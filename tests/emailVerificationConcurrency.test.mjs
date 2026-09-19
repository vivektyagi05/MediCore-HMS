import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const service = fs.readFileSync(new URL("../services/emailVerificationService.js", import.meta.url), "utf8");
assert.ok(service.includes("User.findOneAndUpdate("), "verification consumption must use one atomic MongoDB update");
assert.ok(service.includes("emailVerificationTokenHash: tokenHash"));
assert.ok(service.includes("emailVerificationExpiresAt: { $gt: new Date() }"));
assert.ok(service.includes("isActive: true"));
assert.ok(service.includes("emailVerified: false"));
assert.ok(service.includes("emailVerificationLastUsedHash: tokenHash"));
assert.ok(service.includes("emailVerificationTokenHash: null"));
assert.ok(service.includes("emailVerificationExpiresAt: null"));
assert.ok(service.includes("emailVerificationSentAt: null"));

function makeAtomicUserModel(initial) {
  let doc = { ...initial };
  return {
    get value() { return { ...doc }; },
    async findOneAndUpdate(filter, update) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const now = Date.now();
      const matches =
        doc.emailVerificationTokenHash === filter.emailVerificationTokenHash &&
        doc.emailVerificationExpiresAt.getTime() > now &&
        doc.isActive === filter.isActive &&
        doc.emailVerified === filter.emailVerified;
      if (!matches) return null;
      doc = { ...doc, ...update.$set };
      return { ...doc };
    },
  };
}

async function consume(model, tokenHash) {
  return model.findOneAndUpdate(
    {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
      isActive: true,
      emailVerified: false,
    },
    {
      $set: {
        emailVerified: true,
        emailVerificationLastUsedHash: tokenHash,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        emailVerificationSentAt: null,
      },
    },
  );
}

test("two simultaneous verification attempts cannot both consume the active token", async () => {
  const tokenHash = "hash-1";
  const model = makeAtomicUserModel({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    emailVerificationSentAt: new Date(),
    emailVerificationLastUsedHash: null,
    emailVerified: false,
    isActive: true,
  });

  const [a, b] = await Promise.all([consume(model, tokenHash), consume(model, tokenHash)]);
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one concurrent request may consume the token");
  assert.equal(model.value.emailVerified, true);
  assert.equal(model.value.emailVerificationLastUsedHash, tokenHash);
  assert.equal(model.value.emailVerificationTokenHash, null);
  assert.equal(model.value.emailVerificationExpiresAt, null);
  assert.equal(model.value.emailVerificationSentAt, null);
});
