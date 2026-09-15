// PHASE DOC-09 — Doctor Earnings / Financial Control Center.
//
// Pure, dependency-free helpers extracted out of doctorEarningsController.js
// so the real logic they encode can be regression-tested with plain assert
// (no Mongo/DB needed) — same discipline as doctorReviewFiltering.js and
// paginationValidation.js.

/**
 * Given how many payouts sort *before* a deep-linked target payout under
 * the list's current sort order (a bounded countDocuments() call — never a
 * full in-memory scan), return which 1-based page it lives on. Used by
 * GET /doctors/payouts?payoutId=... so Smart Inbox's existing
 * "/doctor/earnings?payoutId=..." deep link still resolves to the exact
 * page containing that payout even though the list is now server-side
 * paginated instead of loaded whole into the browser.
 */
export function resolvePageFromIndex(indexBefore, pageSize) {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20;
  const safeIndex = Number.isFinite(indexBefore) && indexBefore >= 0 ? indexBefore : 0;
  return Math.floor(safeIndex / safePageSize) + 1;
}

/**
 * Income forecast basis: a simple average of the last N *complete* months
 * (the current, still-in-progress month is always excluded — it isn't a
 * complete month yet, and including it would understate every forecast
 * made before the month ends). Requires at least 2 complete months of real
 * settled-payout history before returning a number at all; with 0 or 1
 * complete months, returns null rather than presenting a single data point
 * (or worse, a fabricated 0) as if it were a projection.
 *
 * `monthlyTrend` must already be in chronological order, oldest first,
 * with the CURRENT month as the final entry (matches the shape
 * buildDoctorRevenueIntelligence's monthlyTrend already produces).
 */
export function computeIncomeForecast(monthlyTrend) {
  if (!Array.isArray(monthlyTrend) || monthlyTrend.length < 2) {
    return { value: null, basisMonths: 0 };
  }
  // Exclude the current (last, still in progress) month.
  const completeMonths = monthlyTrend.slice(0, -1);
  if (completeMonths.length < 2) {
    return { value: null, basisMonths: completeMonths.length };
  }
  // Average of up to the last 3 complete months.
  const basis = completeMonths.slice(-3);
  const value = Number(
    (basis.reduce((sum, m) => sum + (Number(m.amount) || 0), 0) / basis.length).toFixed(2),
  );
  return { value, basisMonths: basis.length };
}
