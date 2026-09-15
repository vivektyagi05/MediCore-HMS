// PHASE P9 — Documents & Records: Reports Attention.
//
// Single source of truth for the deterministic attention classification of
// unreviewed patient reports. Kept dependency-free (plain objects in, plain
// objects out) so it can be regression-tested with plain `assert` — same
// pattern as reviewAdminAggregates.js's computeReviewAttentionItems.
//
// Deliberately does NOT duplicate anything: doctorCommandCenterController's
// `pendingReports` field and the new getReportsAttentionQueue endpoint both
// call this on the exact same MedicalReport.find({ doctorId, reviewedAt: null })
// result, so the Dashboard's "Reports awaiting review" count and the Reports
// Attention panel's item list can never drift apart or disagree.
//
// Real, documented, non-fabricated severity->priority rule:
//   critical + unreviewed  -> critical (patient-safety risk, highest priority)
//   urgent + unreviewed    -> warning
//   normal + unreviewed    -> info
// No emotion/urgency is inferred beyond the severity the patient themselves
// declared at upload time (MedicalReport.severity) — never guessed from
// title/notes text.
export function computeReportAttentionItems(reports) {
  const items = reports.map((report) => {
    const severity = report.severity || "normal";
    const priority = severity === "critical" ? "critical" : severity === "urgent" ? "warning" : "info";
    return {
      reportId: report._id,
      title: report.title,
      category: report.category,
      severity,
      priority,
      reportDate: report.reportDate,
      createdAt: report.createdAt,
      patientId: report.userId?._id || report.userId,
      patientName: report.userId?.name || "A patient",
    };
  });

  const priorityRank = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => {
    const rankDiff = priorityRank[a.priority] - priorityRank[b.priority];
    if (rankDiff !== 0) return rankDiff;
    // Within the same priority, oldest-unreviewed-first — the longer a
    // report has waited, the sooner it should surface.
    return new Date(a.reportDate || a.createdAt) - new Date(b.reportDate || b.createdAt);
  });
}
