// Load-test seeder — determinism, exact default counts, schema validity, business invariants,
// idempotent upsert logic and "no external provider" proof. No database required.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.noDeprecation = true;
process.env.MONGO_URI ||= "mongodb://localhost:27017/hms_test";
process.env.JWT_SECRET ||= "test_secret_for_ci_only_not_real_do_not_use";
process.env.NODE_ENV ||= "test";

import { resolvePlan, DEFAULT_COUNTS } from "../scripts/loadtest/profile.mjs";
import { computePlanPass } from "../scripts/loadtest/planpass.mjs";
import * as G from "../scripts/loadtest/generate.mjs";
import { isOwnedId, makeId, KIND } from "../scripts/loadtest/ids.mjs";
import { upsertBatch, runSeed } from "../scripts/loadtest/seeder.mjs";
import { ROLES } from "../constants/roles.js";

console.log("loadTestSeederGeneration.test.mjs");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANCHOR = "2026-10-23";
const std = resolvePlan({ anchorDate: ANCHOR });

// ── exact default role counts ────────────────────────────────────────────
assert.deepEqual({ d: std.doctors, p: std.patients, a: std.admins }, { d: 10000, p: 10000, a: 50 });
assert.deepEqual(DEFAULT_COUNTS, { doctors: 10000, patients: 10000, admins: 50 });
for (const profile of ["smoke", "standard", "large"]) {
  const p = resolvePlan({ profile, anchorDate: ANCHOR });
  assert.equal(p.doctors, 10000); assert.equal(p.patients, 10000); assert.equal(p.admins, 50, "profile must not change role counts");
}
const pass = computePlanPass(std);
assert.equal(pass.counts.users, 20050); assert.equal(pass.counts.doctors, 10000);
assert.deepEqual(pass.dist.doctorState, { approved_active: 6500, approved_inactive: 500, pending: 1500, rejected: 800, not_submitted: 700 });
assert.equal(pass.slotCollisions, 0);
assert.equal(pass.counts.appointments, 6500 * 6);
// states are not an all-success world
for (const s of ["pending", "approved", "payment_pending", "payment_completed", "completed", "cancelled", "review_eligible", "consultation_started"]) assert.ok(pass.dist.apptStatus[s] > 0, `status ${s} present`);
for (const s of ["paid", "pending", "failed", "refunded"]) assert.ok(pass.dist.paymentStatus[s] > 0, `payment ${s} present`);
for (const s of ["processed", "pending", "rejected"]) assert.ok(pass.dist.refundStatus[s] > 0, `refund ${s} present`);
assert.ok(pass.dist.notificationRead.read > 0 && pass.dist.notificationRead.unread > 0);
assert.ok(pass.dist.dateBucket.today > 0 && pass.dist.dateBucket.future_1_7d > 0 && pass.dist.dateBucket.past_91_150d > 0);
assert.ok(pass.dist.prescriptionStatus.void > 0 && pass.dist.prescriptionStatus.active > 0);

// ── plan validation ──────────────────────────────────────────────────────
assert.throws(() => resolvePlan({ profile: "huge" }), /--profile/);
assert.throws(() => resolvePlan({ runId: "Bad Id" }), /--run-id/);
assert.throws(() => resolvePlan({ doctors: "-1" }), /--doctors/);
assert.throws(() => resolvePlan({ scale: 0 }), /--scale/);
assert.throws(() => resolvePlan({ anchorDate: "tomorrow" }), /--anchor-date/);
assert.throws(() => computePlanPass(resolvePlan({ profile: "large", scale: 100, anchorDate: ANCHOR })), /capacity/);

// ── determinism ──────────────────────────────────────────────────────────
const small = resolvePlan({ profile: "smoke", doctors: 300, patients: 200, admins: 4, anchorDate: ANCHOR });
const cal = G.buildCalendar(small);
const ctx = { passwordHash: "$2b$04$placeholderplaceholderplaceholderplaceholderplaceholde", ratings: new Map(), specializationMasterIds: new Map() };
const json = (x) => JSON.stringify(x);
for (let a = 0; a < small.appointments; a += 1) assert.equal(json(G.buildAppointmentBundle(small, cal, a)), json(G.buildAppointmentBundle(small, cal, a)));
assert.equal(json(G.buildDoctorProfile(small, 7, ctx)), json(G.buildDoctorProfile(small, 7, ctx)));
assert.notEqual(json(G.buildAppointmentBundle(small, cal, 5)), json(G.buildAppointmentBundle(resolvePlan({ ...{ profile: "smoke", doctors: 300, patients: 200, admins: 4, anchorDate: ANCHOR }, seed: "other" }), cal, 5)));
assert.deepEqual(computePlanPass(small).counts, computePlanPass(small).counts);

// ── users: reserved domain, roles, ownership ids ─────────────────────────
const users = [
  ...Array.from({ length: small.admins }, (_, i) => G.buildAdminUser(small, i, ctx)),
  ...Array.from({ length: small.doctors }, (_, i) => G.buildDoctorUser(small, i, ctx)),
  ...Array.from({ length: small.patients }, (_, i) => G.buildPatientUser(small, i, ctx)),
];
assert.equal(new Set(users.map((u) => u.email)).size, users.length, "emails unique");
assert.equal(new Set(users.map((u) => u._id)).size, users.length, "ids unique");
for (const u of users) {
  assert.match(u.email, /^(admin|doctor|patient)-\d{6}@loadtest\.medicore\.test$/);
  assert.ok(Object.values(ROLES).includes(u.role));
  assert.ok(isOwnedId(small.ns, u._id, KIND.user));
  assert.ok(u.name.startsWith("LOADTEST Synthetic"));
}
assert.equal(users.filter((u) => u.role === "super_admin").length, 4);
assert.ok(!users.some((u) => u.role === "admin"));
assert.equal(G.emailOf(std, "doctor", 0), "doctor-000001@loadtest.medicore.test");
assert.ok(users.filter((u) => u.role === "patient").every((u) => !u.patientProfile?.emergencyContact || /^0000\d+$/.test(u.patientProfile.emergencyContact.phone)));

// ── schema validity of every generated document type (sync validators; pre-hooks are bypassed by bulkWrite so the generator owns them) ──
const M = {};
for (const [k, f] of Object.entries({ user: "User", doctor: "Doctor", appointment: "Appointment", payment: "Payment", invoice: "Invoice", payout: "DoctorPayout", ledger: "TransactionLedger", refund: "RefundRequest", note: "MedicalNote", rx: "Prescription", review: "Review", notification: "NotificationDelivery", reminder: "ReminderLog", chat: "ChatMessage", saved: "SavedDoctor", adminLog: "AdminActivityLog", cron: "CronRunLog", auto: "AutomationRunLog" })) M[k] = (await import(`../models/${f}.js`)).default;
const valid = (Model, doc, label) => { const e = new Model(doc).validateSync(); assert.equal(e, undefined, `${label}: ${e?.message}`); };
users.slice(0, 40).concat(users.slice(small.admins + 200, small.admins + 220)).forEach((u) => valid(M.user, u, "user"));
for (let i = 0; i < small.doctors; i += 1) valid(M.doctor, G.buildDoctorProfile(small, i, ctx), `doctor ${i}`);
const bundles = Array.from({ length: small.appointments }, (_, a) => G.buildAppointmentBundle(small, cal, a));
const map = { appointments: "appointment", payments: "payment", invoices: "invoice", payouts: "payout", ledger: "ledger", refunds: "refund", notes: "note", prescriptions: "rx", reviews: "review", notifications: "notification", reminders: "reminder", chats: "chat" };
for (const b of bundles) for (const [col, mk] of Object.entries(map)) for (const d of b[col]) valid(M[mk], d, col);
for (let i = 0; i < 40; i += 1) { G.buildSavedDoctors(small, i).forEach((d) => valid(M.saved, d, "saved")); valid(M.adminLog, G.buildAdminLog(small, i), "adminLog"); valid(M.cron, G.buildCronLog(small, i), "cron"); valid(M.auto, G.buildAutomationLog(small, i), "auto"); }

// ── business invariants on the generated relationship graph ──────────────
const ACTIVE = new Set(["pending", "approved", "payment_pending", "payment_completed", "consultation_started", "consultation_completed", "completed", "review_eligible"]);
const slots = new Set(); const apptById = new Map(); const payById = new Map();
for (const b of bundles) {
  const ap = b.appointments[0]; apptById.set(ap._id, ap);
  const key = `${ap.doctorId}|${+ap.date}|${ap.timeSlot}`;
  assert.ok(!slots.has(key), "unique doctor/date/slot"); slots.add(key);
  assert.ok(isOwnedId(small.ns, ap._id, KIND.appointment)); assert.ok(isOwnedId(small.ns, ap.patientId, KIND.user)); assert.ok(isOwnedId(small.ns, ap.doctorId, KIND.doctor));
  assert.ok(ap.date.getUTCDay() !== 0, "no Sunday bookings");
  assert.equal(b.payments.length > 0, ap.paymentId !== undefined);
  for (const p of b.payments) {
    payById.set(p._id, p);
    assert.equal(p.appointmentId, ap._id); assert.equal(p.userId, ap.patientId); assert.equal(p.doctorId, ap.doctorId);
    assert.ok(Math.abs(p.totalAmount - (p.amount + p.taxAmount)) < 0.011);
    const captured = ["completed", "refunded"].includes(p.status);
    assert.equal(b.invoices.length, captured ? 1 : 0); assert.equal(b.payouts.length, captured ? 1 : 0);
    assert.equal(b.ledger.filter((l) => l.type === "payment").length, captured ? 1 : 0, "payment ledger row only for captured payments");
    if (captured) {
      assert.equal(ap.paymentStatus, p.status === "refunded" ? "refunded" : "paid");
      assert.equal(b.invoices[0].totalAmount, p.totalAmount); assert.equal(b.ledger[0].amount, p.totalAmount);
      const po = b.payouts[0]; assert.ok(Math.abs(po.grossAmount - (po.platformFee + po.doctorAmount)) < 0.011); assert.equal(po.grossAmount, p.totalAmount);
      assert.equal(p.refundedAmount, p.status === "refunded" ? p.totalAmount : 0);
      assert.equal(b.refunds.some((r) => r.status === "processed"), p.status === "refunded");
      if (p.status === "refunded") { assert.equal(ap.status, "cancelled"); assert.equal(po.status, "cancelled"); assert.equal(b.ledger.find((l) => l.type === "refund").amount, p.totalAmount); }
    } else { assert.ok(!p.invoiceId); assert.ok(!b.refunds.length); }
    if (p.activeAppointmentSlot) assert.ok(["created", "order_created", "checkout_started", "pending", "failed"].includes(p.status), "slot flag only on non-terminal payments");
    assert.match(p.razorpayOrderId, /^lt_order_loadtest_\d+$/); // synthetic placeholder, no gateway order exists
  }
  if (ap.status === "cancelled") assert.ok(!b.reviews.length && !b.prescriptions.length && !b.notes.length);
  for (const r of b.reviews) { assert.ok(["completed", "review_eligible"].includes(ap.status)); assert.equal(r.userId, ap.patientId); assert.equal(r.doctorId, ap.doctorId); assert.ok(r.rating >= 1 && r.rating <= 5); }
  for (const x of [...b.notes, ...b.prescriptions]) { assert.equal(x.doctorId, ap.doctorId); assert.equal(x.patientId, ap.patientId); assert.ok(["consultation_completed", "completed", "review_eligible"].includes(ap.status)); }
  assert.ok(b.prescriptions.filter((r) => r.status === "active").length <= 1);
  for (const r of b.prescriptions) for (const m of r.medicines) assert.match(m.name, /^LOADTEST-PLACEHOLDER/);
  for (const n of b.notes) assert.match(n.notes, /not clinical guidance/);
  for (const c of b.chats) { assert.ok(["paid"].includes(ap.paymentStatus)); assert.ok(c.senderId !== c.recipientId); }
  if (ap.status === "cancelled") assert.ok(ap.cancellation && ap.cancellation.previousStatus && ap.statusHistory.at(-1).status === "cancelled");
  if (ap.visit.state === "no_show_patient") assert.equal(ap.cancellation.reasonCode, "PATIENT_NO_SHOW");
}
assert.ok([...apptById.values()].some((a) => a.status === "cancelled") && [...apptById.values()].some((a) => a.status === "review_eligible"));
// event keys / idempotency keys unique across the namespace (they back partial unique indexes)
const uniq = (arr) => assert.equal(new Set(arr).size, arr.length);
uniq(bundles.flatMap((b) => b.notifications.map((n) => `${n.eventKey}|${n.recipientId}`)));
uniq(bundles.flatMap((b) => b.ledger.map((l) => l.idempotencyKey))); uniq(bundles.map((b) => b.appointments[0].bookingRequestId));
uniq(bundles.flatMap((b) => b.payments.map((p) => p.razorpayOrderId))); uniq(bundles.flatMap((b) => b.invoices.map((i) => i.invoiceNumber)));
uniq(bundles.flatMap((b) => b.chats.map((c) => c.clientMessageId))); uniq(bundles.flatMap((b) => b.reminders.map((r) => r.eventKey)));
// subdocument ids are deterministic (otherwise reruns would churn)
assert.ok(bundles.every((b) => b.appointments[0].statusHistory.every((h) => isOwnedId(small.ns, h._id))));
// cron logs are never "running"; saved-doctor pairs unique per patient
for (let i = 0; i < 100; i += 1) assert.notEqual(G.buildCronLog(small, i).status, "running");
for (let p = 0; p < small.patients; p += 1) uniq(G.buildSavedDoctors(small, p).map((s) => s.doctorId));
// doctor states ↔ user states ↔ access semantics
for (let i = 0; i < 200; i += 1) {
  const u = G.buildDoctorUser(small, i, ctx); const d = G.buildDoctorProfile(small, i, ctx); const st = G.doctorStateOf(i);
  assert.equal(d.isVerified, st.startsWith("approved")); assert.equal(u.isActive, st !== "approved_inactive"); assert.equal(d.isActive, u.isActive);
  assert.equal(u.doctorOnboardingStatus, { approved_active: "approved", approved_inactive: "approved", pending: "pending", rejected: "rejected", not_submitted: "not_started" }[st]);
  assert.equal(d.verificationStatus, st.startsWith("approved") ? "approved" : st);
  assert.equal(d.userId, u._id);
}
// appointments only target approved+active doctors
for (const b of bundles) assert.equal(G.doctorStateOf(Number(BigInt("0x" + b.appointments[0].doctorId.slice(-8)))), "approved_active");

// ── idempotent / scoped upsert logic (fake model, no DB) ─────────────────
const ops = [];
const fake = (behaviour) => ({ bulkWrite: async (o, opt) => { ops.push({ o, opt }); return behaviour(o); } });
const docs = [{ _id: makeId("t-ns", KIND.user, 1), a: 1 }, { _id: makeId("t-ns", KIND.user, 2), a: 2 }];
{
  const st = { inserted: 0, updated: 0, skipped: 0, retried: 0 };
  await upsertBatch(fake((o) => ({ upsertedCount: o.length, modifiedCount: 0, matchedCount: 0 })), docs, st, "x");
  assert.deepEqual(st, { inserted: 2, updated: 0, skipped: 0, retried: 0 });
  const st2 = { inserted: 0, updated: 0, skipped: 0, retried: 0 };
  await upsertBatch(fake((o) => ({ upsertedCount: 0, modifiedCount: 0, matchedCount: o.length })), docs, st2, "x"); // rerun: nothing duplicated
  assert.deepEqual(st2, { inserted: 0, updated: 0, skipped: 2, retried: 0 });
  for (const { o, opt } of ops) {
    assert.equal(opt.ordered, false); assert.equal(opt.timestamps, false);
    for (const op of o) { assert.deepEqual(Object.keys(op), ["updateOne"]); assert.deepEqual(Object.keys(op.updateOne.filter), ["_id"]); assert.equal(op.updateOne.upsert, true); assert.ok(!("_id" in op.updateOne.update.$set)); }
  }
  assert.equal(ops.some(({ o }) => o.some((op) => op.deleteMany || op.deleteOne || op.replaceOne)), false, "seeder never deletes/replaces");
  // duplicate-key on one op is retried; persistent conflict aborts loudly
  let n = 0; const st3 = { inserted: 0, updated: 0, skipped: 0, retried: 0 };
  await upsertBatch(fake((o) => { n += 1; if (n === 1) { const e = new Error("dup"); e.writeErrors = [{ index: 1, code: 11000 }]; e.result = { upsertedCount: 1, modifiedCount: 0, matchedCount: 0 }; throw e; } return { upsertedCount: o.length, modifiedCount: 0, matchedCount: 0 }; }), docs, st3, "x");
  assert.deepEqual(st3, { inserted: 2, updated: 0, skipped: 0, retried: 1 });
  await assert.rejects(upsertBatch(fake(() => { const e = new Error("dup"); e.writeErrors = [{ index: 0, code: 11000 }]; e.result = {}; throw e; }), docs, { inserted: 0, updated: 0, skipped: 0, retried: 0 }, "x"), /still conflict/);
  await assert.rejects(upsertBatch(fake(() => { const e = new Error("boom"); e.writeErrors = [{ index: 0, code: 121, errmsg: "validation" }]; e.result = {}; throw e; }), docs, { inserted: 0, updated: 0, skipped: 0, retried: 0 }, "x"), /bulk write failed/);
}

// ── whole runSeed orchestration against recording fake models (no DB) ───
{
  const tiny = resolvePlan({ profile: "smoke", doctors: 200, patients: 120, admins: 3, batchSize: 50, anchorDate: ANCHOR });
  const seenIds = {}; const models = {};
  for (const k of ["users", "doctors", "appointments", "payments", "invoices", "payouts", "ledger", "refunds", "notes", "prescriptions", "reviews", "notifications", "reminders", "chats", "saved", "adminLogs", "cronLogs", "automationLogs"]) {
    seenIds[k] = new Set();
    models[k] = { bulkWrite: async (o, opt) => { assert.equal(opt.ordered, false); for (const op of o) { assert.deepEqual(Object.keys(op.updateOne.filter), ["_id"]); seenIds[k].add(op.updateOne.filter._id); } return { upsertedCount: o.length, modifiedCount: 0, matchedCount: 0 }; } };
  }
  const expected = computePlanPass(tiny);
  const res = await runSeed({ plan: tiny, models, passwordHash: "x".repeat(60), ratings: expected.ratings, specializationMasterIds: new Map() });
  for (const [k, n] of Object.entries(expected.counts)) { assert.equal(seenIds[k].size, n, `runSeed wrote ${seenIds[k].size} ${k}, plan says ${n}`); assert.equal(res.stats[k].inserted, n); }
  for (const id of Object.values(seenIds).flatMap((x) => [...x])) assert.ok(isOwnedId(tiny.ns, id), "every written _id is namespace-owned");
}

// ── no external provider can be invoked: static import-closure scan ──────
const FORBIDDEN_BARE = /^(razorpay|nodemailer|@aws-sdk\/.*|@google\/genai|socket\.io(-client)?|express|multer|pdfkit|qrcode)$/;
const FORBIDDEN_PATH = /(razorpayService|emailService|emailOutbox|storageService|paymentGateway|gatewayCallback|webhookHandler|aiProvider|\/ai\/|financialEmails|invoiceService|pdfDocumentStore|worker\.js|app\.js|server\.js)/;
const seen = new Set(); const bare = new Set(); const bad = [];
const scan = (file) => {
  if (seen.has(file) || !existsSync(file)) return; seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*[`"']([^`"']+)[`"']/g)) {
    const spec = m[1] || m[2];
    if (spec.startsWith("node:") || !spec.includes("${") === false) continue;
    if (spec.startsWith(".")) { const t = path.resolve(path.dirname(file), spec); if (FORBIDDEN_PATH.test(t)) bad.push(`${file} -> ${spec}`); scan(t); }
    else { bare.add(spec); if (FORBIDDEN_BARE.test(spec)) bad.push(`${file} -> ${spec}`); }
  }
};
for (const f of ["generate.mjs", "planpass.mjs", "profile.mjs", "safety.mjs", "ids.mjs", "rng.mjs", "seeder.mjs", "verify.mjs", "cleanup.mjs", "db.mjs"]) scan(path.join(HERE, "..", "scripts", "loadtest", f));
scan(path.join(HERE, "..", "scripts", "seed-load-test.mjs"));
for (const f of ["User", "Doctor", "Appointment", "Payment", "Invoice", "DoctorPayout", "TransactionLedger", "RefundRequest", "MedicalNote", "Prescription", "Review", "NotificationDelivery", "ReminderLog", "ChatMessage", "SavedDoctor", "AdminActivityLog", "CronRunLog", "AutomationRunLog", "MasterData"]) scan(path.join(HERE, "..", "models", `${f}.js`));
assert.deepEqual(bad, [], `forbidden provider import reachable: ${bad.join("; ")}`);
assert.ok(bare.has("mongoose") && bare.has("bcrypt"));

// ── original bootstrap seed is untouched / not turned into a load seeder ─
const boot = readFileSync(path.join(HERE, "..", "seed.js"), "utf8");
assert.ok(!/loadtest|deleteMany|dropDatabase|\.drop\(/i.test(boot), "backend/seed.js must stay a non-destructive bootstrap seed");
// the load-test tooling itself contains no unscoped destructive calls
for (const f of ["seeder.mjs", "verify.mjs", "cleanup.mjs", "db.mjs", "../seed-load-test.mjs"]) {
  const s = readFileSync(path.join(HERE, "..", "scripts", "loadtest", f), "utf8");
  assert.ok(!/dropDatabase|\.dropCollection|\.drop\(|deleteMany\(\s*\{\s*\}\s*\)|collection\.deleteMany|\.remove\(/.test(s), `${f}: no unscoped destructive call`);
}
assert.equal([...readFileSync(path.join(HERE, "..", "scripts", "loadtest", "cleanup.mjs"), "utf8").matchAll(/deleteMany\(/g)].length, 1, "exactly one scoped deleteMany");
console.log("  ok");
