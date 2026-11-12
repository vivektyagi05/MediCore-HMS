// Dry computation over the full generator stream. No DB. Produces exact expected
// counts, distributions, doctor ratings and the slot-uniqueness proof used by
// --dry-run, the seeder (ratings) and the verifier (expected counts).
import { buildCalendar, buildAppointmentBundle, buildSavedDoctors, doctorStateOf, buildPatientUser } from "./generate.mjs";
import { DAY_MS } from "./profile.mjs";

export const COLLECTIONS = Object.freeze({
  users: "users", doctors: "doctors", appointments: "appointments", payments: "payments", invoices: "invoices",
  payouts: "doctorpayouts", ledger: "transactionledgers", refunds: "refundrequests", notes: "medicalnotes",
  prescriptions: "prescriptions", reviews: "reviews", notifications: "notificationdeliveries", reminders: "reminderlogs",
  chats: "chatmessages", saved: "saveddoctors", adminLogs: "adminactivitylogs", cronLogs: "cronrunlogs", automationLogs: "automationrunlogs",
});

const bump = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; };
const bucketOf = (o) => (o < -90 ? "past_91_150d" : o < -30 ? "past_31_90d" : o < 0 ? "past_1_30d" : o === 0 ? "today" : o <= 7 ? "future_1_7d" : "future_8_28d");

export const computePlanPass = (plan) => {
  const cal = buildCalendar(plan);
  const counts = {
    users: plan.admins + plan.doctors + plan.patients, doctors: plan.doctors, appointments: 0, payments: 0, invoices: 0, payouts: 0, ledger: 0, refunds: 0,
    notes: 0, prescriptions: 0, reviews: 0, notifications: 0, reminders: 0, chats: 0, saved: 0,
    adminLogs: plan.adminLogs, cronLogs: plan.cronLogs, automationLogs: plan.automationLogs,
  };
  const dist = { doctorState: {}, scenario: {}, apptStatus: {}, paymentStatus: {}, dateBucket: {}, notificationRead: { read: 0, unread: 0 }, reminderStatus: {}, paymentDocStatus: {}, refundStatus: {}, payoutStatus: {}, prescriptionStatus: {} };
  for (let i = 0; i < plan.doctors; i += 1) bump(dist.doctorState, doctorStateOf(i));
  const sums = new Map(); // doctorIdx -> [sum, n]
  const keys = new Set(); let collisions = 0;
  if (plan.appointments > cal.capacityPerDoctor * Math.max(plan.pool, 1)) throw new Error("appointment count exceeds slot capacity");
  const perDoctorMax = plan.pool ? Math.ceil(plan.appointments / plan.pool) : 0;
  if (perDoctorMax > cal.capacityPerDoctor) throw new Error(`per-doctor appointment volume (${perDoctorMax}) exceeds the calendar slot capacity (${cal.capacityPerDoctor}); lower --scale`);
  for (let a = 0; a < plan.appointments; a += 1) {
    const b = buildAppointmentBundle(plan, cal, a);
    const m = b._meta;
    if (keys.has(m.key)) collisions += 1; else keys.add(m.key);
    counts.appointments += 1;
    for (const k of ["payments", "invoices", "payouts", "ledger", "refunds", "notes", "prescriptions", "reviews", "notifications", "reminders", "chats"]) counts[k] += b[k].length;
    bump(dist.scenario, m.scenario); bump(dist.apptStatus, m.status); bump(dist.paymentStatus, m.paymentStatus); bump(dist.dateBucket, bucketOf(m.offset));
    for (const n of b.notifications) bump(dist.notificationRead, n.readAt ? "read" : "unread");
    for (const r of b.reminders) bump(dist.reminderStatus, r.status);
    for (const p of b.payments) bump(dist.paymentDocStatus, p.status);
    for (const r of b.refunds) bump(dist.refundStatus, r.status);
    for (const p of b.payouts) bump(dist.payoutStatus, p.status);
    for (const p of b.prescriptions) bump(dist.prescriptionStatus, p.status);
    for (const r of b.reviews) {
      if (r.adminDeleted) continue;
      const cur = sums.get(m.docIdx) || [0, 0];
      sums.set(m.docIdx, [cur[0] + r.rating, cur[1] + 1]);
    }
  }
  for (let i = 0; i < plan.patients; i += 1) counts.saved += buildSavedDoctors(plan, i).length;
  const login = { admins: plan.admins, doctorsLoginable: 0, doctorsInactive: 0, patientsLoginable: 0, patientsInactive: 0 };
  for (let i = 0; i < plan.doctors; i += 1) { if (doctorStateOf(i) === "approved_inactive") login.doctorsInactive += 1; else login.doctorsLoginable += 1; }
  for (let i = 0; i < plan.patients; i += 1) { if (buildPatientUser(plan, i, { passwordHash: "x" }).isActive) login.patientsLoginable += 1; else login.patientsInactive += 1; }
  const ratings = new Map();
  for (const [d, [s, n]] of sums) ratings.set(d, Number((s / n).toFixed(1)));
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  return { counts, dist, login, ratings, slotCollisions: collisions, total, calendar: { days: cal.offsets.length, slotsPerDay: 10, capacityPerDoctor: cal.capacityPerDoctor }, anchor: plan.anchor, windowDays: [-150, 28], DAY_MS };
};
