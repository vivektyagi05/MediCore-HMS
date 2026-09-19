// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-12 — AI Command Center & AI Operational Intelligence.
//
// AUDIT FINDING (see CHANGELOG-PHASE-UI-12-AI-COMMAND-CENTER.md): every AI
// capability requested by the brief already exists and is genuinely wired
// (promptLibrary.js -> generativeAssistant.js -> textGenerationProvider.js,
// 70 registered capabilities across admin/doctor/patient/shared scopes; the
// Executive Command Center (AdminDashboard.jsx, Phase UI-9) already covers
// Executive Brief, What Changed, Critical Attention, Finance/Workflow/
// Governance risk, Reputation signals, and Clinical/Patient Operations with
// real backend data; per-capability "Why?"/Explain evidence panels already
// exist across Assignment/Monitoring/Governance). The one genuine,
// explicitly-requested gap (Step 11) is AI SYSTEM HEALTH: nothing in the
// platform distinguishes "AI available" from "AI unavailable" from
// "deterministic fallback active" from "insufficient source data", and
// nothing reports real (non-fabricated) AI activity telemetry.
//
// This file computes NOTHING that already has a real source:
//   - provider reachability reuses getAIProviderStatus() as-is (built in
//     Phase A5.2 for Platform Health Center, never before surfaced to an
//     admin-facing AI page)
//   - the capability registry count is read directly from promptLibrary's
//     own PROMPTS export (single source of truth for what capabilities
//     exist — never a second hand-maintained list)
//   - generation volume/recency is read from the real AIDraft collection
//     (already the system of record for every "saveable" AI generation)
//
// HONESTY RULE: AIDraft only persists capabilities whose output can become
// part of a record (consultation summaries, clinical notes, communications,
// etc. — 19 of 70 capabilities, by generativeAssistant.js's own design).
// Ephemeral advisor/explain capabilities (metricExplain, workflowExplain,
// assignmentRecommendation, and similar) are generated on demand and never
// persisted, so no request-volume telemetry exists for them. Rather than
// fabricate a number or an uptime percentage, this module reports that
// limitation explicitly. No AI failure/error telemetry is persisted
// anywhere in the platform (failures are only ever surfaced to the
// requesting browser via getApiErrorMessage(), never logged), so this
// module never reports an error rate or an uptime percentage — it reports
// exactly what is knowable: current provider reachability, and real,
// bounded historical generation counts.
// ─────────────────────────────────────────────────────────────────────────
import AIDraft from "../../models/AIDraft.js";
import { PROMPTS } from "../../ai/promptLibrary.js";
import { getAIProviderStatus } from "../../ai/providers/textGenerationProvider.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Pure, dependency-free — counts capabilities by scope from the real
// registry. Exported separately so it is unit-testable without a DB.
export function summarizeCapabilityRegistry() {
  const keys = Object.keys(PROMPTS);
  const byScope = keys.reduce((acc, key) => {
    const scope = PROMPTS[key].scope || "unspecified";
    acc[scope] = (acc[scope] || 0) + 1;
    return acc;
  }, {});
  return { totalCapabilities: keys.length, byScope };
}

// Pure, dependency-free — turns raw AIDraft rows (already fetched) into the
// health module's telemetry shape. Kept separate from the DB read so it can
// be tested with fixture data, same pattern as reviewAdminAggregates.js /
// commandCenterHelpers.js.
export function summarizeDraftActivity(drafts, now = Date.now()) {
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = now - 7 * ONE_DAY_MS;

  const todayCount = drafts.filter((d) => new Date(d.createdAt).getTime() >= todayStart.getTime()).length;
  const last7dCount = drafts.filter((d) => new Date(d.createdAt).getTime() >= sevenDaysAgo).length;

  const byPromptKey = drafts.reduce((acc, d) => {
    acc[d.promptKey] = (acc[d.promptKey] || 0) + 1;
    return acc;
  }, {});
  const topCapabilities = Object.entries(byPromptKey)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([promptKey, count]) => ({ promptKey, label: PROMPTS[promptKey]?.label || promptKey, count }));

  const mostRecent = drafts.length
    ? drafts.reduce((latest, d) => (new Date(d.createdAt) > new Date(latest.createdAt) ? d : latest))
    : null;

  return {
    trackedGenerationsToday: todayCount,
    trackedGenerationsLast7d: last7dCount,
    topCapabilities,
    lastGeneratedAt: mostRecent ? mostRecent.createdAt : null,
    lastGeneratedProvider: mostRecent ? mostRecent.generatedBy : null,
  };
}

// Top-level composition. Never throws — a failure here must not break the
// AI Command page (Step 6: AI failure is a product state).
export async function buildAISystemHealth() {
  const provider = getAIProviderStatus();
  const registry = summarizeCapabilityRegistry();

  let activity = null;
  let activityError = null;
  try {
    // Bounded: only the last 30 days, only the fields this module needs —
    // never an unbounded collection load (Step 15: Performance).
    const since = new Date(Date.now() - 30 * ONE_DAY_MS);
    const drafts = await AIDraft.find({ createdAt: { $gte: since } })
      .select("promptKey generatedBy createdAt")
      .lean();
    activity = summarizeDraftActivity(drafts);
  } catch (error) {
    activityError = error.message || "AI activity telemetry unavailable";
  }

  return {
    provider: {
      available: provider.healthy,
      activeProvider: provider.activeProvider,
      configuredProvider: provider.configuredKey,
      // The only provider implemented today is the deterministic template
      // engine (never calls a network, never hallucinates data outside the
      // supplied context) — surfaced explicitly so an admin never mistakes
      // "provider healthy" for "a network LLM is running".
      isDeterministicFallback: provider.activeProvider === "hms-template-engine" || provider.configuredKey === "template",
      error: provider.healthy ? null : provider.error,
    },
    capabilities: {
      totalRegistered: registry.totalCapabilities,
      byScope: registry.byScope,
    },
    activity: activity,
    activityError,
    limitations: [
      "Only capabilities whose output can become part of a saved record are persisted to AIDraft and counted in activity telemetry; on-demand advisor/explain capabilities (e.g. workflow, assignment, and monitoring explanations) are generated live and are not volume-tracked.",
      "No AI failure/error telemetry is persisted anywhere in the platform, so no uptime or error-rate percentage is reported here.",
    ],
    fetchedAt: new Date().toISOString(),
  };
}
