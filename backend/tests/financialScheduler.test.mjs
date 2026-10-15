// N-002: scheduler registration, role topology, startup verification, graceful stop.
import assert from "assert";
import { startFinancialScheduler, stopFinancialScheduler, getSchedulerStatus, FINANCIAL_JOBS } from "../cron/financialScheduler.js";
import { resolveServiceRole, shouldRunScheduler, validateProductionConfig } from "../config/productionGuards.js";

assert.strictEqual(await startFinancialScheduler({ enabled: false }), false);
assert.strictEqual(getSchedulerStatus().enabled, false, "disabled scheduler must not claim to be running");
const names = FINANCIAL_JOBS.map((j) => j.name);
for (const required of ["processEmailOutbox", "expirePaymentWindows", "retryFailedPayments", "reconciliation", "subscriptionRenewals", "appointmentLifecycleSweep"]) {
  assert.ok(names.includes(required), `${required} must be scheduled`);
}

// startup is refused (loudly) when the lock index is missing
await assert.rejects(() => startFinancialScheduler({ enabled: true, verifyIndex: async () => false }), /lock index/i);
assert.strictEqual(getSchedulerStatus().enabled, false, "a scheduler that cannot lock must not start");

// starts when verified; duplicate registration is a no-op (one timer set)
assert.strictEqual(await startFinancialScheduler({ enabled: true, verifyIndex: async () => true }), true);
assert.strictEqual(getSchedulerStatus().enabled, true);
assert.strictEqual(await startFinancialScheduler({ enabled: true, verifyIndex: async () => true }), true);
assert.strictEqual(getSchedulerStatus().enabled, true);

// graceful stop: timers + boot timeout cleared, promise resolves
const stopped = stopFinancialScheduler({ timeoutMs: 200 });
assert.strictEqual(getSchedulerStatus().enabled, false, "timers are cleared synchronously");
const drained = await stopped;
assert.deepStrictEqual(drained.abandoned, []);
assert.strictEqual(getSchedulerStatus().stopping, false);

// restart after stop works
assert.strictEqual(await startFinancialScheduler({ enabled: true, verifyIndex: async () => true }), true);
await stopFinancialScheduler({ timeoutMs: 50 });

// ── role topology ────────────────────────────────────────────────────────
assert.strictEqual(resolveServiceRole({}), "all");
assert.strictEqual(shouldRunScheduler({ SERVICE_ROLE: "web", ENABLE_IN_PROCESS_SCHEDULER: "true" }), false, "web replicas never run the scheduler");
assert.strictEqual(shouldRunScheduler({ SERVICE_ROLE: "worker" }), true);
assert.strictEqual(shouldRunScheduler({ SERVICE_ROLE: "all", ENABLE_IN_PROCESS_SCHEDULER: "false" }), false);
assert.strictEqual(shouldRunScheduler({ SERVICE_ROLE: "all", ENABLE_IN_PROCESS_SCHEDULER: "true", NODE_ENV: "production" }), true);
assert.strictEqual(shouldRunScheduler({ NODE_ENV: "development" }), true);

// production must choose a role explicitly
const prodBase = {
  NODE_ENV: "production", MONGO_URI: "mongodb+srv://u:p@cluster0.example.net/hms", JWT_SECRET: "x".repeat(40) + "Zq9!",
  CORS_ORIGIN: "https://app.example.org", FRONTEND_URL: "https://app.example.org",
  RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w",
  BREVO_API_KEY: "k", BREVO_SENDER_EMAIL: "a@b.org", GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-2.5-flash",
  STORAGE_DRIVER: "s3", STORAGE_S3_BUCKET: "b", STORAGE_S3_REGION: "r",
};
assert.ok(validateProductionConfig(prodBase).some((p) => /SERVICE_ROLE is required/.test(p)));
assert.ok(validateProductionConfig({ ...prodBase, SERVICE_ROLE: "banana" }).some((p) => /not recognised/.test(p)));
assert.ok(validateProductionConfig({ ...prodBase, SERVICE_ROLE: "all" }).some((p) => /ENABLE_IN_PROCESS_SCHEDULER/.test(p)));
assert.deepStrictEqual(validateProductionConfig({ ...prodBase, SERVICE_ROLE: "worker" }), []);
assert.deepStrictEqual(validateProductionConfig({ ...prodBase, SERVICE_ROLE: "web" }), []);
assert.deepStrictEqual(validateProductionConfig({ ...prodBase, SERVICE_ROLE: "all", ENABLE_IN_PROCESS_SCHEDULER: "true" }), []);
console.log("PASS: scheduler start verification, duplicate registration, graceful stop, restart, role topology, production role guard");
process.exit(0);
