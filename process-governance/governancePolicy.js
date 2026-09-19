// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
// Intelligence.
//
// AUDIT FINDING: same pattern as workflow/assignment/assignmentPolicy.js —
// the brief's Section 8 risk-tier control examples ("HIGH needs
// simulation+reviewer, CRITICAL needs approval+segregation") must not be
// hardcoded into the policy engine. This module reads
// HospitalSetting.governancePolicy (admin-editable via the existing
// Settings surface) with the same short-TTL cache convention already
// established, so a settings change is reflected within 30s without a
// live-invalidation wire-up.
// ─────────────────────────────────────────────────────────────────────────

import HospitalSetting from "../models/HospitalSetting.js";

const DEFAULT_POLICY = Object.freeze({
  approvalRequiredTiers: ["high", "critical"],
  simulationRequiredTiers: ["high", "critical"],
  documentationRequiredTiers: ["high", "critical"],
  segregationOfDutiesTiers: ["critical"],
});

let policyCache = null;
let policyCacheAt = 0;
const CACHE_TTL_MS = 30 * 1000;

export async function getGovernancePolicy() {
  const now = Date.now();
  if (policyCache && now - policyCacheAt < CACHE_TTL_MS) return policyCache;

  const settings = await HospitalSetting.findOne({ singletonKey: "global" }).select("governancePolicy").lean();
  const policy = {
    approvalRequiredTiers: settings?.governancePolicy?.approvalRequiredTiers ?? DEFAULT_POLICY.approvalRequiredTiers,
    simulationRequiredTiers: settings?.governancePolicy?.simulationRequiredTiers ?? DEFAULT_POLICY.simulationRequiredTiers,
    documentationRequiredTiers: settings?.governancePolicy?.documentationRequiredTiers ?? DEFAULT_POLICY.documentationRequiredTiers,
    segregationOfDutiesTiers: settings?.governancePolicy?.segregationOfDutiesTiers ?? DEFAULT_POLICY.segregationOfDutiesTiers,
  };
  policyCache = policy;
  policyCacheAt = now;
  return policy;
}

// Same test/administrative hook precedent as invalidateCapacityCache().
export function invalidateGovernancePolicyCache() {
  policyCache = null;
}

const TIER_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

/** Never downgrades — classification can only escalate the structural risk tier, never hide it. */
export function escalateTier(a, b) {
  if (!a) return b || "low";
  if (!b) return a || "low";
  return (TIER_RANK[a] ?? 0) >= (TIER_RANK[b] ?? 0) ? a : b;
}

export function tierAtLeast(tier, threshold) {
  return (TIER_RANK[tier] ?? 0) >= (TIER_RANK[threshold] ?? 0);
}

export const GovernancePolicyDefaults = DEFAULT_POLICY;
