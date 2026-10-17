// Phase 03 outbox: failure-outcome policy + schema contract for lease fencing.
// The conditional-update fencing itself needs real Mongo (tests/mongo, BLOCKED_EXTERNAL here).
import assert from "assert";
import EmailDelivery from "../models/EmailDelivery.js";
import { decideFailureOutcome, MAX_EMAIL_ATTEMPTS, backoffMs, STALE_SENDING_MS } from "../services/emailOutboxService.js";

assert.deepStrictEqual(decideFailureOutcome({ attempts: 1, category: "unknown" }), { status: "retrying", delayMs: backoffMs(1) });
assert.strictEqual(backoffMs(1), 2 * 60 * 1000);
assert.strictEqual(backoffMs(3), 8 * 60 * 1000);
assert.deepStrictEqual(decideFailureOutcome({ attempts: MAX_EMAIL_ATTEMPTS, category: "unknown" }), { status: "failed" });
assert.deepStrictEqual(decideFailureOutcome({ attempts: 1, category: "rejected" }), { status: "failed" }, "provider rejection is permanent immediately");
console.log("PASS: outbox retry/backoff/exhaustion policy");

assert.ok(STALE_SENDING_MS > 0);
for (const f of ["claimToken", "lastErrorAt", "requeueCount", "requeuedAt"]) assert.ok(EmailDelivery.schema.path(f), `EmailDelivery.${f} must exist for fencing/requeue`);
const doc = new EmailDelivery({ eventKey: "k", to: "a@example.com", subject: "s", html: "<p>x</p>", status: "failed" });
await doc.validate();
console.log("PASS: outbox schema carries lease-fencing and requeue fields");
process.exit(0);
