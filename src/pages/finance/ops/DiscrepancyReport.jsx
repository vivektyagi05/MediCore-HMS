import { RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../../api/adminApi";
import { getApiErrorMessage } from "../../../api/axios";
import EmptyState from "../../../components/shared/EmptyState";
import ErrorState from "../../../components/shared/ErrorState";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import Loader from "../../../components/ui/Loader";
import Select from "../../../components/ui/Select";
import StatusBadge from "../../../components/ui/StatusBadge";

const CATEGORIES = [
  ["wallet_balance_drift", "Wallet balance vs ledger"],
  ["duplicate_ledger_reference", "Duplicate ledger references"],
  ["refund_without_ledger", "Refund without ledger row"],
  ["refund_total_mismatch", "Refund totals mismatch"],
  ["reservation_stale", "Stale / recovery-required reservations"],
  ["reservation_contradiction", "Reservation vs wallet hold contradiction"],
];
const inr = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format((paise || 0) / 100);

// Evidence view only. The server report is read-only by design: there is deliberately no
// "fix" button here. Missing evidence is labelled differently from a confirmed contradiction.
function DiscrepancyReport({ onOpenPayment }) {
  const [category, setCategory] = useState(CATEGORIES[0][0]);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await adminApi.getFinanceDiscrepancies({ category, page, limit: 25 });
      setReport(res.data);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [category, page]);
  useEffect(() => { load(); }, [load]);

  const section = report?.sections?.[category];
  const pages = section?.pages || 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-sm">
          <Select label="Discrepancy class" name="discrepancy-category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCcw size={14} /> Re-run report</Button>
      </div>
      <p className="text-xs font-semibold text-slate-500">
        Read-only report. It never changes a wallet balance or writes a ledger row, and each view is recorded in the audit log.
      </p>

      {isLoading ? <Loader label="Running discrepancy report" /> : loadError ? <ErrorState description={loadError} onRetry={load} /> : !section ? null : (
        <>
          {category === "wallet_balance_drift" && (
            <p className="text-xs text-slate-500">Examined {section.scanned} of {section.scanTotal} wallets on this page of the scan.</p>
          )}
          {section.items.length === 0 ? (
            <EmptyState title="No findings" description="Nothing in this class contradicts the authoritative records for this page." />
          ) : (
            <div className="space-y-2">
              {section.items.map((item) => (
                <Card key={item.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900">{item.note}</p>
                    <StatusBadge tone={item.certainty === "confirmed" ? "danger" : "warning"}>
                      {item.certainty === "confirmed" ? "confirmed discrepancy" : "missing evidence"}
                    </StatusBadge>
                  </div>
                  <dl className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                    {item.driftPaise !== undefined && <div><dt className="text-slate-400">Drift</dt><dd className="font-bold">{inr(item.driftPaise)}</dd></div>}
                    {item.expectedPaise !== undefined && <div><dt className="text-slate-400">Ledger says</dt><dd>{inr(item.expectedPaise)}</dd></div>}
                    {item.actualPaise !== undefined && <div><dt className="text-slate-400">Wallet says</dt><dd>{inr(item.actualPaise)}</dd></div>}
                    {item.amountPaise !== undefined && <div><dt className="text-slate-400">Amount</dt><dd>{inr(item.amountPaise)}</dd></div>}
                    {item.count !== undefined && <div><dt className="text-slate-400">Rows sharing reference</dt><dd>{item.count}</dd></div>}
                    {item.ageMs !== undefined && <div><dt className="text-slate-400">Age</dt><dd>{Math.round(item.ageMs / 60000)} min</dd></div>}
                    <div className="sm:col-span-3"><dt className="text-slate-400">Finding id</dt><dd className="font-mono">{item.id}</dd></div>
                  </dl>
                  {item.subject?.paymentId && onOpenPayment && (
                    <Button className="mt-2" variant="tertiary" size="sm" onClick={() => onOpenPayment(item.subject.paymentId)}>Open payment</Button>
                  )}
                </Card>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Page {page} of {pages}{section.total !== undefined ? ` · ${section.total} findings` : ""}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DiscrepancyReport;
