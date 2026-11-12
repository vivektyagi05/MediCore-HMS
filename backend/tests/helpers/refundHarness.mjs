// Phase 03 refund failure-matrix harness. Drives the REAL refundController (settlePendingGatewayRefund,
// settleOutOfBandGatewayRefund, reconcileRefundRequest, approve/retry handlers), the real refundLock,
// refundEarningAdjustment, financialEmails + emailOutboxService on an in-memory model layer and a FAKED
// payment provider. Crash injection throws at a named production call site. NOT a real MongoDB/Razorpay test.
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused";
process.env.JWT_SECRET ||= "phase03-refund-matrix-secret-123456";
mongoose.set("bufferCommands", false);

const imp = (p) => import(p);
export const M = {
  Payment: (await imp("../../models/Payment.js")).default,
  RefundRequest: (await imp("../../models/RefundRequest.js")).default,
  Wallet: (await imp("../../models/Wallet.js")).default,
  TransactionLedger: (await imp("../../models/TransactionLedger.js")).default,
  DoctorPayout: (await imp("../../models/DoctorPayout.js")).default,
  Doctor: (await imp("../../models/Doctor.js")).default,
  Appointment: (await imp("../../models/Appointment.js")).default,
  EmailDelivery: (await imp("../../models/EmailDelivery.js")).default,
  HospitalSetting: (await imp("../../models/HospitalSetting.js")).default,
  AdminActivityLog: (await imp("../../models/AdminActivityLog.js")).default,
};
export const { installMemoryModels, newId } = await imp("./memoryModels.mjs");
export const RC = await imp("../../controllers/refundController.js");
export const { paymentGateway } = await imp("../../payments/paymentGateway.js");
export const { notificationEmitter } = await imp("../../realtime/notificationEmitter.js");
export const { paymentEmitter } = await imp("../../realtime/paymentEmitter.js");
export const { financeEmitter } = await imp("../../realtime/financeEmitter.js");
export const { default: User } = await imp("../../models/User.js");
export const { financialEmails } = await imp("../../services/financialEmails.js");

export const mem = installMemoryModels([
  { model: M.Payment },
  { model: M.RefundRequest },
  { model: M.Wallet, unique: [{ fields: ["userId"] }] },
  { model: M.TransactionLedger, unique: [{ fields: ["idempotencyKey"], when: (o) => typeof o.idempotencyKey === "string" }] },
  { model: M.DoctorPayout },
  { model: M.Doctor },
  { model: M.EmailDelivery, unique: [{ fields: ["eventKey", "to"] }] },
  { model: M.HospitalSetting },
  { model: M.AdminActivityLog },
]);

const clone = (v) => JSON.parse(JSON.stringify(v));
// the memory layer has no document.save(): persist hydrated documents straight into the store
for (const name of ["Payment", "RefundRequest"]) {
  M[name].prototype.save = async function save() {
    await Promise.resolve();
    mem.collections.get(M[name].modelName).set(String(this._id), clone(this.toObject({ depopulate: true })));
    return this;
  };
}
M.Payment.exists = async (f) => (mem.dump("Payment").find((p) => String(p._id) === String(f._id)) ? { _id: f._id } : null);
M.Appointment.findByIdAndUpdate = async () => null;

// recipients: the doctor's user and the patient resolve to fixed fake mailboxes (the memory layer has no populate)
export const doctorUserId = newId();
M.Doctor.findById = () => ({ select: () => ({ lean: async () => ({ userId: doctorUserId }) }) });
User.findById = (id) => ({ select: () => ({ lean: async () => ({ _id: id, name: String(id) === String(doctorUserId) ? "Dr Test" : "Patient", email: String(id) === String(doctorUserId) ? "doctor@example.test" : "patient@example.test" }) }) });

// ---- notification / realtime stubs (their failure is tested separately, never part of the money path)
export const emitted = { user: [], admin: [] };
notificationEmitter.emitToUser = async (id, p) => { emitted.user.push({ id, ...p }); };
notificationEmitter.emitToAdmins = async (p) => { emitted.admin.push(p); };
paymentEmitter.refundProcessed = async () => {};
financeEmitter.invalidate = () => {};
// the memory layer's populate() is a no-op, so serve the populated recipient the controller expects
{
  const origReceipt = financialEmails.refundProcessed;
  financialEmails.refundProcessed = (args) => origReceipt({ ...args, user: { _id: args.user?._id || args.user, email: "patient@example.test", name: "Patient" } });
}

// ---- fake provider
export const provider = { refundCalls: [], refunds: new Map(), refundImpl: null, fetchFails: false, listFails: false };
paymentGateway.refundPayment = async (args) => {
  provider.refundCalls.push(args);
  if (provider.refundImpl) return provider.refundImpl(args);
  const refund = { id: `rfnd_${provider.refundCalls.length}`, status: "processed", amount: Math.round(args.amount * 100), notes: args.notes };
  provider.refunds.set(refund.id, refund);
  return refund;
};
paymentGateway.fetchRefund = async ({ refundId }) => {
  if (provider.fetchFails) throw new Error("provider lookup failed");
  return provider.refunds.get(refundId) || null;
};
paymentGateway.listPaymentRefunds = async () => {
  if (provider.listFails) throw new Error("provider list failed");
  return [...provider.refunds.values()];
};

// ---- crash injection: throws ONCE at the named production call site
const crashes = new Map();
export const crashAt = (name) => crashes.set(name, true);
const wrap = (obj, fn, name) => {
  const orig = obj[fn].bind(obj);
  obj[fn] = (...args) => {
    if (crashes.get(name)) { crashes.delete(name); throw Object.assign(new Error(`CRASH@${name}`), { crash: true }); }
    return orig(...args);
  };
};
wrap(M.Wallet, "findOneAndUpdate", "wallet-credit");
wrap(M.TransactionLedger, "create", "ledger-write");
wrap(M.DoctorPayout, "findOneAndUpdate", "earning-apply");
wrap(financialEmails, "refundProcessed", "receipt-enqueue"); // process dies at the enqueue call site (enqueueEmail itself swallows store errors by design)
{
  const origSave = M.RefundRequest.prototype.save;
  M.RefundRequest.prototype.save = function save(...a) {
    if (this.status === "processed" && crashes.get("refund-record-save")) { crashes.delete("refund-record-save"); throw Object.assign(new Error("CRASH@refund-record-save"), { crash: true }); }
    return origSave.apply(this, a);
  };
}

// ---- fixtures
export const reset = () => {
  mem.reset(); provider.refundCalls = []; provider.refunds.clear(); provider.refundImpl = null; provider.fetchFails = false; provider.listFails = false;
  emitted.user = []; emitted.admin = []; crashes.clear();
};
export const mkPayment = async (over = {}) => {
  const userId = newId();
  const p = await M.Payment.create({
    userId, doctorId: newId(), appointmentId: newId(), amount: 1000, paymentId: `pay_${newId()}`, razorpayOrderId: `order_${newId()}`, totalAmount: 1000, currency: "INR",
    status: "captured", walletAmount: 0, gatewayAmount: 1000, createdAt: new Date(), ...over,
  });
  return p;
};
export const mkWallet = (userId, balance = 0) => M.Wallet.create({ userId, balance, transactions: [] });
export const mkPayout = async (paymentId, over = {}) =>
  M.DoctorPayout.create({ doctorId: newId(), appointmentId: newId(), paymentId, grossAmount: 1000, doctorAmount: 700, platformFee: 300, status: "pending", ...over });
export const mkRefund = async (payment, over = {}) =>
  M.RefundRequest.create({
    paymentId: payment._id, requestedBy: payment.userId, amount: 400, reason: "cancelled", refundState: "gateway_processing", status: "approved",
    walletRefundAmount: 0, gatewayRefundAmount: 400, attemptCount: 1, gatewayRefundId: "rfnd_x", ...over,
  });
export const dumpOne = (name, id) => mem.dump(name).find((d) => String(d._id) === String(id));
export const ledgerOf = (paymentId) => mem.dump("TransactionLedger").filter((l) => String(l.paymentId) === String(paymentId));
export const doctorNotices = () => mem.dump("EmailDelivery").filter((e) => e.eventKey.startsWith("earning:adjusted:"));
export const receipts = () => mem.dump("EmailDelivery").filter((e) => e.eventKey.startsWith("refund:processed:"));
export const mkRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
export const callHandler = async (handler, { user = newId(), params = {}, body = {} } = {}) => {
  const req = { user: { _id: user, role: "super_admin" }, params, body, query: {}, headers: {}, ip: "127.0.0.1" };
  const res = mkRes(); let err;
  await handler(req, res, (e) => { err = e; });
  return { status: err?.statusCode || res.statusCode, err, body: res.body };
};
