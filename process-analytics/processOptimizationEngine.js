// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.4 — Process Analytics & Optimization Intelligence.
//
// Section 12/13/27: every candidate here is a deterministic rule applied
// to real, already-computed analytics (processAnalyticsAggregates.js) —
// never an AI guess, never a fabricated percentage-improvement claim.
// Detection is read + upsert-only against ProcessOptimizationRecommendation
// and NEVER touches ProcessDefinition. Turning a recommendation into a
// real proposed version (Section 13's "Generate Proposed Version" step)
// reuses the Process Designer's own existing fork-on-edit lifecycle —
// see generateProposedVersion() below, which calls nothing but
// ProcessDefinition.create() with status:"draft", exactly the shape
// processDesignerController.js#updateProcess already produces when
// forking. Validation/simulation/publish/activation are the admin's own
// subsequent, ordinary Process Designer actions — never bypassed here.
// ─────────────────────────────────────────────────────────────────────────

import ProcessDefinition from "../models/ProcessDefinition.js";
import ProcessOptimizationRecommendation from "../models/ProcessOptimizationRecommendation.js";
import {
  buildBottleneckAnalysis,
  buildSlaIntelligence,
  buildVersionIntelligence,
  buildProcessHealthScore,
  MIN_SAMPLE_SIZE,
} from "./processAnalyticsAggregates.js";

const SLOW_NODE_FAILURE_THRESHOLD = 20; // % — Section 12 examples
const HIGH_SKIP_THRESHOLD = 20; // %
const SLA_BREACH_THRESHOLD = 10; // %
const HEALTH_DEGRADED_THRESHOLD = 65;

export function severityFromRate(rate, { high = 40, medium = 20 } = {}) {
  if (rate >= high) return "critical";
  if (rate >= medium) return "high";
  return "medium";
}

async function detectNodeCandidates({ key, version, rangeDays }) {
  const bottlenecks = await buildBottleneckAnalysis({ key, version, rangeDays });
  const candidates = [];

  for (const node of bottlenecks.highestFailureNodes) {
    if (node.failureRate < SLOW_NODE_FAILURE_THRESHOLD) continue;
    candidates.push({
      issueType: "failing_node",
      severity: severityFromRate(node.failureRate),
      confidence: node.confidence,
      affectedNodeIds: [node.nodeId],
      evidence: node,
      dataPeriodDays: rangeDays,
      issue: `Node "${node.nodeId}" (${node.nodeType}) failed on ${node.failureRate}% of ${node.executionCount} executions in the last ${rangeDays} days.`,
      recommendedChange: `Review the action configuration for node "${node.nodeId}" — check its target service/config for the recurring failure cause before the next publish.`,
      why: `${node.failureCount} of ${node.executionCount} real executions of this node failed.`,
      expectedBenefit: `Node "${node.nodeId}" accounts for ${node.failureRate}% of observed failures on its own executions over the last ${rangeDays} days.`,
    });
  }

  const slowest = bottlenecks.slowestNodes[0];
  if (slowest && slowest.avgDurationMs !== null) {
    const others = bottlenecks.nodes.filter((n) => n.nodeId !== slowest.nodeId && n.avgDurationMs !== null);
    const otherAvg = others.length ? others.reduce((a, n) => a + n.avgDurationMs, 0) / others.length : null;
    if (otherAvg && slowest.avgDurationMs > otherAvg * 2) {
      candidates.push({
        issueType: "slow_node",
        severity: slowest.avgDurationMs > otherAvg * 4 ? "high" : "medium",
        confidence: slowest.confidence,
        affectedNodeIds: [slowest.nodeId],
        evidence: slowest,
        dataPeriodDays: rangeDays,
        issue: `Node "${slowest.nodeId}" (${slowest.nodeType}) averages ${slowest.avgDurationMs}ms — more than double the process's other node average of ${Math.round(otherAvg)}ms.`,
        recommendedChange: `Investigate why node "${slowest.nodeId}" is disproportionately slow relative to the rest of this process's real node average.`,
        why: `Average duration of ${slowest.avgDurationMs}ms vs a ${Math.round(otherAvg)}ms average across the process's other nodes.`,
        expectedBenefit: `This node is ${Math.round(slowest.avgDurationMs / otherAvg)}x slower on average than the process's other nodes, based on ${slowest.executionCount} real executions.`,
      });
    }
  }

  for (const node of bottlenecks.highestSkipNodes) {
    const skipRate = node.executionCount ? Math.round((node.skipCount / node.executionCount) * 1000) / 10 : 0;
    if (skipRate < HIGH_SKIP_THRESHOLD) continue;
    candidates.push({
      issueType: "high_skip_node",
      severity: "low",
      confidence: node.confidence,
      affectedNodeIds: [node.nodeId],
      evidence: { ...node, skipRate },
      dataPeriodDays: rangeDays,
      issue: `Node "${node.nodeId}" (${node.nodeType}) was skipped on ${skipRate}% of ${node.executionCount} executions — likely a condition/decision gate that rarely opens this path.`,
      recommendedChange: `Review whether this node's upstream condition is configured as intended — it is rarely reached.`,
      why: `${node.skipCount} of ${node.executionCount} real executions skipped this node.`,
      expectedBenefit: `${skipRate}% of real executions never reach this node, based on ${node.executionCount} recorded runs.`,
    });
  }

  return candidates;
}

async function detectSlaCandidate({ key, version, rangeDays }) {
  const sla = await buildSlaIntelligence({ key, version, rangeDays });
  if (!sla.slaConfigured || !sla.hasData) return null;
  if (sla.complianceRate >= 100 - SLA_BREACH_THRESHOLD) return null;
  const breachRate = Math.round((100 - sla.complianceRate) * 10) / 10;
  return {
    issueType: "sla_breach",
    severity: severityFromRate(breachRate, { high: 30, medium: 10 }),
    confidence: sla.totalExecutions >= MIN_SAMPLE_SIZE ? "high" : "insufficient",
    affectedNodeIds: [],
    evidence: sla,
    dataPeriodDays: rangeDays,
    issue: `SLA breached on ${sla.breachCount} of ${sla.totalExecutions} executions (${breachRate}%) against a ${sla.slaTargetMs}ms target in the last ${rangeDays} days.`,
    recommendedChange: `Review the slowest nodes in the Bottleneck Explorer for this process — they are the most likely contributors to SLA breaches.`,
    why: `${sla.breachCount} real executions exceeded the configured ${sla.slaTargetMs}ms SLA target.`,
    expectedBenefit: `SLA compliance is currently ${sla.complianceRate}%, based on ${sla.totalExecutions} real executions.`,
  };
}

async function detectVersionRegressionCandidate({ key, rangeDays }) {
  const versionIntel = await buildVersionIntelligence({ key, rangeDays });
  const withData = versionIntel.versions.filter((v) => v.hasData && v.totalExecutions >= MIN_SAMPLE_SIZE);
  const active = withData.find((v) => v.active);
  if (!active) return null;
  const previous = [...withData].filter((v) => v.version < active.version).sort((a, b) => b.version - a.version)[0];
  if (!previous) return null;

  const successDrop = previous.successRate - active.successRate;
  const durationIncrease = active.avgDurationMs && previous.avgDurationMs ? active.avgDurationMs - previous.avgDurationMs : 0;
  if (successDrop < 10 && durationIncrease < previous.avgDurationMs * 0.3) return null;

  return {
    issueType: "version_regression",
    severity: successDrop >= 25 ? "critical" : "high",
    confidence: "high",
    affectedNodeIds: [],
    evidence: { active, previous },
    dataPeriodDays: rangeDays,
    issue: `Active version ${active.version} has a ${active.successRate}% success rate vs ${previous.successRate}% for version ${previous.version}.`,
    recommendedChange: `Compare version ${previous.version} and ${active.version} in Version Comparison to see the structural change that likely caused this regression.`,
    why: `Success rate dropped ${Math.round(successDrop * 10) / 10} points between real-execution samples of version ${previous.version} (${previous.totalExecutions} runs) and ${active.version} (${active.totalExecutions} runs).`,
    expectedBenefit: `Reverting or fixing the regression could restore the ${previous.successRate}% success rate version ${previous.version} demonstrated over ${previous.totalExecutions} real executions.`,
  };
}

async function detectDegradationCandidate({ key, version, rangeDays }) {
  const health = await buildProcessHealthScore({ key, version, rangeDays });
  if (health.score === null || health.score >= HEALTH_DEGRADED_THRESHOLD) return null;
  return {
    issueType: "process_degradation",
    severity: health.score < 40 ? "critical" : "high",
    confidence: "high",
    affectedNodeIds: [],
    evidence: health,
    dataPeriodDays: rangeDays,
    issue: `Process health score is ${health.score} (${health.grade}) based on ${health.sampleSize} real executions.`,
    recommendedChange: `Review the negative factors on this process's Health Score panel — they list exactly which measured signal is driving the score down.`,
    why: (health.negativeFactors || []).join("; ") || "Combined success/SLA/performance/stability signal is below the healthy threshold.",
    expectedBenefit: `Addressing the disclosed negative factors would move the score above the ${HEALTH_DEGRADED_THRESHOLD} "Needs Attention" threshold.`,
  };
}

export function dedupeKeyFor(key, version, issueType, affectedNodeIds) {
  return `${key}:${version}:${issueType}:${(affectedNodeIds || []).sort().join(",")}`;
}

/**
 * Runs every deterministic rule for one process key's active version and
 * upserts recommendations. Never mutates ProcessDefinition. Called on
 * demand from the Optimization Center (Section 19) — this codebase has no
 * background job scheduler (same finding every prior phase already made),
 * so detection is on-demand, not a cron.
 */
export async function detectOptimizationCandidates({ key, rangeDays = 30 } = {}) {
  const active = await ProcessDefinition.findOne({ key, status: "active" }).lean();
  if (!active) return { key, candidates: [], note: "No active version — optimization detection requires a published, active process." };

  const version = active.version;
  const [nodeCandidates, slaCandidate, regressionCandidate, degradationCandidate] = await Promise.all([
    detectNodeCandidates({ key, version, rangeDays }),
    detectSlaCandidate({ key, version, rangeDays }),
    detectVersionRegressionCandidate({ key, rangeDays }),
    detectDegradationCandidate({ key, version, rangeDays }),
  ]);

  const all = [...nodeCandidates, slaCandidate, regressionCandidate, degradationCandidate].filter(Boolean);
  const saved = [];
  for (const c of all) {
    const dedupeKey = dedupeKeyFor(key, version, c.issueType, c.affectedNodeIds);
    const existing = await ProcessOptimizationRecommendation.findOne({ dedupeKey, status: { $in: ["detected", "reviewed", "simulation_ready"] } });
    if (existing) {
      existing.evidence = c.evidence;
      existing.severity = c.severity;
      existing.confidence = c.confidence;
      await existing.save();
      saved.push(existing);
      continue;
    }
    const created = await ProcessOptimizationRecommendation.create({ processKey: key, processVersion: version, dedupeKey, ...c });
    saved.push(created);
  }

  return { key, version, candidatesDetected: all.length, recommendations: saved };
}

export async function detectOptimizationCandidatesForAllActive({ rangeDays = 30 } = {}) {
  const activeKeys = await ProcessDefinition.distinct("key", { status: "active" });
  const results = await Promise.all(activeKeys.map((key) => detectOptimizationCandidates({ key, rangeDays })));
  return { processed: activeKeys.length, results };
}

/**
 * Section 13's "Generate Proposed Version" step. Reuses the EXACT same
 * fork shape processDesignerController.js#updateProcess already creates
 * when editing a published/active version — a normal draft, subject to
 * the same validation/simulation/publish/activation gate as any other
 * draft. This function never sets status to anything but "draft" and
 * never touches the live active version's own document.
 */
export async function generateProposedVersion({ recommendationId, mutatedNodes, mutatedEdges, actorId }) {
  const recommendation = await ProcessOptimizationRecommendation.findById(recommendationId);
  if (!recommendation) throw new Error("Recommendation not found");

  const active = await ProcessDefinition.findOne({ key: recommendation.processKey, status: "active" }).lean();
  if (!active) throw new Error("No active version to propose an optimization against");

  const maxVersion = await ProcessDefinition.find({ key: recommendation.processKey }).sort({ version: -1 }).limit(1).select("version").lean();
  const nextVersion = (maxVersion[0]?.version || active.version) + 1;

  const draft = await ProcessDefinition.create({
    key: active.key,
    name: active.name,
    description: active.description,
    category: active.category,
    owner: active.owner,
    nodes: mutatedNodes !== undefined ? mutatedNodes : active.nodes,
    edges: mutatedEdges !== undefined ? mutatedEdges : active.edges,
    version: nextVersion,
    parentVersion: active.version,
    status: "draft",
    slaTargetMs: active.slaTargetMs,
    createdBy: actorId,
  });

  recommendation.status = "simulation_ready";
  recommendation.proposedDefinitionId = draft._id;
  await recommendation.save();

  return { recommendation, draft };
}
