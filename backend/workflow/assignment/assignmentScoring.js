// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentScoring (brief Steps 4/5 — "Never random. Need transparent
// scoring. Admin can inspect.").
//
// Pure functions only — no I/O, no DB calls, nothing async. Every input is
// a real, already-fetched value (workload snapshot, history stats,
// presence, the item itself); this module's only job is the arithmetic,
// which is why it is unit-testable without a database (see
// backend/tests/assignmentScoring.test.mjs).
//
// WEIGHTS (documented here once, surfaced verbatim by
// GET /api/admin/assignment/business-rules so an admin can always see
// exactly how a score was built — never a hidden formula):
//   permission   — gate, not a weight: ineligible candidates never reach
//                  scoring at all (see assignmentEngine.js).
//   workload     25%  — lower current open-item load scores higher
//   experience   20%  — real resolved-count-for-this-type, relative to the
//                        best-performing candidate in THIS pool (never an
//                        absolute invented scale)
//   priority     15%  — real overdue-count penalty; an admin currently
//                        running overdue is a worse bet for urgent work
//   availability 15%  — online now > active-but-offline > (ineligible if
//                        inactive, filtered out earlier)
//   slaHistory   15%  — real all-time SLA success rate; unrated candidates
//                        (no resolved history yet) get a neutral 60, never
//                        penalized for being new
//   escalation   10%  — real recent-escalations-received penalty
// Total: 100%.
// ─────────────────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = Object.freeze({
  workload: 0.25,
  experience: 0.2,
  priority: 0.15,
  availability: 0.15,
  slaHistory: 0.15,
  escalation: 0.1,
});

const NEUTRAL_SLA_SCORE = 60;

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

/**
 * @param {object} params
 * @param {object} params.item - the unified queue item being scored (needs .type, .priority)
 * @param {object} params.workload - one snapshot from assignmentRegistry.buildWorkloadSnapshots
 * @param {object} params.history - one entry from assignmentHistory.buildHistoryStatsForAdmins
 * @param {boolean} params.isOnline
 * @param {number} params.maxExperienceInPool - highest resolvedCountByType[item.type] among all
 *   candidates being scored for this item, so "experience" is always relative to real peers.
 */
export function scoreCandidate({ item, workload, history, isOnline, maxExperienceInPool }) {
  const workloadScore = clamp(100 - workload.utilization.pct);

  const experienceCount = history.resolvedCountByType[item.type] || 0;
  const experienceScore = maxExperienceInPool > 0 ? clamp(Math.round((experienceCount / maxExperienceInPool) * 100)) : 0;

  const priorityScore = clamp(100 - workload.overdue * 20);

  const availabilityScore = isOnline ? 100 : 50;

  const slaHistoryScore = history.slaSuccessRate === null ? NEUTRAL_SLA_SCORE : clamp(history.slaSuccessRate);

  const escalationScore = clamp(100 - history.recentEscalationsReceived * 15);

  const total = Math.round(
    workloadScore * SCORE_WEIGHTS.workload +
      experienceScore * SCORE_WEIGHTS.experience +
      priorityScore * SCORE_WEIGHTS.priority +
      availabilityScore * SCORE_WEIGHTS.availability +
      slaHistoryScore * SCORE_WEIGHTS.slaHistory +
      escalationScore * SCORE_WEIGHTS.escalation,
  );

  return {
    total,
    breakdown: {
      workload: { score: workloadScore, weight: SCORE_WEIGHTS.workload, detail: `${workload.utilization.pct}% utilized (${workload.openCount}/${workload.utilization.max} open)` },
      experience: {
        score: experienceScore,
        weight: SCORE_WEIGHTS.experience,
        detail: experienceCount > 0 ? `${experienceCount} resolved of this type` : "no resolved history of this type yet",
      },
      priority: { score: priorityScore, weight: SCORE_WEIGHTS.priority, detail: `${workload.overdue} currently overdue item(s)` },
      availability: { score: availabilityScore, weight: SCORE_WEIGHTS.availability, detail: isOnline ? "online now" : "offline" },
      slaHistory: {
        score: slaHistoryScore,
        weight: SCORE_WEIGHTS.slaHistory,
        detail: history.slaSuccessRate === null ? "no resolved history yet (neutral score)" : `${history.slaSuccessRate}% historical SLA success`,
      },
      escalation: {
        score: escalationScore,
        weight: SCORE_WEIGHTS.escalation,
        detail: `${history.recentEscalationsReceived} escalation(s) received in last 30 days`,
      },
    },
  };
}

/** Short, human-readable reason string built from the SAME breakdown above — never a separate narrative. */
export function explainScore(breakdown) {
  const parts = Object.entries(breakdown)
    .sort((a, b) => b[1].score * b[1].weight - a[1].score * a[1].weight)
    .slice(0, 3)
    .map(([, v]) => v.detail);
  return parts.join("; ");
}

export const AssignmentScoring = Object.freeze({
  SCORE_WEIGHTS,
  scoreCandidate,
  explainScore,
});
