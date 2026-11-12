// Phase 03 completion: durable financial-event delivery on the REAL emailOutboxService + requeue controller, in-memory
// EmailDelivery and a faked mail provider. NOT a real MongoDB / Brevo test.
import assert from "node:assert/strict";
import * as H from "./helpers/refundHarness.mjs";
import { financialEmails } from "../services/financialEmails.js";
import { emailService } from "../services/emailService.js";
import { processEmailOutbox, enqueueEmail, requeueFailedEmail, getOutboxHealth, MAX_EMAIL_ATTEMPTS, STALE_SENDING_MS, backoffMs } from "../services/emailOutboxService.js";
import { requeueOutboxEvent } from "../controllers/admin/financeAdminController.js";

const { M, mem, newId } = H;
let n = 0;
const test = async (name, fn) => { H.reset(); mail.calls = []; mail.impl = null; await fn(); n += 1; console.log(`PASS: ${name}`); };
const mail = { calls: [], impl: null };
emailService.sendTransactional = async (args) => { mail.calls.push(args); if (mail.impl) return mail.impl(args); return { messageId: `m${mail.calls.length}` }; };
// the memory layer has no aggregation engine: serve exactly the one $group-by-status pipeline getOutboxHealth sends
M.EmailDelivery.aggregate = async () => Object.entries(rows().reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {})).map(([_id, count]) => ({ _id, count }));
const rows = () => mem.dump("EmailDelivery");
const row = () => rows()[0];
const T0 = new Date(Date.now() + 60_000); // rows default nextAttemptAt to the real clock, so the worker clock starts just after it
const later = (ms) => new Date(T0.getTime() + ms);
const enqueue = (over = {}) => enqueueEmail({ eventKey: "refund:processed:p1:r1", to: "patient@example.test", subject: "s", html: "<p>x</p>", entityType: "refund", entityId: newId(), ...over });

await test("duplicate enqueue of the same logical event creates one row", async () => {
  assert.deepEqual(await enqueue(), { enqueued: true });
  assert.deepEqual(await enqueue(), { enqueued: false, reason: "duplicate" });
  assert.equal(rows().length, 1);
  await enqueue({ eventKey: "refund:processed:p1:r2" });
  assert.equal(rows().length, 2, "a different logical event is a different row");
});

await test("new financial events: stable keys, no patient data in the doctor notice", async () => {
  const recharge = { _id: newId(), amount: 500, currency: "INR" }; const user = { _id: newId(), email: "u@example.test", name: "U" };
  await financialEmails.rechargeCredited({ recharge, user }); await financialEmails.rechargeCredited({ recharge, user });
  assert.equal(rows().length, 1);
  const doc = { _id: newId(), email: "d@example.test", name: "Dr" };
  await financialEmails.doctorEarningAdjusted({ refundKey: "gw:r1", payoutId: newId(), doctorAdjustment: 280, becameLiability: true, user: doc });
  await financialEmails.doctorEarningAdjusted({ refundKey: "gw:r1", payoutId: newId(), doctorAdjustment: 280, becameLiability: true, user: doc });
  assert.equal(rows().length, 2);
  assert.match(rows()[1].html, /280\.00/); assert.match(rows()[1].html, /deducted from your available balance/);
  assert.deepEqual(await financialEmails.doctorEarningAdjusted({ refundKey: "gw:r9", doctorAdjustment: 1, user: { _id: newId() } }), { enqueued: false, reason: "missing_recipient_or_key" }, "no recipient => no row, no crash");
});

await test("provider failure backs off, then exhausts to failed and is visible", async () => {
  await enqueue(); mail.impl = async () => { throw Object.assign(new Error("5xx"), { statusCategory: "server" }); };
  const now = T0;
  for (let attempt = 1; attempt <= MAX_EMAIL_ATTEMPTS; attempt += 1) {
    const stats = await processEmailOutbox({ now });
    assert.equal(stats[attempt < MAX_EMAIL_ATTEMPTS ? "retrying" : "failed"], 1, `attempt ${attempt}`);
    assert.equal(row().attempts, attempt);
    if (attempt < MAX_EMAIL_ATTEMPTS) {
      assert.ok(new Date(row().nextAttemptAt) > now, "the retry is scheduled in the future (backoff), not immediately");
      await M.EmailDelivery.updateOne({}, { $set: { nextAttemptAt: new Date(now.getTime() - 1000) } }); // the backoff elapses
    }
  }
  assert.equal(row().status, "failed");
  assert.equal((await processEmailOutbox({ now })).sent, 0, "an exhausted row is not retried automatically");
  const health = await getOutboxHealth({ now });
  assert.equal(health.counts.failed, 1);
  assert.ok(health.failed.every((f) => f.html === undefined), "health never returns bodies");
  assert.ok(backoffMs(2) < backoffMs(3));
});

await test("a provider-rejected address is permanent immediately", async () => {
  await enqueue(); mail.impl = async () => { throw Object.assign(new Error("bad address"), { statusCategory: "rejected" }); };
  await processEmailOutbox({ now: T0 });
  assert.equal(row().status, "failed"); assert.equal(row().attempts, 1);
});

await test("abandoned 'sending' rows are reclaimed (no attempt lost) and delivered", async () => {
  await enqueue();
  await M.EmailDelivery.updateOne({}, { $set: { status: "sending", claimedAt: T0, claimToken: "dead-worker", attempts: 1 } });
  assert.equal((await processEmailOutbox({ now: later(STALE_SENDING_MS - 1000) })).sent, 0, "still within the lease: untouched");
  assert.equal(row().status, "sending");
  assert.equal((await getOutboxHealth({ now: later(STALE_SENDING_MS + 1000) })).stuckSending, 1, "stuck rows are visible before recovery");
  const stats = await processEmailOutbox({ now: later(STALE_SENDING_MS + 1000) });
  assert.equal(stats.sent, 1); assert.equal(row().status, "sent"); assert.equal(row().claimToken, undefined);
  assert.equal(row().attempts, 2, "the dead worker's attempt is counted, not lost");
});

await test("stale worker cannot overwrite the newer worker's outcome (fencing); duplicate-send window is real and bounded", async () => {
  await enqueue();
  let release; const gate = new Promise((r) => { release = r; });
  mail.impl = async () => { if (mail.calls.length === 1) { await gate; return { messageId: "A" }; } return { messageId: "B" }; };
  const workerA = processEmailOutbox({ now: T0 });                                  // claims, then hangs inside the provider call
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(row().status, "sending");
  const statsB = await processEmailOutbox({ now: later(STALE_SENDING_MS + 5000) }); // lease expired: B reclaims and sends
  assert.equal(statsB.sent, 1); assert.equal(row().providerMessageId, "B");
  release();
  const statsA = await workerA;
  assert.equal(statsA.sent, 0); assert.equal(statsA.fencedOut, 1, "A's late success write is rejected by the fence");
  assert.equal(row().providerMessageId, "B", "the newer outcome stands");
  assert.equal(row().status, "sent");
  assert.equal(mail.calls.length, 2, "the provider accepted two sends: the documented at-least-once window (no provider idempotency key)");
});

await test("a stale worker's late FAILURE cannot demote a delivered row", async () => {
  await enqueue();
  let fail; const gate = new Promise((_, rej) => { fail = rej; });
  mail.impl = async () => { if (mail.calls.length === 1) await gate; return { messageId: "B" }; };
  const workerA = processEmailOutbox({ now: T0 });
  await new Promise((r) => setTimeout(r, 20));
  await processEmailOutbox({ now: later(STALE_SENDING_MS + 5000) });
  assert.equal(row().status, "sent");
  fail(Object.assign(new Error("late timeout"), { statusCategory: "server" }));
  const statsA = await workerA;
  assert.equal(statsA.fencedOut, 1); assert.equal(row().status, "sent");
});

await test("requeue is conditional, resets the budget, and the controller demands a reason and audits it", async () => {
  await enqueue(); mail.impl = async () => { throw Object.assign(new Error("x"), { statusCategory: "rejected" }); };
  await processEmailOutbox({ now: T0 }); const id = row()._id;
  const noReason = await H.callHandler(requeueOutboxEvent, { params: { id: String(id) }, body: { reason: "no" } });
  assert.equal(noReason.status, 400); assert.equal(row().status, "failed");
  mail.impl = null;
  const ok = await H.callHandler(requeueOutboxEvent, { params: { id: String(id) }, body: { reason: "Provider outage resolved, re-sending receipt" } });
  assert.equal(ok.status, 200); assert.equal(row().status, "queued"); assert.equal(row().attempts, 0); assert.equal(row().requeueCount, 1);
  assert.equal(JSON.stringify(ok.body).includes("<p>"), false, "response carries no email body");
  const audit = mem.dump("AdminActivityLog").find((a) => a.action === "finance.outbox_requeued");
  assert.ok(audit); assert.equal(audit.metadata.reason, "Provider outage resolved, re-sending receipt");
  const again = await H.callHandler(requeueOutboxEvent, { params: { id: String(id) }, body: { reason: "double click, retry again" } });
  assert.equal(again.status, 409, "a second requeue of a non-failed row is refused");
  assert.equal((await requeueFailedEmail({ id })).requeued, false);
  assert.equal((await processEmailOutbox({ now: later(1000) })).sent, 1);
  assert.equal((await H.callHandler(requeueOutboxEvent, { params: { id: "bad" }, body: { reason: "valid reason here" } })).status, 400);
});

await test("concurrent workers never both send the same row", async () => {
  for (let i = 0; i < 6; i += 1) await enqueue({ eventKey: `e${i}` });
  const results = await Promise.all([processEmailOutbox({ now: T0 }), processEmailOutbox({ now: T0 }), processEmailOutbox({ now: T0 })]);
  assert.equal(results.reduce((a, r) => a + r.sent, 0), 6);
  assert.equal(mail.calls.length, 6, "each row sent exactly once under concurrent claims");
});

console.log(`\n${n} outbox durability scenarios passed`);
process.exit(0);
