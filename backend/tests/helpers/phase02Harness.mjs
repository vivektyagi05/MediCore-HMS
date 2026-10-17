// Shared harness for the Phase 02 application-path tests: REAL controllers/services (createPaymentOrder,
// verifyPayment, webhook handler, recharge controller, recovery jobs) on the in-memory model layer, an in-memory
// wallet-reservation store, and a FAKED provider. Not a real MongoDB or Razorpay test.
import crypto from "node:crypto";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused";
process.env.JWT_SECRET ||= "phase02-matrix-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_phase02_matrix";
mongoose.set("bufferCommands", false);

const imp = (p) => import(p);
export const M = {
  Payment: (await imp("../../models/Payment.js")).default,
  PaymentAttempt: (await imp("../../models/PaymentAttempt.js")).default,
  WebhookEvent: (await imp("../../models/WebhookEvent.js")).default,
  Subscription: (await imp("../../models/Subscription.js")).default,
  RefundRequest: (await imp("../../models/RefundRequest.js")).default,
  Invoice: (await imp("../../models/Invoice.js")).default,
  Coupon: (await imp("../../models/Coupon.js")).default,
  Wallet: (await imp("../../models/Wallet.js")).default,
  WalletRecharge: (await imp("../../models/WalletRecharge.js")).default,
  WalletReservation: (await imp("../../models/WalletReservation.js")).default,
  TransactionLedger: (await imp("../../models/TransactionLedger.js")).default,
  Appointment: (await imp("../../models/Appointment.js")).default,
  HospitalSetting: (await imp("../../models/HospitalSetting.js")).default,
};
export const { installMemoryModels, newId } = await imp("./memoryModels.mjs");
export const { createMemoryStore, injectFailure } = await imp("./walletMemoryStore.mjs");
export const { paymentGateway } = await imp("../../payments/paymentGateway.js");
export const { paymentDeps } = await imp("../../payments/paymentDeps.js");
export const WR = await imp("../../payments/walletReservationService.js");
export const RS = await imp("../../payments/walletRechargeService.js");
export const WH = await imp("../../payments/webhookHandler.js");
export const PC = await imp("../../controllers/paymentController.js");
export const FC = await imp("../../controllers/financeController.js");
export const { couponService } = await imp("../../payments/couponService.js");
export const T = await imp("../../payments/paymentTransitions.js");

export const mem = installMemoryModels([
  { model: M.Payment, unique: [{ fields: ["razorpayOrderId"] }, { fields: ["idempotencyKey"], when: (o) => typeof o.idempotencyKey === "string" }, { fields: ["activeAppointmentSlot", "appointmentId"], when: (o) => o.activeAppointmentSlot === true }] },
  { model: M.PaymentAttempt, unique: [{ fields: ["paymentId", "attemptNumber"] }, { fields: ["gateway", "gatewayOrderId"] }] },
  { model: M.WebhookEvent, unique: [{ fields: ["eventId"] }] },
  { model: M.Subscription }, { model: M.RefundRequest }, { model: M.Invoice },
  { model: M.Coupon }, { model: M.Wallet, unique: [{ fields: ["userId"] }] },
  { model: M.WalletRecharge, unique: [{ fields: ["gatewayOrderId"] }] },
  { model: M.TransactionLedger, unique: [{ fields: ["idempotencyKey"], when: (o) => typeof o.idempotencyKey === "string" }] },
  { model: M.HospitalSetting },
]);

// the memory layer does not stamp timestamps; production Payment rows always have createdAt
const origCreate = M.Payment.create.bind(M.Payment);
M.Payment.create = (doc, ...rest) => origCreate({ createdAt: new Date(), updatedAt: new Date(), ...doc }, ...rest);

// ---- fake provider
export const provider = { orders: new Map(), createOrderCalls: 0, createOrderHook: null, seq: 0 };
paymentGateway.mode = () => "razorpay";
paymentGateway.keyId = () => "rzp_test_key";
paymentGateway.createOrder = async (args) => {
  provider.createOrderCalls += 1;
  if (provider.createOrderHook) return provider.createOrderHook(args);
  const order = { id: `order_${++provider.seq}`, amount: Math.round(args.amount * 100), currency: args.currency, receipt: args.receipt };
  provider.orders.set(args.receipt, order);
  return order;
};
paymentGateway.findOrderByReceipt = async ({ receipt }) => provider.orders.get(receipt) || null;
paymentGateway.verifyPaymentSignature = () => true;
paymentDeps.emit = async () => {};

// ---- appointment fixture (populate chain is a no-op in the memory layer, so the controller's populated view is served explicitly)
export const appts = new Map();
const view = (a) => ({ ...a, patientId: { _id: a.patientId }, doctorId: { _id: a.doctorRef, fees: a.fees, userId: { name: "Dr Test" } } });
M.Appointment.findById = (id) => {
  const raw = appts.get(String(id)); let populated = false;
  const q = { populate() { populated = true; return q; }, select() { return q; }, lean() { return q; }, then: (res, rej) => Promise.resolve(raw ? (populated ? view(raw) : { ...raw }) : null).then(res, rej) };
  return q;
};
M.Appointment.findOneAndUpdate = (filter, update) => {
  const a = appts.get(String(filter._id));
  const ok = a && (!filter.status || (filter.status.$in ? filter.status.$in.includes(a.status) : filter.status === a.status));
  const q = { lean() { return q; }, select() { return q; }, then: (res, rej) => { if (ok) { Object.assign(a, update.$set || {}); } return Promise.resolve(ok ? { ...a } : null).then(res, rej); } };
  return q;
};
export const mkAppointment = (over = {}) => {
  const a = { _id: newId(), status: "payment_pending", paymentStatus: "pending", patientId: newId(), doctorRef: newId(), fees: 500, date: new Date(Date.now() + 3 * 86400000), timeSlot: "10:00 AM", consultationType: "online", ...over };
  appts.set(String(a._id), a); return a;
};

// ---- calling controllers
const mkRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
export const call = async (handler, user, { body = {}, params = {}, query = {} } = {}) => {
  const req = { user: { _id: user, role: "patient" }, body, params, query, headers: {}, ip: "127.0.0.1" }; const res = mkRes(); let err;
  await handler(req, res, (e) => { err = e; });
  return { status: err?.statusCode || res.statusCode, err, code: err?.details?.code, body: res.body };
};
export const hmac = (raw) => crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
let ev = 0;
export const deliver = async (event) => {
  const raw = Buffer.from(JSON.stringify(event)); const eventId = `evt_${++ev}`;
  const req = { body: raw, headers: { "x-razorpay-signature": hmac(raw), "x-razorpay-event-id": eventId } }; const res = mkRes(); let err;
  await WH.razorpayWebhookHandler(req, res, (e) => { err = e; });
  return { status: res.statusCode, body: res.body, err, eventId };
};
export const capturedEvent = ({ orderId, id = "pay_1", amount, currency = "INR" }) => ({ event: "payment.captured", created_at: 1760000000, payload: { payment: { entity: { id, order_id: orderId, status: "captured", amount, currency, captured: true } } } });
export const failedEvent = ({ orderId, id = "pay_f1" }) => ({ event: "payment.failed", payload: { payment: { entity: { id, order_id: orderId, status: "failed", error_code: "X", error_description: "declined" } } } });
export const providerSays = (over) => { paymentGateway.fetchPayment = async ({ paymentId, orderId }) => ({ id: paymentId, order_id: orderId, status: "captured", currency: "INR", ...over }); };

export const reset = () => {
  mem.reset(); appts.clear(); provider.orders.clear(); provider.createOrderCalls = 0; provider.createOrderHook = null; provider.seq = 0;
  WR.walletReservationDeps.store = createMemoryStore({ balances: {} });
  return WR.walletReservationDeps.store;
};
export const fund = (store, userId, balance) => { store.wallets.set(String(userId), { _id: new mongoose.Types.ObjectId().toString(), userId, balance, holds: [], transactions: [] }); };
export const keyFor = () => `idem-${crypto.randomUUID()}`;
