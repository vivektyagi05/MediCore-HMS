// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Bottleneck Analyzer (supports brief Step 9 — Workflow Optimization).
//
// AUDIT FINDING: monitoringAggregates.buildFlowHealthRanking() (A6.2.4)
// already ranks flows by avgDurationMs/successRate — reused directly here
// for "slow" and "noisy" rather than re-querying AutomationRunLog. What it
// does NOT do (and this module adds) is structural analysis of the flow
// DEFINITIONS themselves: unused (no runs in 30 days), duplicate-trigger
// (two+ published flows on the identical triggerType with no distinguishing
// condition), and expensive (step count), none of which buildFlowHealthRanking
// touches since it only reads AutomationFlow.stats, not AutomationFlow.actions/
// triggerType/conditions structurally.
// ─────────────────────────────────────────────────────────────────────────

import AutomationFlow from "../../models/AutomationFlow.js";
import { buildFlowHealthRanking } from "../../monitoring/monitoringAggregates.js";

const UNUSED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function conditionsSignature(conditions) {
  // Cheap structural fingerprint — same shape of conditions collapses to
  // the same string. Not a semantic equivalence check (two conditions that
  // are logically identical but written differently won't match), which is
  // disclosed rather than presented as a perfect duplicate detector.
  try {
    return JSON.stringify(conditions || null);
  } catch {
    return "unserializable";
  }
}

export async function analyzeBottlenecks() {
  const [flows, healthRanking] = await Promise.all([
    AutomationFlow.find({}).select("name status triggerType conditions actions stats").lean(),
    buildFlowHealthRanking(),
  ]);

  const now = Date.now();
  const published = flows.filter((f) => f.status === "published");

  const unused = published.filter((f) => {
    const lastRun = f.stats?.lastRunAt ? new Date(f.stats.lastRunAt).getTime() : null;
    return !lastRun || now - lastRun > UNUSED_WINDOW_MS;
  });

  const byTriggerSignature = new Map();
  for (const f of published) {
    const key = `${f.triggerType}::${conditionsSignature(f.conditions)}`;
    if (!byTriggerSignature.has(key)) byTriggerSignature.set(key, []);
    byTriggerSignature.get(key).push(f);
  }
  const duplicates = [...byTriggerSignature.values()].filter((group) => group.length > 1);

  const expensive = published
    .map((f) => ({ id: f._id, name: f.name, stepCount: (f.actions || []).length }))
    .filter((f) => f.stepCount >= 5)
    .sort((a, b) => b.stepCount - a.stepCount);

  return {
    totalFlows: flows.length,
    publishedFlows: published.length,
    unused: unused.map((f) => ({ id: f._id, name: f.name, lastRunAt: f.stats?.lastRunAt || null })),
    duplicateTriggerGroups: duplicates.map((group) => ({
      triggerType: group[0].triggerType,
      flowIds: group.map((f) => f._id),
      flowNames: group.map((f) => f.name),
    })),
    expensive,
    slow: healthRanking.topSlow, // reused verbatim from A6.2.4, never re-derived
    noisy: healthRanking.topFailing, // reused verbatim from A6.2.4, never re-derived
  };
}
