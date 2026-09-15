import { AlertTriangle, Clock3, Eye, IndianRupee, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import FilterBar from "../../components/admin/FilterBar";
import RefundDetailWorkspace from "../../components/admin/RefundDetailWorkspace";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { refundRequestStatusLabel, refundRequestStatusTone } from "../../utils/paymentTransactionStatusDisplay";

const formatCurrency = (amount, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(
    amount || 0,
  );

function AdminRefunds() {
  const toast = useToast();
  const navigate = useNavigate();
  const { dashboardSyncTick } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "",
    attention: searchParams.get("attention") || "",
  });

  const [refunds, setRefunds] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailId, setDetailId] = useState(null);

  const query = useMemo(
    () => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)),
    [searchParams],
  );

  const loadRefunds = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await adminApi.getRefundsAdmin({ ...query, limit: 50 });
      setRefunds(response.data.refundRequests || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const response = await adminApi.getRefundSummaryAdmin();
      setSummary(response.data || null);
    } catch (error) {
      // Non-critical: the KPI strip simply doesn't render if this fails,
      // rather than showing a fabricated number.
      if (!summary) toast.error(getApiErrorMessage(error) || "Refund summary is unavailable.");
    }
  };

  useEffect(() => {
    loadRefunds();
  }, [searchParams, dashboardSyncTick]);

  useEffect(() => {
    loadSummary();
  }, [dashboardSyncTick]);

  const applyFilters = () => {
    setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  };

  const setMetricFilter = (patch) => {
    const next = { search: "", status: "", attention: "", ...patch };
    setFilters(next);
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
  };

  const handleWorkspaceChanged = () => {
    loadRefunds();
    loadSummary();
  };

  const columns = [
    {
      key: "patient",
      header: "Patient",
      render: (row) => (
        <div>
          <p className="font-bold text-slate-950">{row.requestedBy?.name || "Unknown"}</p>
          <p className="text-xs text-slate-500">{row.requestedBy?.email}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => (
        <span className="font-bold text-slate-950">{formatCurrency(row.amount, row.paymentId?.currency)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col gap-1.5">
          <StatusBadge tone={refundRequestStatusTone(row.status)}>{refundRequestStatusLabel(row.status)}</StatusBadge>
          {row.needsAttention && (
            <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
              <AlertTriangle size={12} /> Needs attention
            </span>
          )}
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => <span className="max-w-xs truncate text-sm text-slate-600">{row.reason}</span>,
    },
    {
      key: "date",
      header: "Requested",
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
        eyebrow="Refunds Management"
        title="Refund Operations Workspace"
        description="Every refund request end-to-end — approval, gateway processing, failures, and what needs attention. Refund amounts and gateway state are always the payment's real, authoritative values, never trusted from the UI."
      />

      {isRestricted ? (
        <ErrorState
          title="Financial data restricted"
          description="Your admin account does not have permission to view refunds. Contact a super admin to request manage_payments access."
        />
      ) : (
        <>
          {summary && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <button type="button" className="text-left" onClick={() => setMetricFilter({})}>
                <MetricCard label="Total Requests" value={summary.totalRequests} caption="All-time · live" />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "pending" })}>
                <MetricCard
                  label="Pending Approval"
                  value={summary.pendingApproval}
                  tone={summary.pendingApproval > 0 ? "warning" : "neutral"}
                  icon={Clock3}
                  caption={formatCurrency(summary.pendingApprovalAmount)}
                />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "processed" })}>
                <MetricCard
                  label="Total Refunded"
                  value={formatCurrency(summary.totalRefundedAmount)}
                  tone="success"
                  icon={IndianRupee}
                  caption={`${summary.completed} completed`}
                />
              </button>
              <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "failed" })}>
                <MetricCard
                  label="Failed"
                  value={summary.failed}
                  tone={summary.failed > 0 ? "danger" : "neutral"}
                  icon={XCircle}
                  caption={formatCurrency(summary.failedAmount)}
                />
              </button>
              <MetricCard
                label="Amount Awaiting Processing"
                value={formatCurrency(summary.amountAwaitingProcessing)}
                icon={RotateCcw}
                caption="Pending + approved"
              />
              {summary.needsAttentionCount > 0 && (
                <button type="button" className="text-left" onClick={() => setMetricFilter({ attention: "true" })}>
                  <MetricCard
                    label="Refunds Requiring Attention"
                    value={summary.needsAttentionCount}
                    tone="danger"
                    icon={AlertTriangle}
                  />
                </button>
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
              <option value="pending">Pending Approval</option>
              <option value="approved">Approved · Processing</option>
              <option value="processed">Processed</option>
              <option value="rejected">Rejected</option>
              <option value="failed">Failed</option>
            </Select>
            <Select
              name="attention"
              value={filters.attention}
              onChange={(event) => setFilters((current) => ({ ...current, attention: event.target.value }))}
            >
              <option value="">All refunds</option>
              <option value="true">Needs attention only</option>
            </Select>
          </FilterBar>

          {loadError ? (
            <ErrorState description={loadError} onRetry={loadRefunds} />
          ) : (
            <Card>
              <AdminTable
                columns={columns}
                data={refunds}
                isLoading={isLoading}
                emptyTitle="No refund requests found"
                emptyDescription={
                  activeFilterCount > 0
                    ? "No refunds match these filters. Try clearing them."
                    : "No refunds have been requested on the platform yet."
                }
              />
            </Card>
          )}

          {pagination && pagination.total > pagination.limit && (
            <p className="text-center text-xs font-semibold text-slate-500">
              Showing {refunds.length} of {pagination.total} refund requests. Narrow with search or filters to see
              more.
            </p>
          )}
        </>
      )}

      <AdminModal isOpen={Boolean(detailId)} title="Refund Workspace" onClose={() => setDetailId(null)} size="xl">
        {detailId && (
          <RefundDetailWorkspace
            refundRequestId={detailId}
            onChanged={handleWorkspaceChanged}
            onViewPayment={(paymentId) => navigate(`/admin/payments?search=${encodeURIComponent(paymentId)}`)}
            onViewPatient={(patientId) => navigate(`/admin/patients?search=${encodeURIComponent(patientId)}`)}
            onViewAppointment={(_appointmentId, patientId) =>
              navigate(patientId ? `/admin/appointments?patientId=${patientId}` : "/admin/appointments")
            }
          />
        )}
      </AdminModal>
    </div>
  );
}

export default AdminRefunds;
