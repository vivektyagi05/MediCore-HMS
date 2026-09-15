import {
  Wallet,
  IndianRupee,
  Clock3,
  CheckCircle2,
  Search,
  TrendingUp,
  Receipt,
  PiggyBank,
  ShieldCheck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { doctorApi } from "../../api/doctorApi";
import { invoiceApi } from "../../api/invoiceApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import MetricCard from "../../components/ui/MetricCard";
import Loader from "../../components/ui/Loader";
import Skeleton from "../../components/shared/Skeleton";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import DoctorWithdrawalPanel from "../../components/finance/DoctorWithdrawalPanel";
import BusinessIntelligenceNav from "../../components/business/BusinessIntelligenceNav";
import { MiniBarChart } from "../../components/finance/FinanceCharts";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

const PAYOUT_STATUS_TONE = {
  pending: "warning",
  paid: "success",
  cancelled: "neutral",
};

const SEVERITY_TONE = {
  critical: "danger",
  warning: "warning",
};

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// One WHAT / WHY / ACTION attention item — every action either deep-links
// to a page the doctor genuinely has access to, or is plainly informational
// (never a dead button that looks clickable but does nothing).
function AttentionItem({ item }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Badge tone={SEVERITY_TONE[item.severity] || "neutral"} icon={AlertTriangle}>
          {item.type === "reconciliation" ? "Reconciliation" : item.type === "refund" ? "Refund" : "Payment"}
        </Badge>
        {item.amount != null && <p className="text-sm font-black text-slate-900">{money(item.amount)}</p>}
      </div>
      <p className="mt-2 text-sm font-bold text-slate-900">{item.what}</p>
      <p className="mt-1 text-xs text-slate-500">{item.why}</p>
      {item.action?.to ? (
        <Button size="sm" variant="secondary" to={item.action.to} className="mt-3">
          {item.action.label}
        </Button>
      ) : item.action?.label ? (
        <p className="mt-3 text-xs font-semibold text-slate-400">{item.action.label}</p>
      ) : null}
    </div>
  );
}

function DoctorEarnings() {
  const { t } = useI18n();
  const { dashboardSyncTick } = useRealtime();

  // ── Core earnings summary (Financial Position + trend + tax/fee/refund) ──
  const [earnings, setEarnings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [period, setPeriod] = useState("monthly"); // daily(today)/weekly/monthly/quarterly/yearly

  // ── Custom date range comparison (Section 6 — server-side, equivalent-period) ──
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangePosition, setRangePosition] = useState(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");

  // ── Financial Attention ──
  const [attention, setAttention] = useState(null);
  const [attentionLoading, setAttentionLoading] = useState(true);
  const [attentionError, setAttentionError] = useState("");

  // ── Reconciliation ──
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(true);

  // ── Payout history (real server-side pagination/search/filter) ──
  const [payouts, setPayouts] = useState([]);
  const [payoutPagination, setPayoutPagination] = useState(null);
  const [payoutPage, setPayoutPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutsError, setPayoutsError] = useState("");
  const [highlightPayoutId, setHighlightPayoutId] = useState("");

  // ── Invoices (real, ownership-scoped, bounded — reuses the existing
  //     invoice engine rather than a second one) ──
  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState("");

  // Deep-link support for Smart Inbox's "View Earnings" action
  // (/doctor/earnings?payoutId=...) — STEP 18 of the DOC-02 brief. The
  // list is now server-paginated, so resolving this is the backend's job
  // (getDoctorPayouts); the frontend just requests it once on load.
  const [searchParams] = useSearchParams();
  const deepLinkedPayoutId = searchParams.get("payoutId") || "";
  const highlightedRef = useRef(null);
  const consumedDeepLinkRef = useRef(false);

  const loadEarnings = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await doctorApi.getEarnings();
      setEarnings(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadAttention = useCallback(async () => {
    setAttentionLoading(true);
    setAttentionError("");
    try {
      const response = await doctorApi.getFinancialAttention();
      setAttention(response.data);
    } catch (err) {
      setAttentionError(getApiErrorMessage(err));
    } finally {
      setAttentionLoading(false);
    }
  }, []);

  const loadReconciliation = useCallback(async () => {
    setReconciliationLoading(true);
    try {
      const response = await doctorApi.getReconciliation();
      setReconciliation(response.data);
    } catch {
      setReconciliation(null);
    } finally {
      setReconciliationLoading(false);
    }
  }, []);

  const loadPayouts = useCallback(async ({ page = 1, payoutId } = {}) => {
    setPayoutsLoading(true);
    setPayoutsError("");
    try {
      const params = payoutId
        ? { payoutId }
        : {
            page,
            pageSize: 10,
            ...(statusFilter !== "all" ? { status: statusFilter } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
          };
      const response = await doctorApi.getPayouts(params);
      setPayouts(response.data.payouts || []);
      setPayoutPagination(response.data.pagination || null);
      setPayoutPage(response.data.pagination?.page || 1);
      if (response.data.highlightPayoutId) {
        setHighlightPayoutId(response.data.highlightPayoutId);
        // A resolved deep link ignores whatever filters were active, same
        // as the old behavior of clearing search/status once found.
        setSearch("");
        setStatusFilter("all");
      }
    } catch (err) {
      setPayoutsError(getApiErrorMessage(err));
    } finally {
      setPayoutsLoading(false);
    }
  }, [statusFilter, search]);

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    setInvoicesError("");
    try {
      const response = await invoiceApi.getInvoices({ limit: 10, sortBy: "issuedAt", sortDir: "desc" });
      setInvoices(response.data?.invoices || []);
    } catch (err) {
      setInvoicesError(getApiErrorMessage(err));
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEarnings();
    loadAttention();
    loadReconciliation();
    loadInvoices();
  }, [dashboardSyncTick, loadEarnings, loadAttention, loadReconciliation, loadInvoices]);

  // Payout list: resolve the deep link exactly once on first load, then
  // fall back to normal paginated loading driven by page/search/status.
  useEffect(() => {
    if (deepLinkedPayoutId && !consumedDeepLinkRef.current) {
      consumedDeepLinkRef.current = true;
      loadPayouts({ payoutId: deepLinkedPayoutId });
      return;
    }
    if (!deepLinkedPayoutId || consumedDeepLinkRef.current) {
      loadPayouts({ page: payoutPage });
    }
  }, [payoutPage, statusFilter, search, dashboardSyncTick]);

  useEffect(() => {
    if (highlightPayoutId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightPayoutId, payouts]);

  const runRangeComparison = async () => {
    if (!rangeFrom || !rangeTo) return;
    setRangeLoading(true);
    setRangeError("");
    try {
      const response = await doctorApi.getFinancialPosition({ from: rangeFrom, to: rangeTo });
      setRangePosition(response.data);
    } catch (err) {
      setRangeError(getApiErrorMessage(err));
    } finally {
      setRangeLoading(false);
    }
  };

  const periodValue = {
    daily: earnings?.todayEarnings,
    weekly: earnings?.weeklyEarnings,
    monthly: earnings?.monthlyEarnings,
    quarterly: earnings?.quarterlyEarnings,
    yearly: earnings?.yearlyEarnings,
  }[period];

  const nonMismatchItems = useMemo(
    () => (attention?.items || []).filter((i) => i.type !== "reconciliation"),
    [attention],
  );

  if (isLoading) {
    return <Loader label="Loading earnings..." />;
  }

  // First-load failure: there's no prior data to fall back on, so show a
  // full takeover rather than a banner sitting above a grid of "₹0" cards
  // that would look like real zeroed earnings.
  if (error && !earnings) {
    return <ErrorState title="Couldn't load earnings" description={error} onRetry={loadEarnings} />;
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Financial Control Center</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">{t("doctor.earnings.heading") || "Earnings Dashboard"}</h1>
          <p className="mt-2 text-sm text-slate-500">
            What you earned, what was actually collected, what&apos;s pending, refunded, or already settled — sourced from
            your real payment and payout records.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled>Withdrawal Coming Soon</Button>
          <Button onClick={loadEarnings}>Refresh</Button>
        </div>
      </div>

      <BusinessIntelligenceNav overview={null} active="earnings" />

      {/* Refresh failed but we still have prior data to show — a non-blocking
          token-consistent banner rather than blanking the page. */}
      {error && earnings && (
        <div className="rounded-card border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      {/* PERIOD CONTROL */}
      <Card title="Period">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[
            ["daily", "Today"],
            ["weekly", "Week"],
            ["monthly", "Month"],
            ["quarterly", "Quarter"],
            ["yearly", "Year"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${period === key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowCustomRange((v) => !v)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${showCustomRange ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
          >
            Custom Range
          </button>
        </div>
        <p className="text-3xl font-black text-slate-950">{money(periodValue)}</p>

        {showCustomRange && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-bold text-slate-500">From</label>
                <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="mt-1 block rounded-xl border border-slate-200 p-2.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">To</label>
                <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="mt-1 block rounded-xl border border-slate-200 p-2.5 text-sm" />
              </div>
              <Button size="sm" onClick={runRangeComparison} disabled={!rangeFrom || !rangeTo || rangeLoading}>
                {rangeLoading ? "Comparing..." : "Compare vs. Previous Period"}
              </Button>
            </div>
            {rangeError && <p className="mt-3 text-sm font-semibold text-rose-600">{rangeError}</p>}
            {rangePosition && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["Earned", rangePosition.current.earned, rangePosition.change.earned],
                  ["Collected", rangePosition.current.collected, rangePosition.change.collected],
                  ["Settled", rangePosition.current.settled, rangePosition.change.settled],
                ].map(([label, value, change]) => (
                  <div key={label} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs font-bold text-slate-500">{label}</p>
                    <p className="text-lg font-black text-slate-900">{money(value)}</p>
                    <p className={`text-xs font-bold ${change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {change >= 0 ? "+" : ""}{change}% vs. previous equivalent period
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* FINANCIAL POSITION — precise, distinct semantics per rule #3/#5 */}
      <Card title="Financial Position">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={IndianRupee} tone="info" label="Earned" value={money(earnings?.totalEarnings)} caption="Attributed from completed appointments" />
          <MetricCard icon={CheckCircle2} tone="success" label="Collected" value={money(earnings?.collectedAmount)} caption="Actually captured from patients" />
          <MetricCard icon={Clock3} tone="warning" label="Pending" value={money(earnings?.pendingEarnings)} caption="Payout awaiting settlement" />
          <MetricCard icon={Receipt} tone="danger" label="Refunded" value={money(earnings?.totalRefunded)} caption="Refunded to patients" />
          <MetricCard icon={PiggyBank} tone="violet" label="Settled" value={money(earnings?.settledEarnings)} caption="Already paid out to you" />
        </div>
      </Card>

      {/* WITHDRAWAL — Section 22/27: a genuinely separate domain from
          DoctorPayout, self-contained (own data fetching) so it doesn't
          disturb this page's existing loading/error state machine. */}
      <DoctorWithdrawalPanel />

      {/* FINANCIAL ATTENTION */}
      <Card
        title="Financial Attention"
        action={attention && <Badge tone={nonMismatchItems.length ? "warning" : "success"}>{nonMismatchItems.length} item(s)</Badge>}
      >
        {attentionLoading ? (
          <Skeleton rows={2} />
        ) : attentionError ? (
          <ErrorState title="Couldn't load attention items" description={attentionError} onRetry={loadAttention} />
        ) : !nonMismatchItems.length ? (
          <EmptyState title="Nothing needs your attention" description="Your payments and refunds are all in a healthy state." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {nonMismatchItems.map((item) => (
              <AttentionItem key={`${item.type}-${item.recordId}`} item={item} />
            ))}
          </div>
        )}
      </Card>

      {/* REVENUE TREND — honestly labeled: this is settled payout
          attribution, not gross patient collection. */}
      {earnings?.monthlyTrend?.length > 0 && (
        <Card title="Doctor Payout Earnings — Monthly Trend (settled)">
          <MiniBarChart data={earnings.monthlyTrend} valueKey="amount" labelKey="label" formatValue={(v) => money(v)} />
        </Card>
      )}

      {/* PAYMENT / REFUND / PAYOUT BREAKDOWN */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <PiggyBank className="text-emerald-600" />
          <p className="mt-4 text-2xl font-black">{money(earnings?.upcomingPayout)}</p>
          <p className="text-sm font-bold text-slate-500">Upcoming Payout</p>
        </Card>
        <Card>
          <TrendingUp className="text-blue-600" />
          {earnings?.incomeForecast != null ? (
            <>
              <p className="mt-4 text-2xl font-black">{money(earnings.incomeForecast)}</p>
              <p className="text-sm font-bold text-slate-500">
                Projected next month (avg. of last {earnings.incomeForecastBasisMonths} settled months)
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-2xl font-black text-slate-400">—</p>
              <p className="text-sm font-bold text-slate-500">Not enough settlement history yet to project next month</p>
            </>
          )}
        </Card>
        <Card>
          <Receipt className="text-rose-600" />
          <p className="mt-4 text-2xl font-black">{money(earnings?.totalTax)}</p>
          <p className="text-sm font-bold text-slate-500">Tax collected on payments</p>
        </Card>
        <Card>
          <Receipt className="text-orange-500" />
          <p className="mt-4 text-2xl font-black">{money(earnings?.platformFees)}</p>
          <p className="text-sm font-bold text-slate-500">Platform fees attributed</p>
        </Card>
      </div>

      {/* RECONCILIATION — Healthy / Needs Review, doctor-scoped, reuses the
          same mismatch detection as Financial Attention (never a second
          reconciliation engine). */}
      <Card title="Reconciliation">
        {reconciliationLoading ? (
          <Skeleton rows={1} />
        ) : !reconciliation ? (
          <p className="text-sm font-semibold text-slate-400">Reconciliation status is currently unavailable.</p>
        ) : reconciliation.healthy ? (
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-emerald-100 text-emerald-600">
              <ShieldCheck size={20} />
            </span>
            <p className="font-black text-slate-950">Healthy — every financial record checks out.</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-control bg-amber-100 text-amber-600">
                <AlertTriangle size={20} />
              </span>
              <p className="font-black text-slate-950">
                {reconciliation.issueCount} financial record{reconciliation.issueCount === 1 ? "" : "s"} need review
              </p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {reconciliation.issues.map((item) => (
                <AttentionItem key={`recon-${item.recordId}`} item={item} />
              ))}
            </div>
          </div>
        )}
      </Card>

      <AIDraftPanel
        title="AI Revenue Insights"
        actionLabel="Generate Revenue Insights"
        onGenerate={() => aiAssistApi.getRevenueInsights()}
        compact
      />

      {/* PAYOUT HISTORY — real server-side pagination/search/filter (the
          reported scale bug fix). */}
      <Card title="Search & Filter">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPayoutPage(1); }}
              placeholder="Search appointment or payout id..."
              className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-4"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPayoutPage(1); }}
            className="rounded-xl border border-slate-200 p-3"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </Card>

      <Card title={t("doctor.earnings.payout") || "Payout History"}>
        {payoutsLoading ? (
          <Skeleton rows={4} />
        ) : payoutsError ? (
          <ErrorState title="Couldn't load payouts" description={payoutsError} onRetry={() => loadPayouts({ page: payoutPage })} />
        ) : !payouts.length ? (
          <EmptyState title="No earnings yet" description={t("doctor.earnings.completed") || "Your completed appointment payouts will appear here."} />
        ) : (
          <>
            <div className="space-y-3">
              {payouts.map((payout) => (
                <div
                  key={payout._id}
                  ref={payout._id === highlightPayoutId ? highlightedRef : null}
                  className={`rounded-2xl border p-4 transition ${payout._id === highlightPayoutId ? "border-blue-300 bg-blue-50/60 ring-2 ring-blue-300" : "border-slate-200"}`}
                >
                  <div className="grid gap-4 lg:grid-cols-6 lg:items-center">
                    <div>
                      <p className="font-black">Appointment</p>
                      <p className="text-xs text-slate-500 break-all">{payout.appointmentId?._id || payout.appointmentId}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Gross</p>
                      <p className="font-black">{money(payout.grossAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Platform Fee</p>
                      <p className="font-black text-red-600">{money(payout.platformFee)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Your Share</p>
                      <p className="font-black text-emerald-600">{money(payout.doctorAmount)}</p>
                    </div>
                    <div>
                      <Badge tone={PAYOUT_STATUS_TONE[payout.status] || "neutral"} className="capitalize">{payout.status}</Badge>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">{formatDate(payout.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {payoutPagination && payoutPagination.totalPages > 1 && (
              <div className="mt-5 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">
                  Page {payoutPagination.page} of {payoutPagination.totalPages} · {payoutPagination.total} payouts
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!payoutPagination.hasPrevious}
                    onClick={() => setPayoutPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={14} /> Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!payoutPagination.hasNext}
                    onClick={() => setPayoutPage((p) => p + 1)}
                  >
                    Next <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* INVOICES — reuses the existing, real invoice engine (bounded,
          ownership-scoped to this doctor's own doctorId), not a second one. */}
      <Card title="Invoices">
        {invoicesLoading ? (
          <Skeleton rows={2} />
        ) : invoicesError ? (
          <ErrorState title="Couldn't load invoices" description={invoicesError} onRetry={loadInvoices} />
        ) : !invoices.length ? (
          <EmptyState title="No invoices yet" description="Invoices generated for your consultations will appear here." />
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <div key={invoice._id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="text-sm font-black text-slate-900">{invoice.invoiceNumber || invoice._id}</p>
                  <p className="text-xs text-slate-500">{formatDate(invoice.issuedAt || invoice.createdAt)}</p>
                </div>
                <p className="font-black text-slate-950">{money(invoice.totalAmount)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <Wallet className="text-blue-600" />
          <div>
            <p className="font-black text-slate-950">Withdrawal System</p>
            <p className="text-sm text-slate-500">
              Bank transfer, UPI payout, and withdrawal requests will be available in the next update — the settlement
              timeline and payout history above already reflect your real, current data.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default DoctorEarnings;
