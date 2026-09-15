import { AlertTriangle, RefreshCcw, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { financeApi } from "../../api/financeApi";
import { getApiErrorMessage } from "../../api/axios";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0,
  );

const SEVERITY_TONE = { critical: "danger", warning: "warning", info: "info" };

// PHASE UI-7 — Finance Operations / Collections & Reconciliation. Replaces
// the previous /admin/finance/ops target (FinanceHistory.jsx, a generic
// ledger + reconciliation-count page). REUSES the existing
// financeApi.getLedger()/retryDuePayments()/getReconciliationReport()/
// repairIncompletePayments() calls (nothing here is a duplicate payment
// engine) and adds the two things that genuinely didn't exist: a real
// Collections/Receivables view (outstanding aging, retry candidates) and
// a detailed, itemized reconciliation panel (financeAggregates.js).
function FinanceOperations() {
  const toast = useToast();
  const navigate = useNavigate();
  const { dashboardSyncTick } = useRealtime();

  const [collections, setCollections] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isRetryingDue, setIsRetryingDue] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [collectionsRes, reconciliationRes, ledgerRes] = await Promise.all([
        adminApi.getFinanceCollections(),
        adminApi.getFinanceReconciliation(),
        financeApi.getLedger({ limit: 20 }),
      ]);
      setCollections(collectionsRes.data);
      setReconciliation(reconciliationRes.data);
      setLedger(ledgerRes.data.ledger || []);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [dashboardSyncTick]);

  const retryDue = async () => {
    setIsRetryingDue(true);
    try {
      const response = await financeApi.retryDuePayments();
      toast.success(`${response.data.retried} failed payment retries processed`);
      await loadAll();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsRetryingDue(false);
    }
  };

  const repairIncomplete = async () => {
    setIsRepairing(true);
    try {
      const response = await financeApi.repairIncompletePayments();
      toast.success(`${response.data.repaired} of ${response.data.results.length} incomplete payments repaired`);
      await loadAll();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsRepairing(false);
    }
  };

  if (isLoading) return <Loader label="Loading finance operations" />;
  if (loadError) return <ErrorState description={loadError} onRetry={loadAll} />;
  if (!collections || !reconciliation) return null;

  const agingOrder = ["0-24h", "1-3d", "3-7d", "7d+"];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Finance Operations"
        title="Collections & Reconciliation"
        description="Outstanding receivables, failed-payment retry candidates, and real financial-integrity checks — detection only, never an automatic correction of a financial record."
        action={
          <Button onClick={loadAll} variant="secondary">
            <RefreshCcw size={16} /> Refresh
          </Button>
        }
      />

      {/* Collections / Receivables */}
      <div>
        <h3 className="mb-3 text-base font-bold text-slate-950">Collections &amp; Receivables</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Outstanding"
            value={formatCurrency(collections.outstandingAmount)}
            caption={`${collections.outstandingCount} checkouts in progress`}
          />
          <MetricCard
            label="Failed (not reviewed)"
            value={formatCurrency(collections.failedAmount)}
            tone="danger"
            caption={`${collections.failedCount} payments`}
          />
          <MetricCard
            label="Retry Candidates"
            value={collections.retryCandidates.length}
            caption="Still within the automatic retry window"
          />
          <MetricCard
            label="Dead-letter"
            value={collections.deadLetterCount}
            tone={collections.deadLetterCount > 0 ? "danger" : "neutral"}
            caption="Retries exhausted — see Payments workspace"
          />
        </div>

        <Card className="mt-4" title="Outstanding aging">
          <p className="mb-3 text-xs font-semibold text-slate-400">{collections.agingLimitation}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {agingOrder.map((key) => (
              <div key={key} className="rounded-card border border-slate-200 bg-white p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{key}</p>
                <p className="mt-1 text-lg font-bold text-slate-950">{formatCurrency(collections.aging[key]?.amount)}</p>
                <p className="text-xs text-slate-500">{collections.aging[key]?.count || 0} checkouts</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-4" title="High-value outstanding" action={<Button variant="tertiary" size="sm" onClick={retryDue} isLoading={isRetryingDue}><RefreshCcw size={14} /> Retry Due Payments</Button>}>
          {collections.highValueOutstanding.length ? (
            <div className="space-y-2">
              {collections.highValueOutstanding.slice(0, 8).map((payment) => (
                <button
                  type="button"
                  key={payment._id}
                  onClick={() => navigate(`/admin/payments?search=${payment._id}`)}
                  className="flex w-full items-center justify-between rounded-card border border-slate-200 bg-white p-3 text-left transition hover:border-royal-300"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-800">{payment.userId?.name || "Unknown patient"}</p>
                    <p className="text-xs text-slate-500">{new Date(payment.createdAt).toLocaleString()}</p>
                  </div>
                  <p className="font-bold text-slate-950">{formatCurrency(payment.totalAmount)}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No outstanding checkouts right now.</p>
          )}
        </Card>
      </div>

      {/* Reconciliation */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-950">
          <ShieldCheck size={18} className="text-royal-600" /> Financial Reconciliation
        </h3>
        <p className="mb-3 text-xs font-semibold text-slate-500">{reconciliation.resolutionNote}</p>

        <div className="space-y-3">
          {reconciliation.issues.filter((issue) => issue.count > 0).length === 0 && (
            <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
              No reconciliation issues detected across {reconciliation.checkedPayments} checked payments.
            </div>
          )}
          {reconciliation.issues
            .filter((issue) => issue.count > 0)
            .map((issue) => (
              <div key={issue.type} className="rounded-card border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className={issue.severity === "critical" ? "text-rose-600" : "text-amber-600"} />
                    <p className="font-bold text-slate-950">{issue.title}</p>
                    <StatusBadge tone={SEVERITY_TONE[issue.severity] || "neutral"}>{issue.count}</StatusBadge>
                  </div>
                  {issue.type === "captured_incomplete" && (
                    <Button variant="secondary" size="sm" onClick={repairIncomplete} isLoading={isRepairing}>
                      <Wrench size={14} /> Repair Automatically
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{issue.description}</p>
              </div>
            ))}
        </div>
      </div>

      {/* Ledger */}
      <div>
        <h3 className="mb-3 text-base font-bold text-slate-950">Recent Ledger Entries</h3>
        <Card>
          {ledger.length ? (
            <div className="space-y-2">
              {ledger.map((entry) => (
                <div key={entry._id} className="flex items-center justify-between rounded-card border border-slate-100 bg-white p-3">
                  <div>
                    <p className="font-bold capitalize text-slate-900">{entry.type.replace("_", " ")}</p>
                    <p className="text-xs text-slate-500">
                      {entry.status} · {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <p className="font-bold text-royal-700">
                    {entry.currency} {entry.amount}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No ledger entries yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default FinanceOperations;
