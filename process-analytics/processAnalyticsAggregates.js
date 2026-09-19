// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.4 — Process Analytics & Optimization Intelligence.
//
// AUDIT FINDING (Section 3): Process Designer (A6.3.3) already persists
// every real graph run — dry-run (simulator) AND live (event-triggered) —
// to AutomationRunLog with sourceKind:"process_definition", carrying
// processKey/processVersion/status/durationMs/startedAt/nodeTrace/
// stepResults/dryRun/triggeredBy. That is the ONLY execution data source
// for this phase. Nothing here re-executes a process, re-runs a flow, or
// writes a second execution log — this module is read-only aggregation
// layered on that exact collection, same posture as
// monitoring/monitoringAggregates.js is layered on it for AutomationFlow.
//
// AUDIT FINDING: there is no persisted SLA target anywhere for a
// ProcessDefinition (unlike the fixed workflow/policies.js SLA_TARGET_MS
// used for Operation Registry items) — the brief's Section 6/9 explicitly
// permit "the smallest justified additive field" when data is genuinely
// missing, so ProcessDefinition gained one optional field:
// `slaTargetMs` (see models/ProcessDefinition.js). When an admin has not
// set it, every SLA figure below reports "No SLA configured" rather than
// fabricating a threshold — never a silent default target.
//
// ONE SOURCE OF TRUTH RULE (Section 4): every duration/success/failure/
// percentile number the Optimization Engine, the AI explain prompts, and
// every controller endpoint use comes from the builders in this file.
// Nothing recomputes an average or a rate a second way anywhere else.
// ─────────────────────────────────────────────────────────────────────────

import AutomationRunLog from "../models/AutomationRunLog.js";
import ProcessDefinition from "../models/ProcessDefinition.js";
import { percentile } from "../monitoring/monitoringAggregates.js";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Section 7/9: never call something a bottleneck/trend/comparison off a
// handful of runs. One threshold, reused everywhere in this module.
export const MIN_SAMPLE_SIZE = 5;
// Section 22: cap requested date ranges — this codebase has no background
// job queue, so a very wide aggregation would run inline on the request.
export const MAX_RANGE_DAYS = 90;

function clampRangeDays(rangeDays) {
  const n = Number(rangeDays) || 30;
  return Math.min(Math.max(n, 1), MAX_RANGE_DAYS);
}

function emptyDurationStats() {
  return { avgDurationMs: null, medianDurationMs: null, p90DurationMs: null, p95DurationMs: null, fastestMs: null, slowestMs: null };
}

export function durationStatsFrom(durations) {
  if (!durations.length) return emptyDurationStats();
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    avgDurationMs: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    medianDurationMs: percentile(sorted, 50),
    p90DurationMs: percentile(sorted, 90),
    p95DurationMs: percentile(sorted, 95),
    fastestMs: sorted[0],
    slowestMs: sorted[sorted.length - 1],
  };
}

// ─────────────────────────────────────── Registry helpers (shared)

// All versions ever created for a key — the registry every other builder
// in this file resolves against, so "which versions exist" is answered
// once, not once per endpoint.
export async function listVersionsForKey(key) {
  return ProcessDefinition.find({ key }).sort({ version: 1 }).lean();
}

export async function listAnalyzableProcessKeys() {
  // Distinct keys that have EVER had a real (non-dry-run) run — a process
  // that has never executed has nothing to analyze yet, and the Executive
  // Overview should not silently pad its counts with zero-run processes.
  const keys = await AutomationRunLog.distinct("processKey", { sourceKind: "process_definition", dryRun: false });
  return keys.filter(Boolean);
}

// ─────────────────────────────────────── 1. Process Performance Intelligence

/**
 * Section 5. The one function every performance figure anywhere in this
 * phase — Executive Overview, Process Detail, Bottleneck confidence,
 * Optimization evidence, AI explain — is computed from.
 */
export async function buildProcessPerformance({ key, version = null, rangeDays = 30 } = {}) {
  const days = clampRangeDays(rangeDays);
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const match = { sourceKind: "process_definition", processKey: key, dryRun: false, createdAt: { $gte: since } };
  if (version) match.processVersion = version;

  const [statusAgg, durationRows, dailyAgg, versionAgg, definitions] = await Promise.all([
    AutomationRunLog.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    AutomationRunLog.find(match).select("durationMs").lean(),
    AutomationRunLog.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$startedAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    AutomationRunLog.aggregate([{ $match: match }, { $group: { _id: "$processVersion", count: { $sum: 1 } } }, { $sort: { _id: -1 } }]),
    listVersionsForKey(key),
  ]);

  const counts = { success: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const row of statusAgg) if (counts[row._id] !== undefined) counts[row._id] = row.count;
  const total = counts.success + counts.failed + counts.blocked + counts.skipped;

  const durations = durationRows.map((r) => r.durationMs).filter((d) => typeof d === "number");
  const activeVersion = definitions.find((d) => d.status === "active");

  if (total === 0) {
    return {
      key,
      rangeDays: days,
      hasData: false,
      note: "No historical data — this process has not executed in the selected window.",
      totalExecutions: 0,
      activeVersion: activeVersion ? { version: activeVersion.version, status: activeVersion.status } : null,
      versions: definitions.map((d) => ({ version: d.version, status: d.status })),
      slaTargetMs: activeVersion?.slaTargetMs ?? null,
    };
  }

  return {
    key,
    rangeDays: days,
    hasData: true,
    totalExecutions: total,
    successCount: counts.success,
    failedCount: counts.failed,
    blockedCount: counts.blocked,
    skippedCount: counts.skipped,
    successRate: Math.round((counts.success / total) * 1000) / 10,
    failureRate: Math.round((counts.failed / total) * 1000) / 10,
    blockedRate: Math.round((counts.blocked / total) * 1000) / 10,
    ...durationStatsFrom(durations),
    executionsPerDay: Math.round((total / days) * 10) / 10,
    dailyExecutions: dailyAgg.map((r) => ({ date: r._id, count: r.count })),
    versionDistribution: versionAgg.map((r) => ({ version: r._id, count: r.count })),
    activeVersion: activeVersion ? { version: activeVersion.version, status: activeVersion.status } : null,
    versions: definitions.map((d) => ({ version: d.version, status: d.status })),
    // Section 5: retry/self-healing counts are honestly reported absent —
    // walkProcessGraph.js has no retry/recovery concept for a process-graph
    // run (same finding A6.2.4 already made for AutomationFlow runs).
    retrySupport: "not applicable — Process Designer graph runs have no retry/recovery concept in this codebase",
    slaTargetMs: activeVersion?.slaTargetMs ?? definitions[definitions.length - 1]?.slaTargetMs ?? null,
  };
}

// ─────────────────────────────────────── 2. SLA Intelligence (Section 8)

export async function buildSlaIntelligence({ key, version = null, rangeDays = 30 } = {}) {
  const definitions = await listVersionsForKey(key);
  const slaTargetMs = version
    ? definitions.find((d) => d.version === version)?.slaTargetMs ?? null
    : definitions.find((d) => d.status === "active")?.slaTargetMs ?? definitions[definitions.length - 1]?.slaTargetMs ?? null;

  if (!slaTargetMs) {
    return { key, slaConfigured: false, note: "No SLA configured for this process — set slaTargetMs on the active version to enable SLA tracking." };
  }

  const days = clampRangeDays(rangeDays);
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const match = { sourceKind: "process_definition", processKey: key, dryRun: false, createdAt: { $gte: since }, durationMs: { $ne: null } };
  if (version) match.processVersion = version;

  const [total, breaches, breachTrend] = await Promise.all([
    AutomationRunLog.countDocuments(match),
    AutomationRunLog.countDocuments({ ...match, durationMs: { $gt: slaTargetMs } }),
    AutomationRunLog.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$startedAt" } }, total: { $sum: 1 }, breaches: { $sum: { $cond: [{ $gt: ["$durationMs", slaTargetMs] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  if (total === 0) return { key, slaConfigured: true, slaTargetMs, hasData: false, note: "No historical data for SLA compliance in the selected window." };

  return {
    key,
    slaConfigured: true,
    slaTargetMs,
    hasData: true,
    totalExecutions: total,
    breachCount: breaches,
    complianceRate: Math.round(((total - breaches) / total) * 1000) / 10,
    breachTrend: breachTrend.map((r) => ({ date: r._id, total: r.total, breaches: r.breaches })),
  };
}

// ─────────────────────────────────────── 3. Process Health Score (Section 6)

/**
 * Deterministic, transparent, weighted score — never AI-generated.
 * successHealth(40) + slaHealth(20) + performanceTrendHealth(20) +
 * stabilityHealth(20) = 100. Weights chosen after the audit found: (a)
 * SLA is genuinely optional per-process, so it cannot be a larger share or
 * every un-configured process would be capped low for no real reason;
 * (b) there is no absolute "good" duration threshold anywhere in this
 * codebase, so performance is scored on trend (getting faster/slower),
 * not an invented absolute target; (c) stability uses the real
 * blocked+failed concentration in the most recent third of the window vs
 * the rest, so a recently-degrading process scores lower than a
 * consistently-imperfect one.
 */
export function gradeForScore(score) {
  if (score === null || score === undefined) return "Insufficient execution history";
  return score >= 85 ? "Healthy" : score >= 65 ? "Needs Attention" : "Degraded";
}

export async function buildProcessHealthScore({ key, version = null, rangeDays = 30 } = {}) {
  const perf = await buildProcessPerformance({ key, version, rangeDays });
  if (!perf.hasData || perf.totalExecutions < MIN_SAMPLE_SIZE) {
    return { key, score: null, grade: "Insufficient execution history", note: `Fewer than ${MIN_SAMPLE_SIZE} real executions in the selected window.`, factors: [] };
  }

  const factors = [];
  const positiveFactors = [];
  const negativeFactors = [];

  // successHealth (40)
  const successHealth = 40 * (perf.successRate / 100);
  factors.push({ name: "Success rate", weight: 40, contribution: Math.round(successHealth), detail: `${perf.successRate}% success rate over ${perf.totalExecutions} executions.` });
  if (perf.successRate >= 95) positiveFactors.push("High success rate");
  if (perf.successRate < 80) negativeFactors.push(`Success rate is ${perf.successRate}%`);

  // slaHealth (20)
  const sla = await buildSlaIntelligence({ key, version, rangeDays });
  let slaHealth = 20;
  if (sla.slaConfigured && sla.hasData) {
    slaHealth = 20 * (sla.complianceRate / 100);
    factors.push({ name: "SLA compliance", weight: 20, contribution: Math.round(slaHealth), detail: `${sla.complianceRate}% of runs stayed within the ${sla.slaTargetMs}ms target.` });
    if (sla.complianceRate < 90) negativeFactors.push(`SLA breached on ${sla.breachCount} run(s)`);
    else positiveFactors.push("SLA compliant");
  } else {
    factors.push({ name: "SLA compliance", weight: 20, contribution: 20, detail: "No SLA configured for this process — full baseline applied and disclosed, not measured." });
  }

  // performanceTrendHealth (20) — compare avg duration of the most recent
  // half of the window's runs vs the earlier half.
  const trend = await computeDurationTrend({ key, version, rangeDays });
  let performanceTrendHealth = 20;
  if (trend.hasComparison) {
    const change = trend.percentChange; // positive = slower
    performanceTrendHealth = change <= 0 ? 20 : Math.max(0, 20 - Math.min(change, 100) * 0.4);
    factors.push({ name: "Duration trend", weight: 20, contribution: Math.round(performanceTrendHealth), detail: trend.note });
    if (change > 15) negativeFactors.push(`Average duration increased ${change}% recently`);
    else if (change < -5) positiveFactors.push("Getting faster recently");
  } else {
    factors.push({ name: "Duration trend", weight: 20, contribution: 20, detail: "Not enough runs to compare recent vs earlier duration." });
  }

  // stabilityHealth (20) — failure+blocked concentration in the most
  // recent third of executions vs the rest.
  const stability = await computeFailureConcentrationTrend({ key, version, rangeDays });
  let stabilityHealth = 20;
  if (stability.hasComparison) {
    const delta = stability.recentFailureRate - stability.earlierFailureRate;
    stabilityHealth = delta <= 0 ? 20 : Math.max(0, 20 - Math.min(delta, 50) * 0.4);
    factors.push({ name: "Failure stability", weight: 20, contribution: Math.round(stabilityHealth), detail: stability.note });
    if (delta > 10) negativeFactors.push("Failure rate is rising recently");
  } else {
    factors.push({ name: "Failure stability", weight: 20, contribution: 20, detail: "Not enough runs to compare recent vs earlier failure rate." });
  }

  const score = Math.max(0, Math.min(100, Math.round(successHealth + slaHealth + performanceTrendHealth + stabilityHealth)));
  const grade = gradeForScore(score);

  return { key, version, score, grade, factors, positiveFactors, negativeFactors, sampleSize: perf.totalExecutions, rangeDays: perf.rangeDays };
}

async function computeDurationTrend({ key, version, rangeDays }) {
  const days = clampRangeDays(rangeDays);
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const midpoint = new Date(Date.now() - (days / 2) * MS_PER_DAY);
  const match = { sourceKind: "process_definition", processKey: key, dryRun: false, durationMs: { $ne: null } };
  if (version) match.processVersion = version;

  const [earlier, recent] = await Promise.all([
    AutomationRunLog.find({ ...match, createdAt: { $gte: since, $lt: midpoint } }).select("durationMs").lean(),
    AutomationRunLog.find({ ...match, createdAt: { $gte: midpoint } }).select("durationMs").lean(),
  ]);
  if (earlier.length < MIN_SAMPLE_SIZE || recent.length < MIN_SAMPLE_SIZE) return { hasComparison: false };

  const avg = (rows) => rows.reduce((a, r) => a + r.durationMs, 0) / rows.length;
  const earlierAvg = avg(earlier);
  const recentAvg = avg(recent);
  const percentChange = earlierAvg > 0 ? Math.round(((recentAvg - earlierAvg) / earlierAvg) * 1000) / 10 : 0;
  return {
    hasComparison: true,
    earlierAvgMs: Math.round(earlierAvg),
    recentAvgMs: Math.round(recentAvg),
    percentChange,
    note: `Average duration ${percentChange >= 0 ? "increased" : "decreased"} ${Math.abs(percentChange)}% comparing the recent half of the window (${Math.round(recentAvg)}ms) to the earlier half (${Math.round(earlierAvg)}ms).`,
  };
}

async function computeFailureConcentrationTrend({ key, version, rangeDays }) {
  const days = clampRangeDays(rangeDays);
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const midpoint = new Date(Date.now() - (days / 3) * MS_PER_DAY); // most recent THIRD
  const match = { sourceKind: "process_definition", processKey: key, dryRun: false };
  if (version) match.processVersion = version;

  const [earlier, recent] = await Promise.all([
    AutomationRunLog.find({ ...match, createdAt: { $gte: since, $lt: midpoint } }).select("status").lean(),
    AutomationRunLog.find({ ...match, createdAt: { $gte: midpoint } }).select("status").lean(),
  ]);
  if (earlier.length < MIN_SAMPLE_SIZE || recent.length < MIN_SAMPLE_SIZE) return { hasComparison: false };

  const failRate = (rows) => Math.round((rows.filter((r) => r.status === "failed").length / rows.length) * 1000) / 10;
  const earlierFailureRate = failRate(earlier);
  const recentFailureRate = failRate(recent);
  return {
    hasComparison: true,
    earlierFailureRate,
    recentFailureRate,
    note: `Failure rate in the most recent third of the window is ${recentFailureRate}%, vs ${earlierFailureRate}% before that.`,
  };
}

// ─────────────────────────────────────── 4. Bottleneck Intelligence (Section 7)

export async function buildBottleneckAnalysis({ key, version = null, rangeDays = 30 } = {}) {
  const days = clampRangeDays(rangeDays);
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const match = { sourceKind: "process_definition", processKey: key, dryRun: false, createdAt: { $gte: since } };
  if (version) match.processVersion = version;

  const rows = await AutomationRunLog.aggregate([
    { $match: match },
    { $unwind: "$nodeTrace" },
    {
      $group: {
        _id: { nodeId: "$nodeTrace.nodeId", nodeType: "$nodeTrace.nodeType" },
        executionCount: { $sum: 1 },
        failureCount: { $sum: { $cond: [{ $eq: ["$nodeTrace.status", "fail"] }, 1, 0] } },
        skipCount: { $sum: { $cond: [{ $eq: ["$nodeTrace.status", "skipped"] }, 1, 0] } },
        blockedCount: { $sum: { $cond: [{ $eq: ["$nodeTrace.status", "blocked"] }, 1, 0] } },
        durations: { $push: "$nodeTrace.durationMs" },
      },
    },
  ]);

  const nodes = rows.map((r) => {
    const durations = (r.durations || []).filter((d) => typeof d === "number" && d > 0).sort((a, b) => a - b);
    const insufficientSample = r.executionCount < MIN_SAMPLE_SIZE;
    return {
      nodeId: r._id.nodeId,
      nodeType: r._id.nodeType,
      executionCount: r.executionCount,
      failureCount: r.failureCount,
      failureRate: Math.round((r.failureCount / r.executionCount) * 1000) / 10,
      skipCount: r.skipCount,
      blockedCount: r.blockedCount,
      avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      p95DurationMs: durations.length >= MIN_SAMPLE_SIZE ? percentile(durations, 95) : null,
      insufficientSample,
      confidence: insufficientSample ? "insufficient" : r.executionCount >= 20 ? "high" : "moderate",
    };
  });

  const eligible = nodes.filter((n) => !n.insufficientSample);
  const slowest = [...eligible].filter((n) => n.avgDurationMs !== null).sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 5);
  const highestFailure = [...eligible].filter((n) => n.failureCount > 0).sort((a, b) => b.failureRate - a.failureRate).slice(0, 5);
  const highestSkip = [...eligible].filter((n) => n.skipCount > 0).sort((a, b) => b.skipCount - a.skipCount).slice(0, 5);

  return {
    key,
    rangeDays: days,
    nodes,
    slowestNodes: slowest,
    highestFailureNodes: highestFailure,
    highestSkipNodes: highestSkip,
    insufficientSampleNodes: nodes.filter((n) => n.insufficientSample).map((n) => n.nodeId),
  };
}

// ─────────────────────────────────────── 5. Failure Intelligence (Section 8)

export async function buildFailureIntelligence({ key, version = null, rangeDays = 30 } = {}) {
  const days = clampRangeDays(rangeDays);
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const match = { sourceKind: "process_definition", processKey: key, dryRun: false, status: "failed", createdAt: { $gte: since } };
  if (version) match.processVersion = version;

  const [total, byTrigger, trend, samples] = await Promise.all([
    AutomationRunLog.countDocuments(match),
    AutomationRunLog.aggregate([{ $match: match }, { $group: { _id: "$triggerType", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AutomationRunLog.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$startedAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    AutomationRunLog.find(match).select("error stepResults nodeTrace startedAt processVersion").sort({ createdAt: -1 }).limit(25).lean(),
  ]);

  // Section 8: "derive categories from actual error codes/messages using
  // deterministic rules" — never an invented taxonomy. Raw message is
  // always kept alongside.
  const rawMessages = [];
  for (const s of samples) {
    if (s.error) rawMessages.push(s.error);
    for (const step of s.stepResults || []) if (step.ok === false && step.message) rawMessages.push(step.message);
  }
  const categorized = rawMessages.map((msg) => ({ message: msg, category: categorizeFailureMessage(msg) }));
  const categoryCounts = {};
  for (const c of categorized) categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;

  return {
    key,
    rangeDays: days,
    hasData: total > 0,
    totalFailures: total,
    byTriggerType: byTrigger.map((t) => ({ triggerType: t._id, count: t.count })),
    trend: trend.map((r) => ({ date: r._id, count: r.count })),
    categoryCounts,
    recentSamples: samples.slice(0, 10).map((s) => ({ startedAt: s.startedAt, version: s.processVersion, error: s.error || null, failedNodes: (s.nodeTrace || []).filter((n) => n.status === "fail").map((n) => n.nodeId) })),
  };
}

export function categorizeFailureMessage(message) {
  const m = String(message || "").toLowerCase();
  if (!m) return "unknown";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  if (m.includes("permission") || m.includes("unauthorized") || m.includes("forbidden")) return "authorization";
  if (m.includes("not found") || m.includes("404")) return "not_found";
  if (m.includes("validation") || m.includes("invalid")) return "validation";
  if (m.includes("network") || m.includes("connect") || m.includes("econnrefused")) return "connectivity";
  return "other";
}

// ─────────────────────────────────────── 6. Version Intelligence (Section 9)

export async function buildVersionIntelligence({ key, rangeDays = 90 } = {}) {
  const definitions = await listVersionsForKey(key);
  const results = await Promise.all(
    definitions.map(async (def) => {
      const perf = await buildProcessPerformance({ key, version: def.version, rangeDays });
      const [first, last] = await Promise.all([
        AutomationRunLog.findOne({ sourceKind: "process_definition", processKey: key, processVersion: def.version, dryRun: false }).sort({ createdAt: 1 }).select("createdAt").lean(),
        AutomationRunLog.findOne({ sourceKind: "process_definition", processKey: key, processVersion: def.version, dryRun: false }).sort({ createdAt: -1 }).select("createdAt").lean(),
      ]);
      return {
        version: def.version,
        status: def.status,
        active: def.status === "active",
        hasData: perf.hasData,
        totalExecutions: perf.totalExecutions ?? 0,
        successRate: perf.successRate ?? null,
        failureRate: perf.failureRate ?? null,
        avgDurationMs: perf.avgDurationMs ?? null,
        p95DurationMs: perf.p95DurationMs ?? null,
        firstExecutionAt: first?.createdAt ?? null,
        lastExecutionAt: last?.createdAt ?? null,
      };
    }),
  );
  return { key, versions: results };
}

export async function buildVersionComparison({ key, versionA, versionB, rangeDays = 90 } = {}) {
  const [a, b, defs] = await Promise.all([
    buildProcessPerformance({ key, version: versionA, rangeDays }),
    buildProcessPerformance({ key, version: versionB, rangeDays }),
    listVersionsForKey(key),
  ]);
  const defA = defs.find((d) => d.version === versionA);
  const defB = defs.find((d) => d.version === versionB);
  const insufficient = [];
  if (!a.hasData || a.totalExecutions < MIN_SAMPLE_SIZE) insufficient.push(versionA);
  if (!b.hasData || b.totalExecutions < MIN_SAMPLE_SIZE) insufficient.push(versionB);

  const nodesDiff = diffNodeSets(defA?.nodes || [], defB?.nodes || []);

  return {
    key,
    from: { version: versionA, ...a },
    to: { version: versionB, ...b },
    insufficientDataVersions: insufficient,
    comparable: insufficient.length === 0,
    delta:
      insufficient.length === 0
        ? {
            successRate: round1(b.successRate - a.successRate),
            failureRate: round1(b.failureRate - a.failureRate),
            avgDurationMs: b.avgDurationMs - a.avgDurationMs,
            executions: b.totalExecutions - a.totalExecutions,
          }
        : null,
    nodeChanges: nodesDiff,
  };
}

export function round1(n) {
  return typeof n === "number" ? Math.round(n * 10) / 10 : null;
}

export function diffNodeSets(nodesA, nodesB) {
  const idsA = new Set(nodesA.map((n) => n.id));
  const idsB = new Set(nodesB.map((n) => n.id));
  return {
    added: [...idsB].filter((id) => !idsA.has(id)),
    removed: [...idsA].filter((id) => !idsB.has(id)),
  };
}

// ─────────────────────────────────────── 7. Trend Intelligence (Section 10)

const PERIOD_CONFIG = {
  "24h": { days: 1, bucket: "%Y-%m-%dT%H:00" },
  "7d": { days: 7, bucket: "%Y-%m-%d" },
  "30d": { days: 30, bucket: "%Y-%m-%d" },
  "90d": { days: 90, bucket: "%Y-%m-%d" },
};

export async function buildTrendSeries({ key, version = null, period = "7d" } = {}) {
  const config = PERIOD_CONFIG[period] || PERIOD_CONFIG["7d"];
  const since = new Date(Date.now() - config.days * MS_PER_DAY);
  const match = { sourceKind: "process_definition", processKey: key, dryRun: false, createdAt: { $gte: since } };
  if (version) match.processVersion = version;

  const rows = await AutomationRunLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: config.bucket, date: "$startedAt" } },
        total: { $sum: 1 },
        success: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        avgDurationMs: { $avg: "$durationMs" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    key,
    period,
    supportedByTimestamps: rows.length > 0,
    points: rows.map((r) => ({ bucket: r._id, total: r.total, success: r.success, failed: r.failed, avgDurationMs: r.avgDurationMs ? Math.round(r.avgDurationMs) : null })),
  };
}

// ─────────────────────────────────────── 8. Cross-Process Intelligence (Section 11)

export async function buildCrossProcessOverview({ rangeDays = 30 } = {}) {
  const keys = await listAnalyzableProcessKeys();
  const rows = await Promise.all(keys.map((key) => buildProcessPerformance({ key, rangeDays })));
  const withData = rows.filter((r) => r.hasData);

  const byVolume = [...withData].sort((a, b) => b.totalExecutions - a.totalExecutions);
  const byFailure = [...withData].filter((r) => r.totalExecutions >= MIN_SAMPLE_SIZE).sort((a, b) => b.failureRate - a.failureRate);
  const bySpeed = [...withData].filter((r) => r.avgDurationMs !== null).sort((a, b) => b.avgDurationMs - a.avgDurationMs);

  return {
    rangeDays,
    processCount: keys.length,
    processesWithData: withData.length,
    // Section 11's Volume x Reliability x Speed x SLA matrix. Real
    // operational cost is NOT fabricated (Section 11 explicitly forbids
    // it) — this codebase has no per-process cost tracking anywhere.
    matrix: withData.map((r) => ({
      key: r.key,
      volume: r.totalExecutions,
      reliability: r.successRate,
      speedMs: r.avgDurationMs,
      slaTargetMs: r.slaTargetMs,
    })),
    highestVolume: byVolume.slice(0, 5).map((r) => ({ key: r.key, totalExecutions: r.totalExecutions })),
    highestFailure: byFailure.slice(0, 5).map((r) => ({ key: r.key, failureRate: r.failureRate })),
    slowest: bySpeed.slice(0, 5).map((r) => ({ key: r.key, avgDurationMs: r.avgDurationMs })),
  };
}

export async function buildExecutiveOverview({ rangeDays = 30 } = {}) {
  const [activeCount, cross] = await Promise.all([
    ProcessDefinition.countDocuments({ status: "active" }),
    buildCrossProcessOverview({ rangeDays }),
  ]);

  const totalExecutions = cross.matrix.reduce((sum, m) => sum + m.volume, 0);
  const weightedSuccess = totalExecutions
    ? cross.matrix.reduce((sum, m) => sum + (m.reliability ?? 0) * m.volume, 0) / totalExecutions
    : null;
  const withSla = cross.matrix.filter((m) => m.slaTargetMs);

  return {
    rangeDays,
    activeProcesses: activeCount,
    totalExecutions,
    overallSuccessRate: weightedSuccess !== null ? Math.round(weightedSuccess * 10) / 10 : null,
    overallFailureRate: weightedSuccess !== null ? Math.round((100 - weightedSuccess) * 10) / 10 : null,
    processesWithSlaConfigured: withSla.length,
    slaConfiguredNote: withSla.length === 0 ? "No process has an SLA target configured yet." : null,
    highestVolume: cross.highestVolume,
    highestFailure: cross.highestFailure,
    slowest: cross.slowest,
  };
}
