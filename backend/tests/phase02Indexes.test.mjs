// Phase 02 closure -- non-mutating index inventory checks (no database connection). LOCALLY_VERIFIED:
// proves the schema-declared indexes exist in the inventory that migration 011 ensures on every release;
// it does NOT prove they were created in a real database (that needs `npm run test:mongo`).
import assert from "node:assert/strict";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused"; process.env.JWT_SECRET ||= "x";
const { buildInventory, lintInventory, loadAllModels, criticalSpecs } = await import("../migrations/lib/indexInventory.js");
await loadAllModels();
const specs = buildInventory();
const has = (collection, pred) => specs.some((s) => s.collection === collection && pred(s));
const keyOf = (s) => JSON.stringify(s.key);
let n = 0; const t = (name, fn) => { fn(); console.log(`  ok   ${name}`); n += 1; };

t("inventory lints clean (no conflicting/duplicate definitions)", () => { const problems = lintInventory(specs); assert.deepEqual(problems, []); });
t("WalletReservation: unique paymentId index is in the inventory (one reservation per payment)", () => assert.ok(has("walletreservations", (s) => s.unique && keyOf(s) === '{"paymentId":1}')));
t("WalletRecharge: unique gatewayOrderId (recharge identity) and ledger idempotencyKey remain", () => {
  assert.ok(has("walletrecharges", (s) => s.unique && keyOf(s) === '{"gatewayOrderId":1}'));
  assert.ok(has("transactionledgers", (s) => s.unique && keyOf(s) === '{"idempotencyKey":1}'));
});
t("Phase 01 payment-slot partial unique index is still present", () => assert.ok(has("payments", (s) => s.unique && /appointmentId/.test(keyOf(s)) && s.options?.partialFilterExpression)));
t("every new Phase 02 unique index is classed critical (migration blocks on duplicates instead of dropping data)", () => {
  assert.ok(criticalSpecs(specs).some((s) => s.collection === "walletreservations"));
});
console.log(`phase02Indexes: ${n} checks passed`);
process.exit(0);
