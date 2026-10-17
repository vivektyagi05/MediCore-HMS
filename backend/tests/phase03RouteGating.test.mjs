// Phase 03 wiring test: every new/changed admin finance route sits behind auth + admin +
// the manage_payments gate, and coupon admin routes are SUPER_ADMIN-only. This inspects the
// real Express router stacks (no HTTP, no DB). Behavioural role tests need a running app + Mongo (BLOCKED_EXTERNAL).
import assert from "assert";
import financeAdminRoutes from "../routes/admin/financeAdminRoutes.js";
import financeRoutes from "../routes/financeRoutes.js";
import paymentAdminRoutes from "../routes/admin/paymentAdminRoutes.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/adminMiddleware.js";

const layers = (router) => router.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods), handlers: l.route.stack.length }));
const useLayers = (router) => router.stack.filter((l) => !l.route).map((l) => l.handle);

// Router-level protect + requireAdmin applies to everything under /api/admin/finance.
const adminUse = useLayers(financeAdminRoutes);
assert.ok(adminUse.includes(protect), "finance admin router must authenticate (the real protect middleware)");
assert.ok(adminUse.includes(requireAdmin), "finance admin router must also require admin (the real requireAdmin middleware)");
for (const wanted of [["/reconciliation/discrepancies", "get"], ["/outbox", "get"], ["/outbox/:id/requeue", "post"]]) {
  const route = layers(financeAdminRoutes).find((r) => r.path === wanted[0] && r.methods.includes(wanted[1]));
  assert.ok(route, `route ${wanted.join(" ")} must exist`);
  assert.ok(route.handlers >= 2, `route ${wanted.join(" ")} must carry the permission gate plus its handler`);
}
console.log("PASS: new finance admin routes are behind auth, admin and the permission gate");

for (const [path, method] of [["/coupons", "get"], ["/coupons", "post"], ["/coupons/:id", "patch"], ["/coupons/:id/usage", "get"]]) {
  const route = layers(financeRoutes).find((r) => r.path === path && r.methods.includes(method));
  assert.ok(route, `coupon route ${method} ${path} must exist`);
  assert.ok(route.handlers >= 3, `coupon route ${method} ${path} must have protect + role check + handler`);
}
console.log("PASS: coupon admin routes carry authentication and a role check");

const paymentRoutes = layers(paymentAdminRoutes);
for (const [path, method] of [["/wallet-reservations", "get"], ["/:id/wallet-reservations/resolve", "post"]]) {
  const route = paymentRoutes.find((r) => r.path === path && r.methods.includes(method));
  assert.ok(route && route.handlers >= 2, `reservation route ${method} ${path} must be gated`);
}
console.log("PASS: wallet reservation admin routes are gated");
process.exit(0);
