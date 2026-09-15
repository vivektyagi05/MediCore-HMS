import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CircleHelp,
  FileText,
  IndianRupee,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import { MiniBarChart, MiniDonut } from "../../components/finance/FinanceCharts";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0,
  );

const SEVERITY_TONE = { critical: "danger", warning: "warning", info: "info" };

// PHASE UI-7 — Finance Executive Command Center.
//
// AUDIT FINDING: this page previously called paymentController.js's
// getFinancialSummary (patient/legacy fields) and duplicated the
// approve-refund and initiate-refund UI that Refunds UI-6 and Payments
// UI-5 already own correctly (with concurrency locks, confirmation
// dialogs, and failure-reason handling this page never had). All of that
// duplicate mutation UI is removed — this page is now read-only executive
// intelligence that deep-links into the Payments/Refunds/Invoices/Finance
// Operations workspaces that actually own those actions, per Section 1's
// "Finance reads real financial state, never rebuilds it" rule.
function AdminFinanceDashboard() {
  const toast = useToast();
  const navigate = useNavigate();
  const { dashboardSyncTick } = useRealtime();

  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [attention, setAttention] = useState(null);
  const [trend, setTrend] = useState(null);
  const [period, setPeriod] = useState("daily");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const loadCore = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [overviewRes, healthRes, breakdownRes, attentionRes] = await Promise.all([
        adminApi.getFinanceOverview(),
        adminApi.getFinanceHealth(),
        adminApi.getRevenueBreakdown(),
        adminApi.getFinanceAttentionQueue(),
      ]);
      setOverview(overviewRes.data);
      setHealth(healthRes.data);
      setBreakdown(breakdownRes.data);
      setAttention(attentionRes.data);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadTrend = async (selectedPeriod) => {
    try {
      const response = await adminApi.getRevenueTrend({ period: selectedPeriod });
      setTrend(response.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Revenue trend is unavailable.");
    }
  };

  useEffect(() => {
    loadCore();
  }, [dashboardSyncTick]);

  useEffect(() => {
    loadTrend(period);
  }, [period, dashboardSyncTick]);

  const generateSummary = async () => {
    setIsAiLoading(true);
    try {
      const response = await adminApi.getFinanceExecutiveSummary();
      setAiSummary(response.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsAiLoading(false);
    }
  };

  if (isLoading) return <Loader label="Loading finance command center" />;

  const isRestricted = loadError && /permission/i.test(loadError);
  if (isRestricted) {
    return (
      <ErrorState
        title="Financial data restricted"
        description="Your admin account does not have permission to view Finance. Contact a super admin to request manage_payments access."
      />
    );
  }
  if (loadError) return <ErrorState description={loadError} onRetry={loadCore} />;
  if (!overview || !health || !breakdown || !attention) return null;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Finance"
        title="Finance Executive Command Center"
        description="How the hospital is financially performing, right now — every figure below traces back to a real Payment, RefundRequest, or Invoice record."
      />

      {/* KPI layer */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Gross Revenue"
          value={formatCurrency(overview.grossRevenue)}
          icon={Banknote}
          tone="success"
          caption={`${overview.capturedPaymentsCount} captured payments · all-time`}
        />
        <MetricCard
          label="Net Revenue"
          value={formatCurrency(overview.netRevenue)}
          icon={IndianRupee}
          caption={`After ${formatCurrency(overview.refundedAmount)} in refunds`}
        />
        <MetricCard
          label="Outstanding"
          value={formatCurrency(overview.outstandingAmount)}
          caption={`${overview.outstandingCount} checkouts in progress`}
        />
        <MetricCard
          label="Failed Payments"
          value={formatCurrency(overview.failedAmount)}
          tone={overview.failedCount > 0 ? "danger" : "neutral"}
          icon={XCircle}
          caption={`${overview.failedCount} payments`}
        />
        <MetricCard
          label="Invoice Value"
          value={formatCurrency(overview.invoiceValue)}
          icon={FileText}
          caption={`${overview.invoiceCount} invoices issued`}
        />
        <MetricCard
          label="Refunds Pending Review"
          value={overview.refundsPendingCount}
          tone={overview.refundsPendingCount > 0 ? "danger" : "neutral"}
          icon={RotateCcw}
          caption={formatCurrency(overview.refundsPendingAmount)}
        />
        <MetricCard
          label="Gateway Collected"
          value={formatCurrency(overview.gatewayCollected)}
          caption="Actually charged via Razorpay"
        />
        <MetricCard
          label="Wallet Collected"
          value={formatCurrency(overview.walletCollected)}
          caption="Covered from patient wallet balance"
        />
      </div>

      {/* Financial health */}
      <button type="button" className="block w-full text-left" onClick={() => setIsHealthModalOpen(true)}>
        <Card className="transition hover:border-royal-300">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold ${
                health.score === null
                  ? "bg-slate-100 text-slate-400"
                  : health.score >= 75
                    ? "bg-emerald-100 text-emerald-700"
                    : health.score >= 50
                      ? "bg-amber-100 text-amber-700"
                      : "bg-rose-100 text-rose-700"
              }`}>
                {health.score === null ? "—" : health.score}
              </div>
              <div>
                <p className="text-base font-bold text-slate-950">Financial Health Score</p>
                <p className="text-sm text-slate-500">{health.score === null ? health.reason : "Click to see the contributing factors"}</p>
              </div>
            </div>
            <CircleHelp className="text-slate-400" size={20} />
          </div>
        </Card>
      </button>

      {/* Revenue intelligence */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-950">Revenue Intelligence</h3>
          <Select value={period} name="period" onChange={(e) => setPeriod(e.target.value)} className="w-40">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
        <Card>
          {trend?.hasData ? (
            <MiniBarChart data={trend.revenue} valueKey="grossRevenue" labelKey="bucket" formatValue={formatCurrency} />
          ) : (
            <p className="text-sm font-semibold text-slate-400">
              No captured payments in this period yet — the trend will populate as revenue comes in.
            </p>
          )}
        </Card>
      </div>

      {/* Revenue breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Revenue by Doctor (Top 10)">
          {breakdown.byDoctor.length ? (
            <div className="space-y-2">
              {breakdown.byDoctor.map((entry) => (
                <button
                  type="button"
                  key={entry.doctorId}
                  onClick={() => navigate(`/admin/payments?doctorId=${entry.doctorId}`)}
                  className="flex w-full items-center justify-between rounded-card border border-slate-200 bg-white p-3 text-left transition hover:border-royal-300"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-800">Dr. {entry.doctorName}</p>
                    <p className="text-xs text-slate-500">{entry.specialization}</p>
                  </div>
                  <p className="font-bold text-slate-950">{formatCurrency(entry.grossRevenue)}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No captured revenue by doctor yet.</p>
          )}
        </Card>
        <Card title="Collection Method">
          <MiniDonut
            segments={breakdown.byCollectionMethod.map((entry, i) => ({
              label: entry.label,
              value: entry.value,
              color: i === 0 ? "#2563eb" : "#d4af37",
            }))}
          />
        </Card>
      </div>

      {/* AI Executive Summary */}
      <Card title="AI Executive Summary" action={
        <Button variant="secondary" onClick={generateSummary} isLoading={isAiLoading}>
          <Sparkles size={14} /> {aiSummary ? "Regenerate" : "Generate"}
        </Button>
      }>
        {aiSummary ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-royal-600">Facts</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {aiSummary.content.facts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-royal-600">Recommendations</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {aiSummary.content.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs font-semibold text-slate-400">{aiSummary.disclaimer}</p>
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-400">
            Generate a grounded, FACT-then-RECOMMENDATION brief from the real numbers above.
          </p>
        )}
      </Card>

      {/* Financial Operations Queue */}
      <div>
        <h3 className="mb-3 text-base font-bold text-slate-950">Financial Operations Queue</h3>
        {attention.items.length ? (
          <div className="space-y-2">
            {attention.items.slice(0, 15).map((item, i) => (
              <button
                type="button"
                key={`${item.type}-${item.recordId || i}`}
                onClick={() => navigate(item.link)}
                className="flex w-full items-center justify-between gap-4 rounded-card border border-slate-200 bg-white p-4 text-left transition hover:border-royal-300"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle size={16} className={item.severity === "critical" ? "mt-0.5 text-rose-600" : "mt-0.5 text-amber-600"} />
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.title}</p>
                    <p className="text-xs text-slate-500">{item.what}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={SEVERITY_TONE[item.severity] || "neutral"}>
                    {item.amount ? formatCurrency(item.amount) : item.count}
                  </StatusBadge>
                  <ArrowRight size={14} className="text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-sm font-semibold text-emerald-700">No open financial attention items right now.</p>
          </Card>
        )}
      </div>

      <AdminModal isOpen={isHealthModalOpen} title="Financial Health — Contributing Factors" onClose={() => setIsHealthModalOpen(false)}>
        {health.score === null ? (
          <p className="text-sm font-semibold text-slate-500">{health.reason}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{health.formula}</p>
            {health.factors.map((factor) => (
              <div key={factor.key} className="rounded-card border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">{factor.label}</p>
                  <p className="text-lg font-bold text-royal-700">{factor.value}</p>
                </div>
                <p className="mt-1 text-xs text-slate-500">{factor.description}</p>
              </div>
            ))}
          </div>
        )}
      </AdminModal>
    </div>
  );
}

export default AdminFinanceDashboard;
