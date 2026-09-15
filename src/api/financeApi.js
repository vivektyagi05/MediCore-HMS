import apiClient from "./axios";

export const financeApi = {
  validateCoupon(payload) {
    return apiClient.post("/finance/coupons/validate", payload).then((res) => res.data);
  },
  getCoupons(params = {}) {
    return apiClient.get("/finance/coupons", { params }).then((res) => res.data);
  },
  createCoupon(payload) {
    return apiClient.post("/finance/coupons", payload).then((res) => res.data);
  },
  updateCoupon(id, payload) {
    return apiClient.patch(`/finance/coupons/${id}`, payload).then((res) => res.data);
  },
  getPlans() {
    return apiClient.get("/finance/subscriptions/plans").then((res) => res.data);
  },
  getSubscriptions() {
    return apiClient.get("/finance/subscriptions").then((res) => res.data);
  },
  createSubscription(payload) {
    return apiClient.post("/finance/subscriptions", payload).then((res) => res.data);
  },
  cancelSubscription(id) {
    return apiClient.patch(`/finance/subscriptions/${id}/cancel`).then((res) => res.data);
  },
  getLedger(params = {}) {
    return apiClient.get("/finance/ledger", { params }).then((res) => res.data);
  },
  createWalletRechargeOrder(payload) {
    return apiClient.post("/finance/wallet/recharge/orders", payload).then((res) => res.data);
  },
  verifyWalletRecharge(payload) {
    return apiClient.post("/finance/wallet/recharge/verify", payload).then((res) => res.data);
  },
  // P23 Bug 2 fix — real recharge lifecycle recovery/history support.
  cancelWalletRecharge(payload) {
    return apiClient.post("/finance/wallet/recharge/cancel", payload).then((res) => res.data);
  },
  getWalletRechargeStatus(gatewayOrderId) {
    return apiClient.get(`/finance/wallet/recharge/${gatewayOrderId}/status`).then((res) => res.data);
  },
  getWalletRechargeHistory(params = {}) {
    return apiClient.get("/finance/wallet/recharge/history", { params }).then((res) => res.data);
  },
  retryDuePayments() {
    return apiClient.post("/finance/payments/retry-due").then((res) => res.data);
  },
  getReconciliationReport() {
    return apiClient.get("/finance/reconciliation").then((res) => res.data);
  },
  // PHASE UI-7: the backend action already existed
  // (reconciliationService.repairIncompletePayments, mounted at
  // POST /finance/reconciliation/repair) but had no frontend wrapper —
  // Finance Operations' Reconciliation panel is the first real caller.
  // Narrowly scoped: only safely re-runs idempotent post-processing for
  // captured payments missing an Invoice/DoctorPayout, never a blind
  // auto-correct of any other financial record.
  repairIncompletePayments() {
    return apiClient.post("/finance/reconciliation/repair").then((res) => res.data);
  },
};
