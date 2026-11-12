// READ-ONLY verification. Only find/count/aggregate/explain/listIndexes — no writes, no index builds.
// Every query is scoped to the namespace's deterministic _id range and bounded server-side
// (aggregation + $lookup on _id), so nothing loads the dataset into process memory.
import mongoose from "mongoose";
import { idRange, KIND } from "./ids.mjs";
import { kindOfCollection } from "./seeder.mjs";
import { MODEL_FILES } from "./db.mjs";

const oid = (h) => new mongoose.Types.ObjectId(h);
const rangeOf = (ns, key) => { const { lo, hi } = idRange(ns, kindOfCollection(key)); return { _id: { $gte: oid(lo), $lte: oid(hi) } }; };
const coll = (m) => m.collection.name;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toObj = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r.n]));

export const runVerify = async ({ plan, models, expected, manifest = null, withTimings = true }) => {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
  const count = async (key, extra = {}) => models[key].countDocuments({ ...rangeOf(plan.ns, key), ...extra });
  const agg = (key, pipeline) => models[key].aggregate(pipeline, { allowDiskUse: true });
  const zero = async (name, key, pipeline, detail = "") => {
    const [r] = await agg(key, [...pipeline, { $count: "n" }]);
    add(name, (r?.n || 0) === 0, `${r?.n || 0} violation(s)${detail ? `; ${detail}` : ""}`);
  };

  // 1) exact counts per collection vs the deterministic expectation
  const owned = {};
  for (const key of Object.keys(MODEL_FILES)) owned[key] = await count(key);
  for (const key of Object.keys(MODEL_FILES)) add(`count:${key}`, owned[key] === expected.counts[key], `expected ${expected.counts[key]}, found ${owned[key]}`);

  // 2) users: roles, domain, duplicates, foreign claims
  const roles = toObj(await agg("users", [{ $match: rangeOf(plan.ns, "users") }, { $group: { _id: "$role", n: { $sum: 1 } } }]));
  add("users:role-counts", roles.doctor === plan.doctors && roles.patient === plan.patients && roles.super_admin === plan.admins && Object.keys(roles).length === 3, JSON.stringify(roles));
  const domainRe = new RegExp(`^(admin|doctor|patient)-\\d{6}@${esc(plan.domain)}$`);
  add("users:reserved-domain-emails", (await count("users", { email: { $not: domainRe } })) === 0, `domain @${plan.domain}`);
  add("users:no-foreign-claim-of-seed-domain", (await models.users.countDocuments({ email: new RegExp(`@${esc(plan.domain)}$`), $nor: [rangeOf(plan.ns, "users")] })) === 0, "no non-namespace user uses the seed email domain");
  await zero("users:duplicate-emails", "users", [{ $match: rangeOf(plan.ns, "users") }, { $group: { _id: "$email", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);

  // 3) doctor profiles ↔ users
  const lookupUser = { $lookup: { from: coll(models.users), localField: "userId", foreignField: "_id", as: "u" } };
  await zero("doctors:orphan-profiles", "doctors", [{ $match: rangeOf(plan.ns, "doctors") }, lookupUser, { $match: { $expr: { $or: [{ $eq: [{ $size: "$u" }, 0] }, { $ne: [{ $arrayElemAt: ["$u.role", 0] }, "doctor"] }] } } }]);
  await zero("doctors:active-profile-requires-active-user", "doctors", [{ $match: { ...rangeOf(plan.ns, "doctors"), isActive: true } }, lookupUser, { $match: { "u.isActive": { $ne: true } } }], "Doctor pre-validate invariant");
  await zero("doctors:onboarding-status-consistent", "doctors", [{ $match: rangeOf(plan.ns, "doctors") }, lookupUser, { $match: { $expr: { $ne: [{ $arrayElemAt: ["$u.doctorOnboardingStatus", 0] }, { $switch: { branches: [{ case: { $eq: ["$verificationStatus", "not_submitted"] }, then: "not_started" }], default: "$verificationStatus" } }] } } }]);
  await zero("doctors:verified-flag-matches-status", "doctors", [{ $match: rangeOf(plan.ns, "doctors") }, { $match: { $expr: { $ne: ["$isVerified", { $eq: ["$verificationStatus", "approved"] }] } } }]);

  // 4) appointments ↔ patients/doctors, slot uniqueness
  await zero("appointments:dangling-patient-or-doctor", "appointments", [
    { $match: rangeOf(plan.ns, "appointments") },
    { $lookup: { from: coll(models.users), localField: "patientId", foreignField: "_id", as: "p" } },
    { $lookup: { from: coll(models.doctors), localField: "doctorId", foreignField: "_id", as: "d" } },
    { $match: { $expr: { $or: [{ $eq: [{ $size: "$p" }, 0] }, { $ne: [{ $arrayElemAt: ["$p.role", 0] }, "patient"] }, { $eq: [{ $size: "$d" }, 0] }] } } },
  ]);
  const ACTIVE = ["pending", "approved", "payment_pending", "payment_completed", "consultation_started", "consultation_completed", "completed", "review_eligible"];
  await zero("appointments:active-slot-uniqueness", "appointments", [{ $match: { ...rangeOf(plan.ns, "appointments"), status: { $in: ACTIVE } } }, { $group: { _id: { d: "$doctorId", t: "$date", s: "$timeSlot" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }], "mirrors the unique partial index");
  await zero("appointments:doctor-must-be-approved-active", "appointments", [
    { $match: rangeOf(plan.ns, "appointments") }, { $lookup: { from: coll(models.doctors), localField: "doctorId", foreignField: "_id", as: "d" } },
    { $match: { $expr: { $not: [{ $and: [{ $eq: [{ $arrayElemAt: ["$d.verificationStatus", 0] }, "approved"] }, { $eq: [{ $arrayElemAt: ["$d.isActive", 0] }, true] }] }] } } },
  ]);

  // 5) appointment ↔ payment ↔ invoice ↔ payout ↔ ledger invariants
  await zero("appointments:payment-link-consistent", "appointments", [
    { $match: { ...rangeOf(plan.ns, "appointments"), paymentId: { $exists: true } } },
    { $lookup: { from: coll(models.payments), localField: "paymentId", foreignField: "_id", as: "pay" } },
    { $match: { $expr: { $let: { vars: { p: { $arrayElemAt: ["$pay", 0] } }, in: { $or: [
      { $eq: [{ $size: "$pay" }, 0] }, { $ne: ["$$p.appointmentId", "$_id"] },
      { $and: [{ $eq: ["$paymentStatus", "paid"] }, { $ne: ["$$p.status", "completed"] }] },
      { $and: [{ $eq: ["$paymentStatus", "refunded"] }, { $ne: ["$$p.status", "refunded"] }] },
    ] } } } } },
  ]);
  await zero("appointments:paid-without-payment-record", "appointments", [{ $match: { ...rangeOf(plan.ns, "appointments"), paymentStatus: { $in: ["paid", "refunded"] }, paymentId: { $exists: false } } }]);
  await zero("payments:amount-arithmetic", "payments", [{ $match: rangeOf(plan.ns, "payments") }, { $match: { $expr: { $gt: [{ $abs: { $subtract: ["$totalAmount", { $add: ["$amount", "$taxAmount"] }] } }, 0.011] } } }]);
  await zero("payments:captured-have-invoice-payout-ledger", "payments", [
    { $match: { ...rangeOf(plan.ns, "payments"), status: { $in: ["completed", "refunded"] } } },
    { $lookup: { from: coll(models.invoices), localField: "_id", foreignField: "paymentId", as: "i" } },
    { $lookup: { from: coll(models.payouts), localField: "_id", foreignField: "paymentId", as: "o" } },
    { $lookup: { from: coll(models.ledger), let: { pid: "$_id" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$paymentId", "$$pid"] }, { $eq: ["$type", "payment"] }] } } }], as: "l" } },
    { $match: { $expr: { $or: [{ $ne: [{ $size: "$i" }, 1] }, { $ne: [{ $size: "$o" }, 1] }, { $ne: [{ $size: "$l" }, 1] }, { $ne: [{ $arrayElemAt: ["$l.amount", 0] }, "$totalAmount"] }, { $ne: [{ $arrayElemAt: ["$i.totalAmount", 0] }, "$totalAmount"] }] } } },
  ]);
  await zero("payments:uncaptured-have-no-invoice-or-payout", "payments", [
    { $match: { ...rangeOf(plan.ns, "payments"), status: { $nin: ["completed", "refunded"] } } },
    { $lookup: { from: coll(models.payouts), localField: "_id", foreignField: "paymentId", as: "o" } }, { $match: { $or: [{ "o.0": { $exists: true } }, { invoiceId: { $exists: true } }] } },
  ]);
  await zero("payments:refund-fields-consistent", "payments", [{ $match: rangeOf(plan.ns, "payments") }, { $match: { $expr: { $or: [{ $gt: ["$refundedAmount", "$totalAmount"] }, { $and: [{ $eq: ["$refundStatus", "full"] }, { $ne: ["$refundedAmount", "$totalAmount"] }] }, { $and: [{ $ne: ["$refundStatus", "full"] }, { $gt: ["$refundedAmount", 0] }] }] } } }]);
  await zero("refunds:state-matches-payment", "refunds", [
    { $match: rangeOf(plan.ns, "refunds") }, { $lookup: { from: coll(models.payments), localField: "paymentId", foreignField: "_id", as: "p" } },
    { $match: { $expr: { $or: [{ $eq: [{ $size: "$p" }, 0] }, { $and: [{ $eq: ["$status", "processed"] }, { $or: [{ $ne: [{ $arrayElemAt: ["$p.refundStatus", 0] }, "full"] }, { $ne: ["$amount", { $arrayElemAt: ["$p.refundedAmount", 0] }] }] }] }, { $and: [{ $eq: ["$status", "pending"] }, { $ne: [{ $arrayElemAt: ["$p.refundStatus", 0] }, "pending"] }] }] } } },
  ]);
  await zero("ledger:amounts-reconcile-with-payments", "ledger", [
    { $match: rangeOf(plan.ns, "ledger") }, { $lookup: { from: coll(models.payments), localField: "paymentId", foreignField: "_id", as: "p" } },
    { $match: { $expr: { $or: [{ $eq: [{ $size: "$p" }, 0] }, { $and: [{ $eq: ["$type", "payment"] }, { $ne: ["$amount", { $arrayElemAt: ["$p.totalAmount", 0] }] }] }, { $and: [{ $eq: ["$type", "refund"] }, { $ne: ["$amount", { $arrayElemAt: ["$p.refundedAmount", 0] }] }] }] } } },
  ]);
  await zero("payouts:split-sums-to-gross", "payouts", [{ $match: rangeOf(plan.ns, "payouts") }, { $match: { $expr: { $gt: [{ $abs: { $subtract: ["$grossAmount", { $add: ["$platformFee", "$doctorAmount"] }] } }, 0.011] } } }]);

  // 6) doctor↔patient relationship validity for clinical records and reviews
  const apptLookup = { $lookup: { from: coll(models.appointments), localField: "appointmentId", foreignField: "_id", as: "a" } };
  for (const key of ["notes", "prescriptions"]) {
    await zero(`${key}:doctor-patient-match-appointment`, key, [{ $match: rangeOf(plan.ns, key) }, apptLookup, { $match: { $expr: { $or: [{ $eq: [{ $size: "$a" }, 0] }, { $ne: ["$doctorId", { $arrayElemAt: ["$a.doctorId", 0] }] }, { $ne: ["$patientId", { $arrayElemAt: ["$a.patientId", 0] }] }, { $not: [{ $in: [{ $arrayElemAt: ["$a.status", 0] }, ["consultation_completed", "completed", "review_eligible"]] }] }] } } }]);
  }
  await zero("reviews:eligible-completed-appointment", "reviews", [{ $match: rangeOf(plan.ns, "reviews") }, apptLookup, { $match: { $expr: { $or: [{ $eq: [{ $size: "$a" }, 0] }, { $ne: ["$doctorId", { $arrayElemAt: ["$a.doctorId", 0] }] }, { $ne: ["$userId", { $arrayElemAt: ["$a.patientId", 0] }] }, { $not: [{ $in: [{ $arrayElemAt: ["$a.status", 0] }, ["completed", "review_eligible"]] }] }] } } }]);
  await zero("prescriptions:single-active-per-appointment", "prescriptions", [{ $match: { ...rangeOf(plan.ns, "prescriptions"), status: "active" } }, { $group: { _id: "$appointmentId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  await zero("doctors:rating-equals-review-average", "reviews", [
    { $match: { ...rangeOf(plan.ns, "reviews"), adminDeleted: { $ne: true } } }, { $group: { _id: "$doctorId", avg: { $avg: "$rating" } } },
    { $lookup: { from: coll(models.doctors), localField: "_id", foreignField: "_id", as: "d" } },
    { $match: { $expr: { $gt: [{ $abs: { $subtract: [{ $arrayElemAt: ["$d.rating", 0] }, { $round: ["$avg", 1] }] } }, 0.051] } } },
  ]);
  await zero("chats:participants-match-appointment", "chats", [
    { $match: rangeOf(plan.ns, "chats") }, apptLookup,
    { $lookup: { from: coll(models.doctors), localField: "a.doctorId", foreignField: "_id", as: "d" } },
    { $match: { $expr: { $not: [{ $setEquals: [["$senderId", "$recipientId"], [{ $arrayElemAt: ["$a.patientId", 0] }, { $arrayElemAt: ["$d.userId", 0] }]] }] } } },
  ]);
  await zero("notifications:duplicate-event-keys", "notifications", [{ $match: rangeOf(plan.ns, "notifications") }, { $group: { _id: { e: "$eventKey", r: "$recipientId" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  await zero("cronlogs:never-running", "cronLogs", [{ $match: { ...rangeOf(plan.ns, "cronLogs"), status: "running" } }]);

  // 7) distributions (bounded group-bys)
  const dist = {};
  dist.usersByRole = roles;
  dist.doctorVerification = toObj(await agg("doctors", [{ $match: rangeOf(plan.ns, "doctors") }, { $group: { _id: { $concat: ["$verificationStatus", "/", { $cond: ["$isActive", "active", "inactive"] }] }, n: { $sum: 1 } } }]));
  dist.appointmentStatus = toObj(await agg("appointments", [{ $match: rangeOf(plan.ns, "appointments") }, { $group: { _id: "$status", n: { $sum: 1 } } }]));
  dist.appointmentPaymentStatus = toObj(await agg("appointments", [{ $match: rangeOf(plan.ns, "appointments") }, { $group: { _id: "$paymentStatus", n: { $sum: 1 } } }]));
  dist.paymentStatus = toObj(await agg("payments", [{ $match: rangeOf(plan.ns, "payments") }, { $group: { _id: "$status", n: { $sum: 1 } } }]));
  dist.refundStatus = toObj(await agg("refunds", [{ $match: rangeOf(plan.ns, "refunds") }, { $group: { _id: "$status", n: { $sum: 1 } } }]));
  dist.notificationState = toObj(await agg("notifications", [{ $match: rangeOf(plan.ns, "notifications") }, { $group: { _id: { $cond: [{ $ifNull: ["$readAt", false] }, "read", "unread"] }, n: { $sum: 1 } } }]));
  const a0 = plan.anchor.getTime();
  const day = 86400000;
  dist.appointmentDateBucket = toObj(await agg("appointments", [{ $match: rangeOf(plan.ns, "appointments") }, { $group: { _id: { $switch: { branches: [
    { case: { $lt: ["$date", new Date(a0 - 90 * day)] }, then: "past_91_150d" }, { case: { $lt: ["$date", new Date(a0 - 30 * day)] }, then: "past_31_90d" },
    { case: { $lt: ["$date", new Date(a0)] }, then: "past_1_30d" }, { case: { $lt: ["$date", new Date(a0 + day)] }, then: "today" },
    { case: { $lt: ["$date", new Date(a0 + 8 * day)] }, then: "future_1_7d" }], default: "future_8_28d" } }, n: { $sum: 1 } } }]));

  // 8) "non-seed documents unchanged": foreign counts (total - owned) vs the manifest written at seed time
  const foreign = {};
  for (const key of Object.keys(MODEL_FILES)) foreign[key] = (await models[key].estimatedDocumentCount()) - owned[key];
  if (manifest?.foreignCountsAfter) {
    const drift = Object.keys(foreign).filter((k) => foreign[k] !== manifest.foreignCountsAfter[k]);
    add("foreign-documents:count-unchanged-since-seed-manifest", drift.length === 0, drift.length ? `changed (could be other writers): ${drift.join(", ")}` : "non-namespace document counts match the manifest recorded right after seeding");
  } else add("foreign-documents:count-unchanged-since-seed-manifest", true, "SKIPPED — no manifest for this run id (informational only)");

  // 9) index report (read-only)
  const indexes = {};
  for (const key of Object.keys(MODEL_FILES)) {
    let existing = [];
    try { existing = await models[key].collection.indexes(); } catch { existing = []; }
    const have = new Set(existing.map((i) => JSON.stringify(i.key)));
    const hasText = existing.some((i) => i.key?._fts === "text");
    const missing = models[key].schema.indexes().filter(([k]) => (Object.values(k).includes("text") ? !hasText : !have.has(JSON.stringify(k)))).map(([k]) => JSON.stringify(k));
    if (!have.has('{"_id":1}')) missing.unshift("(collection missing)");
    indexes[key] = { present: existing.length, missing };
  }

  const timings = withTimings ? await sampleTimings({ plan, models }) : null;
  return { checks, ok: checks.every((c) => c.ok), distributions: dist, owned, foreign, indexes, timings };
};

const planStages = (n, out = []) => { if (!n || typeof n !== "object") return out; if (n.stage) out.push(n.stage + (n.indexName ? `(${n.indexName})` : "")); for (const v of Object.values(n)) if (v && typeof v === "object") planStages(v, out); return out; };

const sampleTimings = async ({ plan, models }) => {
  const approvedDoctor = { verificationStatus: "approved", isVerified: true, isActive: true };
  const queries = [
    ["public doctor search (approved+active, specialization, rating sort)", models.doctors, { ...approvedDoctor, specialization: "Cardiology" }, { rating: -1 }, 20],
    ["public doctor discovery (approved+active, rating sort)", models.doctors, approvedDoctor, { rating: -1 }, 20],
    ["admin pending-doctor queue", models.doctors, { verificationStatus: "pending" }, { createdAt: -1 }, 25],
    ["admin appointment list by status+date", models.appointments, { status: "payment_completed", date: { $gte: plan.anchor } }, { date: 1 }, 25],
    ["doctor day view (doctor, date range)", models.appointments, { doctorId: (await models.doctors.findOne({ verificationStatus: "approved", isActive: true }).select("_id").lean())?._id, date: { $gte: new Date(plan.anchor.getTime() - 30 * 86400000) } }, { date: 1 }, 50],
    ["admin finance: payments by status", models.payments, { status: "completed" }, { createdAt: -1 }, 25],
    ["admin refund queue (pending)", models.refunds, { status: "pending" }, { createdAt: -1 }, 25],
    ["pending doctor payouts", models.payouts, { status: "pending" }, { createdAt: -1 }, 25],
    ["notification inbox (unread for one user)", models.notifications, { recipientId: (await models.notifications.findOne({}).select("recipientId").lean())?.recipientId, readAt: null }, { createdAt: -1 }, 20],
    ["reminder scheduler (pending, due)", models.reminders, { status: "pending", scheduledFor: { $lte: new Date(plan.anchor.getTime() + 2 * 86400000) } }, { scheduledFor: 1 }, 100],
  ];
  const out = [];
  for (const [name, Model, filter, sort, limit] of queries) {
    try {
      const t = Date.now();
      const ex = await Model.find(filter).sort(sort).limit(limit).explain("executionStats");
      const es = ex.executionStats || {};
      const stages = planStages(ex.queryPlanner?.winningPlan);
      out.push({ name, wallMs: Date.now() - t, executionTimeMillis: es.executionTimeMillis, nReturned: es.nReturned, totalKeysExamined: es.totalKeysExamined, totalDocsExamined: es.totalDocsExamined, plan: stages.join(" > "), collscan: stages.some((s) => s.startsWith("COLLSCAN")) });
    } catch (e) { out.push({ name, error: e.message.slice(0, 120) }); }
  }
  return out;
};
