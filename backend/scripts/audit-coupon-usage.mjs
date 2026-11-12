// READ-ONLY coupon usage inventory (Phase 03 completion). Never writes. Per coupon it reports:
//  - legacy entries (no `state`): written before the reserve/redeem lifecycle; they are NEVER reclassified or released
//  - counter vs entry mismatches (usedCount != usedBy.length, redeemedCount != redeemed entries)
//  - duplicate payment ids inside one coupon (a payment must hold at most one reservation)
//  - reservations older than the orphan grace window (what the recovery job will examine)
// Exit 0 = clean, 2 = findings, 1 = could not run. Run against a COPY / secondary. No migration is implied by findings.
import mongoose from "mongoose";

export const inventoryCoupon = (coupon, { now = new Date(), staleMs = 15 * 60 * 1000 } = {}) => {
  const entries = coupon.usedBy || [];
  const by = (s) => entries.filter((e) => e.state === s).length;
  const legacy = entries.filter((e) => !e.state).length;
  const ids = entries.map((e) => String(e.paymentId)).filter((x) => x !== "undefined");
  const duplicatePayments = ids.length - new Set(ids).size;
  const staleReserved = entries.filter((e) => e.state === "reserved" && now - new Date(e.usedAt || e.reservedAt || now) > staleMs).length;
  const issues = [];
  if ((coupon.usedCount || 0) !== entries.length) issues.push(`usedCount ${coupon.usedCount || 0} != ${entries.length} usedBy entries`);
  if (by("redeemed") > 0 && (coupon.redeemedCount || 0) !== by("redeemed")) issues.push(`redeemedCount ${coupon.redeemedCount || 0} != ${by("redeemed")} redeemed entries`);
  if (duplicatePayments) issues.push(`${duplicatePayments} duplicate payment id(s) in usedBy`);
  return { reserved: by("reserved"), redeemed: by("redeemed"), legacyUnclassified: legacy, staleReserved, duplicatePayments, issues };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error("MONGO_URI is required"); process.exit(1); }
  await mongoose.connect(uri, { readPreference: "secondaryPreferred" });
  let scanned = 0; let legacyTotal = 0; const findings = [];
  for await (const c of mongoose.connection.collection("coupons").find({}, { projection: { code: 1, usedCount: 1, redeemedCount: 1, usedBy: 1 } })) {
    scanned += 1; const inv = inventoryCoupon(c); legacyTotal += inv.legacyUnclassified;
    if (inv.issues.length || inv.staleReserved) findings.push({ couponId: String(c._id), code: c.code, ...inv });
  }
  console.log(JSON.stringify({ scanned, legacyUnclassifiedEntries: legacyTotal, couponsWithFindings: findings.length, findings: findings.slice(0, 200) }, null, 2));
  await mongoose.disconnect();
  process.exit(findings.length ? 2 : 0);
}
