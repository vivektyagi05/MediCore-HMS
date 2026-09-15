import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  ExternalLink,
  FileText,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  Wallet as WalletIcon,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import RefundActionModal from "../../components/finance/RefundActionModal";
import { MiniBarChart, MiniDonut } from "../../components/finance/FinanceCharts";
import { paymentApi } from "../../api/paymentApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "captured", label: "Completed" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "partially_refunded", label: "Partially refunded" },
  { value: "refunded", label: "Refunded" },
];

const STATUS_STYLES = {
  captured: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  refunded: "bg-blue-100 text-blue-700",
  partially_refunded: "bg-violet-100 text-violet-700",
  created: "bg-slate-100 text-slate-600",
};

const formatMoney = (value, currency = "INR") =>
  `${currency === "INR" ? "\u20b9" : currency + " "}${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function StatCard({ icon: Icon, label, value, tone = "text-blue-600" }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950/5 ${tone}`}>
        <Icon size={18} />
      </div>
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function PaymentCard({ payment, onOpenRefundCenter }) {
  const [showExplain, setShowExplain] = useState(false);
  const doctorName = payment.doctorId?.userId?.name;
  const specialization = payment.doctorId?.specialization;
  // P23 Section 10 fix: this button no longer decides "Request refund" vs
  // "Report a problem" itself (that was the real Case A/Case B bug — a
  // completed consultation showed the same instant-refund CTA as an
  // eligible cancellation). It only decides whether a refund conversation
  // is even relevant for this payment; the backend's eligibility read
  // (fetched inside RefundActionModal) decides which case applies.
  const canShowRefundAction = ["captured", "partially_refunded"].includes(payment.status);
  const canRetry = payment.status === "failed" && payment.appointmentId?._id;

  return (
    <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-black text-slate-950">
            {doctorName ? `Dr. ${doctorName}` : "Consultation payment"}
          </p>
          <p className="text-xs font-semibold text-slate-500">{specialization || "General"} · {formatDate(payment.createdAt)}</p>
        </div>
        <span className={`rounded-xl px-3 py-1.5 text-xs font-black capitalize ${STATUS_STYLES[payment.status] || "bg-slate-100 text-slate-600"}`}>
          {payment.status?.replace(/_/g, " ")}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span className="rounded-lg bg-slate-950/5 px-2.5 py-1">{formatMoney(payment.totalAmount, payment.currency)} total</span>
        {payment.walletAmount > 0 && (
          <span className="rounded-lg bg-blue-600/10 px-2.5 py-1 text-blue-700">
            {formatMoney(payment.walletAmount, payment.currency)} via wallet
          </span>
        )}
        {payment.gatewayAmount > 0 && (
          <span className="rounded-lg bg-slate-950/5 px-2.5 py-1">
            {formatMoney(payment.gatewayAmount, payment.currency)} via gateway
          </span>
        )}
        {payment.discountAmount > 0 && (
          <span className="rounded-lg bg-emerald-600/10 px-2.5 py-1 text-emerald-700">
            {formatMoney(payment.discountAmount, payment.currency)} discount
          </span>
        )}
        {payment.taxAmount > 0 && (
          <span className="rounded-lg bg-slate-950/5 px-2.5 py-1">{formatMoney(payment.taxAmount, payment.currency)} tax</span>
        )}
        {payment.refundedAmount > 0 && (
          <span className="rounded-lg bg-violet-600/10 px-2.5 py-1 text-violet-700">
            {formatMoney(payment.refundedAmount, payment.currency)} refunded
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {payment.invoiceId?._id && (
          <Button variant="secondary" to={`/invoices/${payment.invoiceId._id}`}>
            <FileText size={14} /> View invoice
          </Button>
        )}
        <Button variant="secondary" to="/patient/appointments">
          <ExternalLink size={14} /> View appointment
        </Button>
        {canRetry && (
          <Button variant="secondary" to={`/patient/payments/${payment.appointmentId._id}`}>
            <RotateCcw size={14} /> Retry payment
          </Button>
        )}
        {canShowRefundAction && (
          <Button variant="secondary" onClick={() => onOpenRefundCenter(payment)}>
            <RefreshCcw size={14} /> Refund / Report a problem
          </Button>
        )}
        <Button variant="secondary" onClick={() => setShowExplain((v) => !v)}>
          <Sparkles size={14} /> AI explain
        </Button>
      </div>

      {showExplain && (
        <div className="mt-4">
          <AIDraftPanel
            compact
            title="AI payment explanation"
            actionLabel="Explain this payment"
            onGenerate={() => aiAssistApi.explainPayment(payment._id)}
          />
        </div>
      )}
    </div>
  );
}

function PatientPayments() {
  const [payments, setPayments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [analytics, setAnalytics] = useState(null);
  const [isLoadingPayments, setIsLoadingPayments] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(true);
  const [status, setStatus] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [refundTarget, setRefundTarget] = useState(null);
  const toast = useToast();

  const debouncedSearch = useDebouncedValue(searchTerm);

  const loadPayments = useCallback(async () => {
    setIsLoadingPayments(true);
    try {
      const params = { page, limit: 8 };
      if (status) params.status = status;
      if (debouncedSearch) params.search = debouncedSearch;
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await paymentApi.getPayments(params);
      setPayments(res.data.payments || []);
      setPagination(res.data.pagination || { page: 1, pages: 1, total: 0 });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoadingPayments(false);
    }
  }, [page, status, debouncedSearch, from, to]);

  const loadAnalytics = useCallback(async () => {
    setIsLoadingAnalytics(true);
    try {
      const res = await paymentApi.getAnalytics();
      setAnalytics(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoadingAnalytics(false);
    }
  }, []);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch, from, to]);

  const specialtySegments = useMemo(() => {
    const palette = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626"];
    return (analytics?.specialtyWiseSpending || []).slice(0, 5).map((entry, i) => ({
      label: entry.specialization,
      value: entry.totalAmount,
      color: palette[i % palette.length],
    }));
  }, [analytics]);

  const handleRefundSubmitted = () => {
    setRefundTarget(null);
    loadPayments();
    loadAnalytics();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black text-slate-950">Payment Center</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          Every consultation payment, refund, and receipt — in one place.
        </p>
      </div>

      <AIDraftPanel
        title="AI expense summary"
        actionLabel="Summarize my spending"
        onGenerate={() => aiAssistApi.getExpenseSummary()}
      />

      {isLoadingAnalytics ? (
        <Loader label="Loading payment analytics" />
      ) : (
        analytics && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={WalletIcon}
                label="Total spent"
                value={formatMoney(analytics.expenseSummary?.allTimeTotal)}
              />
              <StatCard
                icon={FileText}
                label="Tax paid (this year)"
                value={formatMoney(analytics.taxSummary?.totalTax)}
                tone="text-emerald-600"
              />
              <StatCard
                icon={CalendarClock}
                label="Upcoming dues"
                value={analytics.upcomingDues?.length || 0}
                tone="text-amber-600"
              />
              <StatCard
                icon={RefreshCcw}
                label="Refunded to you"
                value={formatMoney(analytics.expenseSummary?.totalRefunded)}
                tone="text-violet-600"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
                <p className="mb-4 text-sm font-black text-slate-950">Monthly spending</p>
                <MiniBarChart data={analytics.monthlySpending} formatValue={(v) => formatMoney(v)} />
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
                <p className="mb-4 text-sm font-black text-slate-950">Spending by specialty</p>
                <MiniDonut segments={specialtySegments} />
              </div>
            </div>

            {analytics.upcomingDues?.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-black text-amber-800">
                  <AlertCircle size={16} /> Upcoming dues
                </p>
                <div className="space-y-2">
                  {analytics.upcomingDues.map((due) => (
                    <div key={due.appointmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 p-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          Dr. {due.doctorName || "your doctor"} · {formatDate(due.date)}
                        </p>
                        <p className="text-xs font-semibold text-slate-500">{due.specialization}</p>
                      </div>
                      <Button to={`/patient/payments/${due.appointmentId}`}>Pay now</Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      )}

      <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Status</span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <Input
            label="Search doctor / specialty"
            placeholder="e.g. cardiology"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {isLoadingPayments ? (
        <Loader label="Loading payments" />
      ) : payments.length === 0 ? (
        <EmptyState
          title="No payments found"
          description="Once you complete a consultation payment, it will show up here with full breakdowns, receipts, and refund options."
        />
      ) : (
        <>
          <div className="space-y-4">
            {payments.map((payment) => (
              <PaymentCard key={payment._id} payment={payment} onOpenRefundCenter={setRefundTarget} />
            ))}
          </div>

          {pagination.pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm font-bold text-slate-600">
                Page {pagination.page} of {pagination.pages}
              </span>
              <Button
                variant="secondary"
                disabled={pagination.page >= pagination.pages}
                onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      <RefundActionModal payment={refundTarget} onClose={() => setRefundTarget(null)} onSubmitted={handleRefundSubmitted} />
    </div>
  );
}

export default PatientPayments;
