import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Eye,
  IndianRupee,
  ListChecks,
  RotateCcw,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import AppointmentCancelDialog from "../../components/admin/AppointmentCancelDialog";
import AppointmentDetailWorkspace from "../../components/admin/AppointmentDetailWorkspace";
import FilterBar from "../../components/admin/FilterBar";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  consultationModeLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "../../utils/appointmentStatusDisplay";

function AdminAppointments() {
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "",
    paymentStatus: searchParams.get("paymentStatus") || "",
    consultationMode: searchParams.get("consultationMode") || "",
    quickDate: searchParams.get("quickDate") || "",
    attention: searchParams.get("attention") || "",
  });

  const [appointments, setAppointments] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [detailId, setDetailId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const query = useMemo(
    () => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)),
    [searchParams],
  );

  const loadAppointments = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await adminApi.getAppointmentsAdmin({ ...query, limit: 100 });
      setAppointments(response.data.appointments || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const response = await adminApi.getAppointmentSummaryAdmin();
      setSummary(response.data || null);
    } catch {
      // Non-critical: dashboard metrics simply don't render if this fails,
      // rather than showing a fabricated number.
    }
  };

  useEffect(() => {
    loadAppointments();
  }, [searchParams, dashboardSyncTick]);

  useEffect(() => {
    loadSummary();
  }, [dashboardSyncTick]);

  const applyFilters = () => {
    setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  };

  const setMetricFilter = (patch) => {
    const next = { search: "", status: "", paymentStatus: "", consultationMode: "", quickDate: "", attention: "", ...patch };
    setFilters(next);
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
  };

  const handleApprove = async (appointment) => {
    setApprovingId(appointment._id);
    try {
      await appointmentApi.updateAppointmentStatus(appointment._id, { status: "approved" });
      toast.success("Appointment approved");
      await Promise.all([loadAppointments(), loadSummary()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Appointment approval failed.");
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectDone = async () => {
    setRejectTarget(null);
    await Promise.all([loadAppointments(), loadSummary()]);
  };

  const columns = [
    {
      key: "patient",
      header: "Patient",
      render: (row) => (
        <div>
          <p className="font-bold text-slate-950">{row.patientId?.name || "Unknown patient"}</p>
          {row.familyMemberId && <p className="text-xs text-slate-500">for {row.familyMemberId.name}</p>}
        </div>
      ),
    },
    {
      key: "doctor",
      header: "Doctor",
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-800">Dr. {row.doctorId?.userId?.name || "Unassigned"}</p>
          <p className="text-xs text-slate-500">{row.doctorId?.specialization}</p>
        </div>
      ),
    },
    {
      key: "when",
      header: "Date & Time",
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-800">{new Date(row.date).toLocaleDateString()}</p>
          <p className="text-xs text-slate-500">
            {row.timeSlot} · {consultationModeLabel(row.consultationMode)}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col gap-1.5">
          <StatusBadge tone={appointmentStatusTone(row.status)}>{appointmentStatusLabel(row.status)}</StatusBadge>
          {row.needsAttention && (
            <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
              <AlertTriangle size={12} /> Needs attention
            </span>
          )}
        </div>
      ),
    },
    {
      key: "payment",
      header: "Payment",
      render: (row) =>
        row.financialRestricted ? (
          <span className="text-xs font-semibold text-slate-400">Restricted</span>
        ) : (
          <StatusBadge tone={paymentStatusTone(row.paymentStatus)}>{paymentStatusLabel(row.paymentStatus)}</StatusBadge>
        ),
    },
    {
      key: "clinical",
      header: "Clinical",
      render: (row) => (
        <div className="text-xs text-slate-600">
          {row.hasPrescription ? (
            <p className="font-semibold text-emerald-600">Prescription filed</p>
          ) : (
            <p className="text-slate-400">No prescription</p>
          )}
          {row.followUpDate && <p>Follow-up {new Date(row.followUpDate).toLocaleDateString()}</p>}
        </div>
      ),
    },
    {
      key: "updated",
      header: "Last Updated",
      render: (row) => <span className="text-xs text-slate-500">{new Date(row.updatedAt).toLocaleString()}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDetailId(row._id)}>
            <Eye size={14} /> View
          </Button>
          {row.status === "pending" && (
            <>
              <Button
                variant="success"
                size="sm"
                isLoading={approvingId === row._id}
                onClick={() => handleApprove(row)}
              >
                <CheckCircle2 size={14} /> Approve
              </Button>
              <Button variant="danger" size="sm" disabled={approvingId === row._id} onClick={() => setRejectTarget(row)}>
                <XCircle size={14} /> Reject
              </Button>
            </>
          )}
          {row.status !== "pending" && ["approved", "payment_pending", "payment_completed"].includes(row.status) && (
            <Button variant="danger" size="sm" onClick={() => setRejectTarget(row)}>
              <XCircle size={14} /> Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Appointment Operations"
        title="Appointment Operations Workspace"
        description="A single operational queue for every appointment — patient, doctor, payment, and clinical state, in one place."
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <button type="button" className="text-left" onClick={() => setMetricFilter({ quickDate: "today" })}>
            <MetricCard label="Today" value={summary.today} icon={CalendarDays} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ quickDate: "upcoming" })}>
            <MetricCard label="Upcoming" value={summary.upcoming} icon={CalendarClock} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "pending" })}>
            <MetricCard label="Pending Approval" value={summary.pending} tone={summary.pending > 0 ? "danger" : "neutral"} icon={Clock} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ attention: "true" })}>
            <MetricCard
              label="Needs Attention"
              value={summary.needsAttention}
              tone={summary.needsAttention > 0 ? "danger" : "neutral"}
              icon={AlertTriangle}
            />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "approved" })}>
            <MetricCard label="Approved" value={summary.approved} icon={Users} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ paymentStatus: "pending" })}>
            <MetricCard label="Payment Pending" value={summary.paymentPending} icon={IndianRupee} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "completed" })}>
            <MetricCard label="Completed" value={summary.completed} tone="success" icon={ListChecks} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "cancelled" })}>
            <MetricCard label="Cancelled" value={summary.cancelled} icon={XCircle} />
          </button>
          {summary.refundPending > 0 && (
            <MetricCard label="Refund Pending" value={summary.refundPending} tone="danger" icon={RotateCcw} caption="Review in Refunds" />
          )}
          {summary.paymentFailed > 0 && (
            <MetricCard label="Payment Failed" value={summary.paymentFailed} tone="danger" icon={AlertTriangle} />
          )}
          {summary.canViewFinance && summary.revenue != null && (
            <MetricCard label="Revenue Collected" value={`₹${summary.revenue.toLocaleString("en-IN")}`} caption="Live · captured payments" icon={IndianRupee} />
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
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="payment_pending">Payment Pending</option>
          <option value="payment_completed">Payment Completed</option>
          <option value="consultation_started">Consultation In Progress</option>
          <option value="consultation_completed">Consultation Completed</option>
          <option value="completed">Completed</option>
          <option value="review_eligible">Review Eligible</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select
          name="paymentStatus"
          value={filters.paymentStatus}
          onChange={(event) => setFilters((current) => ({ ...current, paymentStatus: event.target.value }))}
        >
          <option value="">All payment states</option>
          <option value="pending">Payment Pending</option>
          <option value="paid">Paid</option>
          <option value="failed">Payment Failed</option>
          <option value="refunded">Refunded</option>
        </Select>
        <Select
          name="consultationMode"
          value={filters.consultationMode}
          onChange={(event) => setFilters((current) => ({ ...current, consultationMode: event.target.value }))}
        >
          <option value="">All modes</option>
          <option value="in_person">In Person</option>
          <option value="online">Online</option>
        </Select>
        <Select
          name="quickDate"
          value={filters.quickDate}
          onChange={(event) => setFilters((current) => ({ ...current, quickDate: event.target.value }))}
        >
          <option value="">Any date</option>
          <option value="today">Today</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </Select>
      </FilterBar>

      {loadError ? (
        <ErrorState description={loadError} onRetry={loadAppointments} />
      ) : (
        <Card>
          <AdminTable
            columns={columns}
            data={appointments}
            isLoading={isLoading}
            emptyTitle="No appointments found"
            emptyDescription={
              activeFilterCount > 0
                ? "No appointments match these filters. Try clearing them."
                : "No appointments have been booked yet."
            }
          />
        </Card>
      )}

      {pagination && pagination.total > pagination.limit && (
        <p className="text-center text-xs font-semibold text-slate-500">
          Showing {appointments.length} of {pagination.total} appointments. Narrow with search or filters to see more.
        </p>
      )}

      <AdminModal isOpen={Boolean(detailId)} title="Appointment Workspace" onClose={() => setDetailId(null)} size="xl">
        {detailId && (
          <AppointmentDetailWorkspace
            appointmentId={detailId}
            onChanged={() => {
              loadAppointments();
              loadSummary();
            }}
          />
        )}
      </AdminModal>

      <AppointmentCancelDialog
        appointment={rejectTarget}
        mode={rejectTarget?.status === "pending" ? "reject" : "cancel"}
        onClose={() => setRejectTarget(null)}
        onDone={handleRejectDone}
      />
    </div>
  );
}

export default AdminAppointments;
