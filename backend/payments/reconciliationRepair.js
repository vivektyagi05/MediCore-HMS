// Phase 03 completion -- the ONLY write operation next to the read-only discrepancy report, and deliberately narrow:
// post the MISSING wallet_credit ledger row for a recharge that is already `posted` and whose wallet credit already exists.
//   * explicit SUPER_ADMIN action with a reason (10-300 chars); never run by the report or any job
//   * evidence is re-read immediately before mutating: recharge posted, wallet credit present for exactly this recharge and amount,
//     ledger row absent. Any mismatch => refuses with the evidence (no write)
//   * idempotent: the ledger idempotency key is the same one normal posting uses, so a retry/double click/concurrent normal
//     recovery can never create a second row (a duplicate-key outcome is reported as already_present)
//   * never changes a wallet balance, the recharge, a payout or provider state: it only records the already-true ledger fact
//   * before/after evidence + operator + reason go to the admin audit log
// Every other discrepancy class is investigation-only (see the report's evidence and the existing audited actions).
import Wallet from "../models/Wallet.js";
import WalletRecharge from "../models/WalletRecharge.js";
import TransactionLedger from "../models/TransactionLedger.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { rechargeLedgerKey, rechargeRef } from "./walletRechargeService.js";
import { toPaise } from "./money.js";

export const backfillRechargeLedger = async ({ actor, rechargeId, reason, audit }) => {
  if (!actor || actor.role !== "super_admin") throw new AppError("Only a super admin can run a reconciliation repair", 403, { code: "REPAIR_FORBIDDEN" });
  const text = String(reason || "").trim();
  if (text.length < 10 || text.length > 300) throw new AppError("A reason of 10-300 characters is required", 400, { code: "REASON_REQUIRED" });
  const recharge = await WalletRecharge.findById(rechargeId).lean();
  if (!recharge) throw new AppError("Recharge not found", 404);
  if (recharge.status !== "posted") throw new AppError(`Only a posted recharge can be repaired (this one is ${recharge.status})`, 409, { code: "REPAIR_NOT_APPLICABLE" });

  const key = rechargeLedgerKey(recharge._id);
  const [existing, wallet] = await Promise.all([
    TransactionLedger.findOne({ idempotencyKey: key }).lean(),
    Wallet.findOne({ userId: recharge.userId, transactions: { $elemMatch: { referenceType: "recharge", referenceId: rechargeRef(recharge._id) } } }).select("_id transactions.referenceType transactions.referenceId transactions.amount").lean(),
  ]);
  const before = { ledgerRowPresent: Boolean(existing), walletCreditPresent: Boolean(wallet) };
  if (existing) return { repaired: false, reason: "already_present", before, ledgerEntryId: String(existing._id) };
  if (!wallet) throw new AppError("No wallet credit exists for this recharge; a ledger row would invent money. Investigate manually.", 409, { code: "REPAIR_EVIDENCE_MISSING", details: before });
  const credit = (wallet.transactions || []).find((t) => t.referenceType === "recharge" && t.referenceId === rechargeRef(recharge._id));
  if (toPaise(credit?.amount) !== toPaise(recharge.amount)) throw new AppError("Wallet credit amount differs from the recharge amount; investigate manually.", 409, { code: "REPAIR_EVIDENCE_MISMATCH", details: { walletCreditPaise: toPaise(credit?.amount), rechargePaise: toPaise(recharge.amount) } });

  let created;
  try {
    created = await TransactionLedger.create({
      userId: recharge.userId, walletId: wallet._id, type: "wallet_credit", direction: "credit", amount: recharge.amount, currency: recharge.currency,
      status: "posted", referenceId: recharge.gatewayPaymentId, idempotencyKey: key,
      metadata: { rechargeId: String(recharge._id), gatewayOrderId: recharge.gatewayOrderId, backfilled: true, backfillReason: text, backfilledBy: String(actor._id) },
    });
  } catch (error) {
    if (error?.code === 11000) return { repaired: false, reason: "already_present", before };
    throw error;
  }
  const after = { ledgerRowPresent: true, walletCreditPresent: true, ledgerEntryId: String(created._id), amountPaise: toPaise(recharge.amount) };
  if (audit) await audit({ action: "finance.recharge_ledger_backfilled", resourceType: "WalletRecharge", resourceId: String(recharge._id), severity: "warning", metadata: { reason: text, before, after } });
  return { repaired: true, before, after, ledgerEntryId: String(created._id) };
};
