import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Eye,
  IndianRupee,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import FilterBar from "../../components/admin/FilterBar";
import PaymentDetailWorkspace from "../../components/admin/PaymentDetailWorkspace";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { paymentTxStatusLabel, paymentTxStatusTone } from "../../utils/paymentTransactionStatusDisplay";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0,
  );

function AdminPayments() {
  const toast = useToast();
  const navigate = useNavigate();
  const { dashboardSyncTick } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "",
    refundStatus: searchParams.get("refundStatus") || "",
    attention: searchParams.get("attention") || "",
  });

  const [payments, setPayments] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailId, setDetailId] = useState(null);

  const query = useMemo(
    () => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)),
    [searchParams],
  );

  const loadPayments = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await adminApi.getPaymentsAdmin({ ...query, limit: 100 });
      setPayments(response.data.payments || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const response = await adminApi.getPaymentSummaryAdmin();
      setSummary(response.data || null);
    } catch (error) {
      // Non-critical: KPI strip simply doesn't render if this fails, rather
      // than showing a fabricated number. Still surface it once so a
      // permission-denied admin understands why the strip is empty.
      if (!summary) toast.error(getApiErrorMessage(error) || "Payment summary is unavailable.");
    }
  };

  useEffect(() => {
    loadPayments();
  }, [searchParams, dashboardSyncTick]);

  useEffect(() => {
    loadSummary();
  }, [dashboardSyncTick]);

  const applyFilters = () => {
    setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  };

  const setMetricFilter = (patch) => {
    const next = { search: "", status: "", refundStatus: "", attention: "", ...patch };
    setFilters(next);
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
  };

  const handleWorkspaceChanged = () => {
    loadPayments();
    loadSummary();
  };

  const columns = [
    {
      key: "patient",
      header: "Patient",
      render: (row) => (
        <div>
          <p className="font-bold text-slate-950">{row.userId?.name || "Unknown"}</p>
          <p className="text-xs text-slate-500">{row.userId?.email}</p>
        </div>
      ),
    },
    {
      key: "doctor",
      header: "Doctor",
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-800">
            {row.doctorId?.userId?.name ? `Dr. ${row.doctorId.userId.name}` : "—"}
          </p>
          <p className="text-xs text-slate-500">{row.doctorId?.specialization}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => <span className="font-bold text-slate-950">{formatCurrency(row.totalAmount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col gap-1.5">
          <StatusBadge tone={paymentTxStatusTone(row.status)}>{paymentTxStatusLabel(row.status)}</StatusBadge>
          {row.needsAttention && (
            <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
              <AlertTriangle size={12} /> Needs attention
            </span>
          )}
        </div>
      ),
    },
    {
      key: "refund",
      header: "Refund",
      render: (row) =>
        row.refundStatus && row.refundStatus !== "none" ? (
          <StatusBadge tone="info">
            {row.refundStatus} · {formatCurrency(row.refundedAmount)}
          </StatusBadge>
        ) : (
          <span className="text-xs text-slate-400">None</span>
        ),
    },
    {
      key: "date",
      header: "Date",
      render: (row) => <span className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleString()}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => setDetailId(row._id)}>
          <Eye size={14} /> View
        </Button>
      ),
    },
  ];

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const isRestricted = loadError && /permission/i.test(loadError);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Payments Management"
        title="Payments Management Workspace"
        description="The real financial/payment state of the platform — what's collected, pending, failed, or refunded, and what needs attention."
      />

      {isRestricted ? (
        <ErrorState
          title="Financial data restricted"
          description="Your admin account does not have permission to view payments. Contact a super admin to request manage_payments access."
        />
      ) : (
        <>
          {summary && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <button type="button" className="text-left" onClick={() => setMetricFilter({})}>
                <MetricCard label="Total Payments" value={summary.totalPayments} caption="All-time · live" />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "captured" })}>
                <MetricCard
                  label="Gross Collected"
                  value={formatCurrency(summary.grossCollected)}
                  tone="success"
                  icon={IndianRupee}
                  caption={`${summary.capturedPayments} captured`}
                />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "created,pending" })}>
                <MetricCard
                  label="Pending Amount"
                  value={formatCurrency(summary.pendingAmount)}
                  caption={`${summary.pendingPayments} payments`}
                />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "failed" })}>
                <MetricCard
                  label="Failed Amount"
                  value={formatCurrency(summary.failedAmount)}
                  tone={summary.failedPayments > 0 ? "danger" : "neutral"}
                  caption={`${summary.failedPayments} failed`}
                  icon={XCircle}
                />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "refunded,partially_refunded" })}>
                <MetricCard
                  label="Refunded Amount"
                  value={formatCurrency(summary.refundedAmount)}
                  caption={`${summary.refundedPayments + summary.partiallyRefundedPayments} payments`}
                  icon={RotateCcw}
                />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({})}>
                <MetricCard
                  label="Today's Collection"
                  value={formatCurrency(summary.todaysCollection)}
                  caption={`${summary.todaysPayments} payments today`}
                  icon={CalendarDays}
                />
              </button>
              {summary.refundsRequiringReview > 0 && (
                <MetricCard
                  label="Refunds Awaiting Review"
                  value={summary.refundsRequiringReview}
                  tone="danger"
                  caption={`${formatCurrency(summary.refundsRequiringReviewAmount)} at stake — see Refund Operations`}
                />
              )}
              {summary.needsAttentionCount > 0 && (
                <button type="button" className="text-left" onClick={() => setMetricFilter({ attention: "true" })}>
                  <MetricCard
                    label="Payments Requiring Attention"
                    value={summary.needsAttentionCount}
                    tone="danger"
                    icon={AlertTriangle}
                  />
                </button>
              )}
              {summary.deadLetterPayments > 0 && (
                <MetricCard
                  label="Retry Exhausted (Dead-letter)"
                  value={summary.deadLetterPayments}
                  tone="danger"
                  caption="Open a failed payment to mark reviewed"
                />
              )}
            </div>
          )}

          <FilterBar
            filters={filters}
            onChange={(event) => setFilters((current) => ({ ...current, [event.target.name]: event.target.value }))}
            onApply={applyFilters}
          >
            <Select
              name="status"
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">All statuses</option>
              <option value="created">Order Created</option>
              <option value="pending">Pending</option>
              <option value="captured">Captured</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
              <option value="partially_refunded">Partially Refunded</option>
            </Select>
            <Select
              name="refundStatus"
              value={filters.refundStatus}
              onChange={(event) => setFilters((current) => ({ ...current, refundStatus: event.target.value }))}
            >
              <option value="">Any refund state</option>
              <option value="none">No refund</option>
              <option value="pending">Refund pending</option>
              <option value="partial">Partially refunded</option>
              <option value="full">Fully refunded</option>
              <option value="failed">Refund failed</option>
            </Select>
            <Select
              name="attention"
              value={filters.attention}
              onChange={(event) => setFilters((current) => ({ ...current, attention: event.target.value }))}
            >
              <option value="">All payments</option>
              <option value="true">Needs attention only</option>
            </Select>
          </FilterBar>

          {loadError ? (
            <ErrorState description={loadError} onRetry={loadPayments} />
          ) : (
            <Card>
              <AdminTable
                columns={columns}
                data={payments}
                isLoading={isLoading}
                emptyTitle="No payments found"
                emptyDescription={
                  activeFilterCount > 0
                    ? "No payments match these filters. Try clearing them."
                    : "No payments have been made on the platform yet."
                }
              />
            </Card>
          )}

          {pagination && pagination.total > pagination.limit && (
            <p className="text-center text-xs font-semibold text-slate-500">
              Showing {payments.length} of {pagination.total} payments. Narrow with search or filters to see more.
            </p>
          )}
        </>
      )}

      <AdminModal isOpen={Boolean(detailId)} title="Payment Workspace" onClose={() => setDetailId(null)} size="xl">
        {detailId && (
          <PaymentDetailWorkspace
            paymentId={detailId}
            onChanged={handleWorkspaceChanged}
            onViewPatient={(patientId) => navigate(`/admin/patients?search=${encodeURIComponent(patientId)}`)}
            onViewAppointment={(_appointmentId, patientId) =>
              navigate(patientId ? `/admin/appointments?patientId=${patientId}` : "/admin/appointments")
            }
            onViewDoctor={() => navigate("/admin/doctors")}
          />
        )}
      </AdminModal>
    </div>
  );
}

export default AdminPayments;
