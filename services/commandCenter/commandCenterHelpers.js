// PHASE UI-9 — Executive Admin Command Center.
//
// Pure, dependency-free helpers only (plain objects in, plain objects out —
// no model imports, no DB access) so they can be regression-tested with
// plain `assert`, same pattern as reviewAdminAggregates.js and
// processGovernanceEngine.js's injectable-policy design.

// Groups the already-computed, already-severity-ranked review attention
// items (computeReviewAttentionItems from reviewAdminAggregates.js —
// reused, not reimplemented) by the doctor each underlying review belongs
// to. Only reviews already flagged critical/warning by the existing engine
// count toward a doctor's attention total — pinned/info items never do.
export function groupReviewAttentionByDoctor(attentionItems, reviewsById) {
  const byDoctor = new Map();
  for (const item of attentionItems) {
    if (item.severity !== "critical" && item.severity !== "warning") continue;
    const review = reviewsById.get(String(item.reviewId));
    const doctorId = review?.doctorId?._id || review?.doctorId;
    if (!doctorId) continue;
    const key = String(doctorId);
    if (!byDoctor.has(key)) {
      byDoctor.set(key, {
        doctorId: key,
        doctorName: review?.doctorId?.userId?.name || "Unknown doctor",
        criticalCount: 0,
        warningCount: 0,
      });
    }
    const entry = byDoctor.get(key);
    if (item.severity === "critical") entry.criticalCount += 1;
    else entry.warningCount += 1;
  }
  return Array.from(byDoctor.values()).sort((a, b) => b.criticalCount - a.criticalCount || b.warningCount - a.warningCount);
}
