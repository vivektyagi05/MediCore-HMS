import { RefreshCcw, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../../api/adminApi";
import { getApiErrorMessage } from "../../../api/axios";
import EmptyState from "../../../components/shared/EmptyState";
import ErrorState from "../../../components/shared/ErrorState";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import Input from "../../../components/ui/Input";
import Loader from "../../../components/ui/Loader";
import Select from "../../../components/ui/Select";
import ReasonDialog from "../../../components/ui/ReasonDialog";
import StatusBadge from "../../../components/ui/StatusBadge";
import { useToast } from "../../../context/ToastContext";

import { useLatestRequest } from "../../../hooks/useLatestRequest";
// [value, label, what to do next]. The server decides what is a finding; this page only explains it.
const CLASSES = [
  ["Wallet & ledger", [
    ["wallet_balance_drift", "Wallet balance vs ledger", "Compare the wallet's transactions with the ledger for this user. Never edit a balance from here."],
    ["duplicate_ledger_reference", "Duplicate ledger references", "Open the listed ledger rows and confirm which is the real posting."],
    ["reservation_contradiction", "Reservation vs wallet hold", "Use Wallet reservations to resolve through the canonical reservation service."],
  ]],
  ["Recharges", [
    ["recharge_ledger_mismatch", "Recharge vs wallet credit vs ledger", "If the wallet credit exists and only the ledger row is missing, the audited ledger backfill below is available. Anything else needs manual investigation."],
    ["recharge_ledger_orphan", "Recharge ledger credit without a valid recharge", "A ledger credit with no valid recharge behind it must be investigated manually: it may represent money that was never received."],
  ]],
  ["Payments", [
    ["payment_allocation_mismatch", "Payment allocation vs ledger", "Open the payment's Evidence tab: allocation, wallet debit and capture ledger are listed side by side."],
    ["stale_payment", "Payments flagged / stuck", "Open the payment; use the existing payment recovery. Check the provider before acting."],
    ["capture_case_open", "Duplicate / unapplicable capture evidence", "Decide each case in Capture cases (audited). Deciding never moves money."],
  ]],
  ["Refunds & earnings", [
    ["refund_without_ledger", "Refund without ledger row", "Check the provider refund, then the payment's ledger rows (Evidence tab)."],
    ["refund_total_mismatch", "Refund totals mismatch", "Compare processed refund requests with the payment's refunded amount."],
    ["stale_refund", "Refunds awaiting provider confirmation", "Open the refund and run provider reconciliation. Never retry blindly."],
    ["earning_reversal_missing", "Doctor earning not reversed", "Replaying the refund posts the reversal idempotently; confirm the refund is processed first."],
    ["earning_adjustment_inconsistent", "Doctor earning adjustments inconsistent", "The payout's own entries disagree with its totals: investigate manually before any payout."],
    ["duplicate_refund_reference", "Duplicate provider refund id", "The same provider refund is attached twice: verify with the provider which request owns it."],
    ["reference_inconsistency", "Refund references inconsistent", "Compare the refund request's provider refund id with the payment's counted refunds."],
  ]],
  ["Operations", [
    ["reservation_stale", "Stale / recovery-required reservations", "Resolve in Wallet reservations."],
    ["stale_recharge", "Recharges needing manual recovery", "Verify the provider payment for this recharge before any action."],
  ]],
];
const FLAT = CLASSES.flatMap(([, items]) => items);
const CERTAINTY = {
  confirmed: ["danger", "confirmed discrepancy"],
  missing_evidence: ["warning", "missing evidence"],
  expected_pending: ["info", "expected (in flight)"],
};
const inr = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format((paise || 0) / 100);
const EVIDENCE_FIELDS = [
  ["driftPaise", "Drift"], ["expectedPaise", "Ledger says"], ["actualPaise", "Wallet says"], ["amountPaise", "Amount"], ["totalPaise", "Total"], ["walletPaise", "Wallet part"],
  ["gatewayPaise", "Gateway part"], ["ledgerPaise", "Ledger amount"], ["refundedPaise", "Refunded"], ["doctorSharePaise", "Doctor share"], ["reversedPaise", "Reversed"],
];

// Evidence view only. The server report is read-only. The one repair offered (recharge ledger backfill) is a separate,
// explicit, audited action that re-checks the evidence on the server and only records the missing ledger fact.
function DiscrepancyReport({ onOpenPayment }) {
  const toast = useToast();
  const [category, setCategory] = useState(FLAT[0][0]);
  const [certainty, setCertainty] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [appliedPaymentId, setAppliedPaymentId] = useState("");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [repair, setRepair] = useState(null); // { rechargeId }

  const begin = useLatestRequest();
  const load = useCallback(async () => {
    const isCurrent = begin(); // switching class/filter quickly: only the newest report may render (each run is 17 finders and can be slow)
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await adminApi.getFinanceDiscrepancies({ category, page, limit: 25, ...(certainty ? { certainty } : {}), ...(appliedPaymentId ? { paymentId: appliedPaymentId } : {}) });
      if (isCurrent()) setReport(res.data);
    } catch (error) {
      if (isCurrent()) setLoadError(getApiErrorMessage(error));
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [begin, category, page, certainty, appliedPaymentId]);
  useEffect(() => { load(); }, [load]);

  const section = report?.sections?.[category];
  const pages = section?.pages || 1;
  const guidance = FLAT.find(([value]) => value === category)?.[2];

  const submitRepair = async ({ reason }) => {
    const res = await adminApi.backfillRechargeLedger(repair.rechargeId, reason); // throws -> shown inside the dialog, text kept
    toast.success(res.data.repaired ? "Ledger row recorded and audited" : "No change: the ledger row already exists");
    setRepair(null);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Discrepancy class" name="discrepancy-category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          {CLASSES.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </optgroup>
          ))}
        </Select>
        <Select label="Certainty" name="discrepancy-certainty" value={certainty} onChange={(e) => { setCertainty(e.target.value); setPage(1); }}>
          <option value="">All</option>
          <option value="confirmed">Confirmed discrepancy</option>
          <option value="missing_evidence">Missing evidence</option>
          <option value="expected_pending">Expected (in flight)</option>
        </Select>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setAppliedPaymentId(paymentId.trim()); setPage(1); }}>
          <Input label="Payment id (optional)" name="discrepancy-payment" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder="Scope to one payment" />
          <Button type="submit" variant="secondary" size="sm">Apply</Button>
        </form>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-500">
          Read-only report. It never changes a balance or writes a ledger row, and each view is recorded in the audit log.
          {report?.resolved?.wallet_balance ? ` ${report.resolved.wallet_balance} wallet discrepancies have been resolved.` : ""}
        </p>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCcw size={14} /> Re-run report</Button>
      </div>
      {guidance && <p className="rounded-card border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">What to do: {guidance}</p>}

      {isLoading ? <Loader label="Running discrepancy report" /> : loadError ? <ErrorState description={loadError} onRetry={load} /> : !section ? null : (
        <>
          {section.scanned !== undefined && (
            <p className="text-xs text-slate-500">Examined {section.scanned} of {section.scanTotal} wallets on this page of the scan.</p>
          )}
          {section.items.length === 0 ? (
            <EmptyState title="No findings" description="Nothing in this class contradicts the authoritative records for this page and filter." />
          ) : (
            <div className="space-y-2">
              {section.items.map((item) => {
                const [tone, label] = CERTAINTY[item.certainty] || ["neutral", item.certainty];
                // only the exact shape the server will accept: credited wallet, missing ledger row, confirmed (the server re-checks anyway)
                const canRepair = item.category === "recharge_ledger_mismatch" && item.certainty === "confirmed" && item.evidence?.walletCredit === true && item.evidence?.ledgerRow === false;
                return (
                  <Card key={item.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">{item.note}</p>
                      <StatusBadge tone={tone}>{label}</StatusBadge>
                    </div>
                    <dl className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                      {EVIDENCE_FIELDS.filter(([key]) => item[key] !== undefined).map(([key, text]) => <div key={key}><dt className="text-slate-400">{text}</dt><dd className="font-bold">{inr(item[key])}</dd></div>)}
                      {item.count !== undefined && <div><dt className="text-slate-400">Rows sharing reference</dt><dd>{item.count}</dd></div>}
                      {item.ageMs != null && <div><dt className="text-slate-400">Age</dt><dd>{Math.round(item.ageMs / 60000)} min</dd></div>}
                      {item.refundState && <div><dt className="text-slate-400">Refund state</dt><dd>{item.refundState}</dd></div>}
                      {item.disposition && <div><dt className="text-slate-400">Capture disposition</dt><dd>{item.disposition}</dd></div>}
                      {item.recoveryAttempts !== undefined && <div><dt className="text-slate-400">Recovery attempts</dt><dd>{item.recoveryAttempts}</dd></div>}
                      {item.evidence && <div><dt className="text-slate-400">Wallet credit / ledger row</dt><dd>{item.evidence.walletCredit ? "present" : "absent"} / {item.evidence.ledgerRow ? "present" : "absent"}</dd></div>}
                      {(item.gatewayRefundId || item.subject?.gatewayRefundId) && <div><dt className="text-slate-400">Provider refund</dt><dd className="font-mono">{item.gatewayRefundId || item.subject.gatewayRefundId}</dd></div>}
                      <div className="sm:col-span-3"><dt className="text-slate-400">Finding id</dt><dd className="font-mono">{item.id}</dd></div>
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.subject?.paymentId && onOpenPayment && <Button variant="tertiary" size="sm" onClick={() => onOpenPayment(item.subject.paymentId)}>Open payment</Button>}
                      {item.subject?.paymentId && <Button variant="tertiary" size="sm" onClick={() => { setPaymentId(item.subject.paymentId); setAppliedPaymentId(item.subject.paymentId); setPage(1); }}>Investigate this payment</Button>}
                      {canRepair && <Button variant="secondary" size="sm" onClick={() => setRepair({ rechargeId: item.subject.rechargeId })}><Wrench size={14} /> Record missing ledger row</Button>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Page {page} of {pages}{section.total !== undefined ? ` · ${section.total} records examined` : ""}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      <ReasonDialog
        isOpen={Boolean(repair)}
        title="Record the missing ledger row"
        description="The wallet was already credited for this recharge; only its ledger row is missing. The server re-checks that evidence now and records exactly that one row. No balance, recharge or payout changes, and the action is audited with your reason."
        fields={[{ name: "reason", label: "Reason", min: 10, max: 300, multiline: true }]}
        confirmLabel="Record ledger row"
        onClose={() => setRepair(null)}
        onSubmit={submitRepair}
      />
    </div>
  );
}

export default DiscrepancyReport;
