// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Workflow Optimization Engine (brief Step 9).
//
// Every suggestion below is derived directly from analyzeBottlenecks()'s
// real findings — this module adds no new data reads of its own, it only
// translates structural facts into an actionable suggestion + explicit
// "why". "Unused triggers/actions/AI prompts/schedulers" from the brief's
// own list are NOT included: this codebase has no per-trigger/per-action/
// per-prompt usage tracking independent of the flow that contains them (a
// trigger or action only exists inside a flow's definition), so a separate
// "unused trigger" concept beyond "unused flow" would be fabricated rather
// than measured. Documented, not silently invented.
// ─────────────────────────────────────────────────────────────────────────

import { analyzeBottlenecks } from "./bottleneckAnalyzer.js";

export async function generateOptimizationSuggestions() {
  const bottlenecks = await analyzeBottlenecks();
  const suggestions = [];

  for (const flow of bottlenecks.unused) {
    suggestions.push({
      id: `disable:${flow.id}`,
      action: "disable",
      target: { type: "automation_flow", id: flow.id, name: flow.name },
      why: flow.lastRunAt
        ? `No runs since ${new Date(flow.lastRunAt).toISOString().slice(0, 10)} (over 30 days) — see AutomationFlow.stats.lastRunAt.`
        : "This published flow has never recorded a single run in AutomationRunLog.",
    });
  }

  for (const group of bottlenecks.duplicateTriggerGroups) {
    suggestions.push({
      id: `merge:${group.flowIds.join("-")}`,
      action: "merge",
      target: { type: "automation_flow_group", ids: group.flowIds, names: group.flowNames },
      why: `${group.flowNames.length} published flows share the identical trigger (${group.triggerType}) and an identical condition structure — likely redundant.`,
    });
  }

  for (const flow of bottlenecks.expensive) {
    suggestions.push({
      id: `split:${flow.id}`,
      action: "split",
      target: { type: "automation_flow", id: flow.id, name: flow.name },
      why: `${flow.stepCount} action steps in one flow — consider splitting into smaller, independently-testable flows.`,
    });
  }

  for (const flow of bottlenecks.slow) {
    suggestions.push({
      id: `optimize:${flow.id}`,
      action: "optimize",
      target: { type: "automation_flow", id: flow.id, name: flow.name },
      why: `Avg run duration ${flow.avgDurationMs}ms — among the slowest published flows (Monitoring Platform's flow-health ranking, A6.2.4).`,
    });
  }

  for (const flow of bottlenecks.noisy) {
    suggestions.push({
      id: `priority_tuning:${flow.id}`,
      action: "priority_tuning",
      target: { type: "automation_flow", id: flow.id, name: flow.name },
      why: `Success rate ${flow.successRate ?? "n/a"}% — review condition logic or the target action's own failure reasons before re-publishing.`,
    });
  }

  return { totalSuggestions: suggestions.length, suggestions, source: bottlenecks };
}
