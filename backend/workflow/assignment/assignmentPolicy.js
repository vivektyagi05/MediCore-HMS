// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentPolicy (brief Step 6 — Workload Balancer / Capacity Rules).
//
// AUDIT FINDING: backend/workflow/policies.js already exports an
// `AssignmentPolicy` object, but it only answers "is this user's ROLE
// allowed to be assigned at all" (eligibility). Nothing anywhere answered
// "is this specific admin, right now, too busy to take more work" — that is
// a genuinely different question (capacity, not permission), so this module
// is additive, not a duplicate: it re-exports the existing eligibility
// policy unchanged and layers real, admin-configurable capacity rules on
// top (from HospitalSetting.operationsCapacity — see that model's AUDIT
// FINDING for why a hardcoded number was rejected).
// ─────────────────────────────────────────────────────────────────────────

import HospitalSetting from "../../models/HospitalSetting.js";
import { AssignmentPolicy as EligibilityPolicy, EscalationPolicy } from "../policies.js";

const DEFAULT_CAPACITY = { maxOpenItemsPerAdmin: 12, overloadThresholdPct: 85 };

// Re-exported so every consumer of "the Assignment Policy" can import one
// module and get both eligibility and capacity rules, without this file
// redefining eligibility itself.
export { EligibilityPolicy, EscalationPolicy };

let capacityCache = null;
let capacityCacheAt = 0;
const CACHE_TTL_MS = 30 * 1000; // short-lived: admin-editable, must reflect changes quickly

export async function getCapacitySettings() {
  const now = Date.now();
  if (capacityCache && now - capacityCacheAt < CACHE_TTL_MS) return capacityCache;

  const settings = await HospitalSetting.findOne({ singletonKey: "global" }).select("operationsCapacity").lean();
  const capacity = {
    maxOpenItemsPerAdmin: settings?.operationsCapacity?.maxOpenItemsPerAdmin ?? DEFAULT_CAPACITY.maxOpenItemsPerAdmin,
    overloadThresholdPct: settings?.operationsCapacity?.overloadThresholdPct ?? DEFAULT_CAPACITY.overloadThresholdPct,
  };
  capacityCache = capacity;
  capacityCacheAt = now;
  return capacity;
}

// Test/administrative hook — never called from request-handling code, only
// from the settings update path if a future caller wants an immediate
// refresh instead of waiting out the short TTL.
export function invalidateCapacityCache() {
  capacityCache = null;
}

/**
 * @param {number} openCount - real count of open (non-resolved/cancelled)
 *   OperationAssignment rows currently assigned to this admin.
 * @param {{maxOpenItemsPerAdmin:number, overloadThresholdPct:number}} capacity
 */
export function computeUtilization(openCount, capacity) {
  const max = Math.max(1, capacity.maxOpenItemsPerAdmin);
  const pct = Math.round(Math.min(999, (openCount / max) * 100));
  const overloadAt = capacity.overloadThresholdPct;
  let state;
  if (pct >= 100) state = "at_capacity"; // Step 6: "Never assign" past 100%
  else if (pct >= overloadAt) state = "near_capacity"; // Step 6: "Recommend another admin"
  else state = "available";
  return { openCount, max, pct, state };
}

/** Step 6 rule, made explicit and reusable: an admin at/over 100% utilization is never a valid auto-assign target. */
export function isAssignable(utilization) {
  return utilization.state !== "at_capacity";
}

export const WorkloadBalancerPolicy = Object.freeze({
  computeUtilization,
  isAssignable,
});
