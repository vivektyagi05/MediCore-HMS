// Regression test for Phase 20 (feature toggles): five seeded, admin-editable
// toggles -- wallet_system, subscriptions, reviews, chat, ai_features -- had
// NO runtime consumer at all before this fix. Switching any of them off in
// the admin UI changed nothing about what a patient or doctor could
// actually do; rolloutPercentage was stored and shown but never consulted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import FeatureToggle from "../models/FeatureToggle.js";
import {
  clearFeatureToggleCacheForTesting,
  isFeatureEnabled,
  rolloutBucket,
} from "../services/featureToggleService.js";

console.log("featureToggleEnforcement.test.mjs");

// ── deterministic in-memory fake of FeatureToggle ────────────────────────
const rows = new Map();
FeatureToggle.findOne = (filter) => ({
  select: () => ({ lean: async () => rows.get(filter.key) || null }),
});
const setToggle = (key, doc) => rows.set(key, doc);

// ── on/off ────────────────────────────────────────────────────────────────
clearFeatureToggleCacheForTesting();
setToggle("chat", { isEnabled: true, rolloutPercentage: 100 });
assert.equal(await isFeatureEnabled("chat"), true);
clearFeatureToggleCacheForTesting();
setToggle("chat", { isEnabled: false, rolloutPercentage: 100 });
assert.equal(await isFeatureEnabled("chat"), false);
console.log("PASS: isFeatureEnabled reflects isEnabled");

// ── absent row never restricts a feature nobody has configured ──────────
clearFeatureToggleCacheForTesting();
rows.delete("some_unconfigured_feature");
assert.equal(await isFeatureEnabled("some_unconfigured_feature"), true);
console.log("PASS: a feature with no toggle row at all is treated as enabled, not silently disabled");

// ── rollout percentage: deterministic per user, boundary-correct ────────
clearFeatureToggleCacheForTesting();
setToggle("ai_features", { isEnabled: true, rolloutPercentage: 0 });
assert.equal(await isFeatureEnabled("ai_features", { userId: "u1" }), false, "0% rollout must exclude everyone");
clearFeatureToggleCacheForTesting();
setToggle("ai_features", { isEnabled: true, rolloutPercentage: 100 });
assert.equal(await isFeatureEnabled("ai_features", { userId: "u1" }), true, "100% rollout must include everyone");

const bucket = rolloutBucket("stable-user-id", "ai_features");
assert.ok(bucket >= 0 && bucket < 100);
assert.equal(rolloutBucket("stable-user-id", "ai_features"), bucket, "the same user+feature must always hash to the same bucket");
clearFeatureToggleCacheForTesting();
setToggle("ai_features", { isEnabled: true, rolloutPercentage: bucket }); // strictly below the bucket excludes it
assert.equal(await isFeatureEnabled("ai_features", { userId: "stable-user-id" }), false);
clearFeatureToggleCacheForTesting();
setToggle("ai_features", { isEnabled: true, rolloutPercentage: bucket + 1 });
assert.equal(await isFeatureEnabled("ai_features", { userId: "stable-user-id" }), true);
console.log("PASS: rolloutPercentage is a real, deterministic per-user gradual rollout, not a stored-but-unused number");

// ── caching: a flip is picked up, not stuck forever ──────────────────────
clearFeatureToggleCacheForTesting();
setToggle("reviews", { isEnabled: true, rolloutPercentage: 100 });
assert.equal(await isFeatureEnabled("reviews"), true);
setToggle("reviews", { isEnabled: false, rolloutPercentage: 100 }); // simulate an admin flipping it, cache not yet cleared
assert.equal(await isFeatureEnabled("reviews"), true, "still within the cache TTL");
clearFeatureToggleCacheForTesting();
assert.equal(await isFeatureEnabled("reviews"), false, "after the cache clears, the new value is read");
console.log("PASS: toggle reads are cached briefly, and a cleared cache picks up the current value");

// ── real wiring: every named toggle actually gates a real entry point ────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

assert.match(read("routes/financeRoutes.js"), /requireFeatureEnabled\("wallet_system"/);
assert.match(read("routes/financeRoutes.js"), /requireFeatureEnabled\("subscriptions"/);
assert.match(read("routes/patient/workflowRoutes.js"), /requireFeatureEnabled\("reviews"/);
assert.match(read("socket/eventHandlers.js"), /isFeatureEnabled\("chat"/);
assert.match(read("routes/aiRoutes.js"), /requireFeatureEnabled\("ai_features"/);
assert.match(read("routes/aiAssistRoutes.js"), /requireFeatureEnabled\("ai_features"/);
console.log("PASS: wallet_system, subscriptions, reviews, chat, and ai_features each gate a real route/socket entry point");

// ── admin AI tooling stays reachable even when patient-facing AI is off ──
const aiRoutesSrc = read("routes/aiRoutes.js");
const adminSection = aiRoutesSrc.slice(aiRoutesSrc.indexOf('router.get("/insights"'));
assert.doesNotMatch(adminSection, /requireFeatureEnabled/, "admin insight/health/automation endpoints must not be gated by the patient-facing ai_features toggle");
console.log("PASS: admin AI monitoring/automation endpoints remain reachable regardless of the ai_features toggle");

// ── super_admin support chat is never blocked by the chat toggle ─────────
const eventHandlersSrc = read("socket/eventHandlers.js");
const chatSendStart = eventHandlersSrc.indexOf('on("chat:send"');
const chatSendFn = eventHandlersSrc.slice(chatSendStart, eventHandlersSrc.indexOf("const conversationKey", chatSendStart));
assert.match(chatSendFn, /ADMIN_ROLES\.includes\(socket\.user\.role\)/, "an admin participant must bypass the chat toggle so support escalations are never cut off");
console.log("PASS: disabling chat never blocks super_admin support conversations");
