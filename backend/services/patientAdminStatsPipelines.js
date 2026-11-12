// S8 (A-06, stats part): distinct-patient counts computed inside MongoDB instead of `.distinct()` id lists shipped to
// Node and measured with `.length`/`Set.size`. The filters are the ones the previous `.distinct()` calls used; only the
// counting moved. `$unionWith` needs MongoDB >= 4.4 (docker-compose pins mongo:7).
//
// `.distinct()` never returns documents that lack the field, whereas `$group` would collect them under `null`, so each
// branch also requires the id field to exist and be non-null.
export const OPEN_PAYMENT_STATUSES = ["created", "pending", "failed"];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const hasId = (field) => ({ [field]: { $exists: true, $ne: null } });

// Number of distinct patients with a non-cancelled appointment after `now`.
export const buildUpcomingPatientCountPipeline = (now) => [
  { $match: { date: { $gt: now }, status: { $ne: "cancelled" }, ...hasId("patientId") } },
  { $group: { _id: "$patientId" } },
  { $count: "count" },
];

// Number of distinct patients matching ANY of the four attention conditions that resolveAdvancedIdFilters/stats use:
// failed payment, unreviewed non-normal report, insurance expiring within 30 days (or already expired), open payment.
// Run on the Payment collection; the other conditions are unioned in.
export const buildAttentionPatientCountPipeline = (now, { medicalReportCollection, insuranceCollection, paymentCollection }) => [
  { $match: { status: "failed", ...hasId("userId") } },
  { $group: { _id: "$userId" } },
  { $unionWith: { coll: medicalReportCollection, pipeline: [{ $match: { severity: { $ne: "normal" }, reviewedAt: null, ...hasId("userId") } }, { $group: { _id: "$userId" } }] } },
  { $unionWith: { coll: insuranceCollection, pipeline: [{ $match: { validTill: { $lte: new Date(now.getTime() + 30 * ONE_DAY_MS) }, ...hasId("userId") } }, { $group: { _id: "$userId" } }] } },
  { $unionWith: { coll: paymentCollection, pipeline: [{ $match: { status: { $in: OPEN_PAYMENT_STATUSES }, ...hasId("userId") } }, { $group: { _id: "$userId" } }] } },
  { $group: { _id: "$_id" } },
  { $count: "count" },
];

export const countFrom = (rows) => rows?.[0]?.count || 0;
