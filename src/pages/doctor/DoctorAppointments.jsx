import {
  CalendarDays,
  Search,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  AlertTriangle,
  ShieldCheck,
  FileText,
  Ban,
  Layers,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { appointmentApi } from "../../api/appointmentApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import MetricCard from "../../components/ui/MetricCard";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import CancelAppointmentDialog from "../../components/shared/CancelAppointmentDialog";
import RescheduleAppointmentDialog from "../../components/shared/RescheduleAppointmentDialog";
import DoctorAppointmentDetailDrawer from "../../components/doctor/DoctorAppointmentDetailDrawer";

import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import {
  STATUS_LABELS,
  getDoctorAction,
  canDoctorCancel,
} from "../../utils/doctorAppointmentWorkflow";
import { appointmentStatusLabel, appointmentStatusTone, paymentStatusLabel, paymentStatusTone } from "../../utils/appointmentStatusDisplay";

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Phase DOC-04 rebuild — matches the brief's recommended information
// architecture (Today's Clinic / Attention / Pending / Upcoming / History)
// instead of the old flat 7-tab row. "Attention" and "Pending Approval" are
// real backend-driven queues (see backend/utils/appointmentAttention.js and
// getAppointmentSummary), not client-side guesses.
const COMPLETED_STATUSES = "consultation_completed,completed,review_eligible";

const QUEUE_TABS = [
  { value: "today", label: "Today's Clinic", params: { quickDate: "today", excludeStatus: "cancelled" } },
  { value: "attention", label: "Attention", params: { attentionOnly: "true" } },
  { value: "pending", label: "Pending Approval", params: { status: "pending" } },
  { value: "upcoming", label: "Upcoming", params: { quickDate: "upcoming", excludeStatus: "cancelled" } },
  { value: "completed", label: "Completed", params: { status: COMPLETED_STATUSES } },
  { value: "cancelled", label: "Cancelled", params: { status: "cancelled" } },
  { value: "all", label: "All", params: {} },
];

const PAGE_SIZE = 10;

function DoctorAppointments() {
  const toast = useToast();
  const { t } = useI18n();
  const { dashboardSyncTick } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  // PHASE P3 — real deep-link consumer for the backend's existing
  // ?patientId= scope (getAppointments already supported this; only the
  // frontend never read it — a disconnected-consumer bug). Lets the
  // Patient Relationship Center's Appointments tab send the doctor here
  // already scoped to one patient, with an optional specific appointment
  // auto-opened via ?highlight=.
  const patientIdFilter = searchParams.get("patientId") || "";
  const highlightAppointmentId = searchParams.get("highlight") || "";
  const [hasAppliedHighlight, setHasAppliedHighlight] = useState(!highlightAppointmentId);

  const [appointments, setAppointments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [summary, setSummary] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // When arriving scoped to a single patient, default to "All" rather than
  // "Today's Clinic" — the doctor came here to see that patient's full
  // history/appointment set, not just what's happening today.
  const [queueTab, setQueueTab] = useState(patientIdFilter ? "all" : "today");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [isBulkActing, setIsBulkActing] = useState(false);

  const [cancelTarget, setCancelTarget] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);

  // Reset the "have we auto-opened this highlight yet" guard whenever the
  // requested highlight id itself changes (e.g. navigating straight from
  // one patient's profile to another's without this page unmounting).
  useEffect(() => {
    setHasAppliedHighlight(!highlightAppointmentId);
  }, [highlightAppointmentId]);

  // Same reasoning for the patient scope itself: if the doctor navigates
  // straight from patient A's profile to patient B's (no page unmount in
  // between), re-default back to "All" for the new patient rather than
  // keeping whatever tab A happened to be viewed under.
  useEffect(() => {
    if (patientIdFilter) {
      setQueueTab("all");
      setPage(1);
    }
  }, [patientIdFilter]);

  // Debounce search so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [queueTab, statusFilter]);

  const buildQueryParams = () => {
    const tab = QUEUE_TABS.find((t2) => t2.value === queueTab) || QUEUE_TABS[0];
    const params = { page, limit: PAGE_SIZE, ...tab.params };

    if (search) params.search = search;
    if (patientIdFilter) params.patientId = patientIdFilter;

    // Explicit status filter overrides the tab's implicit one (e.g. viewing
    // "All" but narrowed to just "approved").
    if (statusFilter !== "all") {
      params.status = statusFilter;
      delete params.excludeStatus;
      delete params.attentionOnly;
    }

    return params;
  };

  const loadAppointments = async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = buildQueryParams();
      const response = await appointmentApi.getAppointments(params);
      const loaded = response.data?.appointments || [];
      setAppointments(loaded);
      setPagination(response.data?.pagination || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });

      // Auto-open the specific appointment this deep link pointed at, once,
      // the first time it's found on a loaded page. If it's on another
      // page (or was cancelled/removed), we simply don't force it open —
      // never a fake/blank drawer.
      if (!hasAppliedHighlight && highlightAppointmentId) {
        const match = loaded.find((a) => a._id === highlightAppointmentId);
        if (match) {
          setDetailTarget(match);
          setHasAppliedHighlight(true);
        }
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const clearPatientFilter = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("patientId");
      next.delete("highlight");
      return next;
    });
    setQueueTab("today");
    setPage(1);
  };

  const loadSummary = async () => {
    setSummaryError("");
    try {
      const response = await appointmentApi.getAppointmentSummary();
      setSummary(response.data);
    } catch (err) {
      setSummaryError(getApiErrorMessage(err));
    }
  };

  useEffect(() => {
    loadAppointments();
  }, [dashboardSyncTick, queueTab, statusFilter, page, search, patientIdFilter]);

  useEffect(() => {
    loadSummary();
  }, [dashboardSyncTick]);

  const refreshAll = async () => {
    await Promise.all([loadAppointments(), loadSummary()]);
  };

  const updateStatus = async (id, status) => {
    setUpdatingId(id);
    try {
      await appointmentApi.updateAppointmentStatus(id, { status });
      toast.success(`Appointment marked ${STATUS_LABELS[status]?.toLowerCase() || status}`);
      await refreshAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setUpdatingId("");
    }
  };

  const bulkApprove = async () => {
    if (!selectedIds.length) return;
    setIsBulkActing(true);
    try {
      // No bulk-update backend endpoint exists yet, so this reuses the
      // existing single-appointment update endpoint per selection rather
      // than fabricating a new bulk API.
      await Promise.all(selectedIds.map((id) => appointmentApi.updateAppointmentStatus(id, { status: "approved" })));
      toast.success(`Approved ${selectedIds.length} appointment(s)`);
      setSelectedIds([]);
      await refreshAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsBulkActing(false);
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const pendingInView = appointments.filter((a) => a.status === "pending");

  if (isLoading && appointments.length === 0 && !error) {
    return <Loader label={t("ui.loadingAppointments")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-royal-600">Doctor Appointments</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Appointment Intelligence</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your clinical schedule and the work that needs your attention today.
          </p>
        </div>
        <Button onClick={refreshAll}>Refresh</Button>
      </div>

      {/* PHASE P3 — real "filtered to one patient" context banner. Only
          the appointment LIST below is scoped to this patient; the summary
          cards intentionally stay whole-practice (getAppointmentSummary has
          no patient scope) so they're never presented as this patient's
          numbers. */}
      {patientIdFilter && (
        <div className="flex items-center justify-between rounded-card border border-royal-200 bg-royal-50 px-5 py-3">
          <p className="text-sm font-bold text-royal-700">
            Showing appointments for one patient
            {appointments[0]?.patientId?.name ? ` — ${appointments[0].patientId.name}` : ""}.
          </p>
          <Button variant="secondary" size="sm" onClick={clearPatientFilter}>
            Clear filter
          </Button>
        </div>
      )}

      {summaryError ? (
        <ErrorState description={summaryError} onRetry={loadSummary} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Total" value={summary?.total ?? "—"} icon={CalendarDays} tone="info" />
          <MetricCard label="Pending" value={summary?.pending ?? "—"} icon={Clock3} tone="warning" />
          <MetricCard label="In Consultation" value={summary?.inConsultation ?? "—"} icon={CheckCircle2} tone="info" />
          <MetricCard label="Completed" value={summary?.completed ?? "—"} icon={ClipboardCheck} tone="success" />
          <MetricCard label="Needs Attention" value={summary?.needsAttention ?? "—"} icon={AlertTriangle} tone="danger" />
        </div>
      )}

      <AIDraftPanel
        title="AI Queue Optimization: Smart Recommendations"
        actionLabel="Get recommendations"
        onGenerate={() => aiAssistApi.getWorkflowSuggestions()}
        compact
      />

      <Card>
        <div className="flex flex-wrap gap-2">
          {QUEUE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setQueueTab(tab.value)}
              className={`rounded-control px-4 py-2 text-xs font-bold transition ${
                queueTab === tab.value ? "bg-navy-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
              {tab.value === "attention" && summary?.needsAttention > 0 && (
                <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] text-white">
                  {summary.needsAttention}
                </span>
              )}
              {tab.value === "pending" && summary?.pending > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">
                  {summary.pending}
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t("ui.searchAndFilter")}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("ui.searchPatient")}
              className="w-full rounded-control border border-slate-300 py-3 pl-11 pr-4 text-sm outline-none focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-control border border-slate-300 p-3 text-sm outline-none focus:border-royal-600"
          >
            <option value="all">All Statuses</option>
            {Object.keys(STATUS_LABELS).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {queueTab === "pending" && pendingInView.length > 0 && (
        <Card className="!p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Layers size={16} className="text-slate-400" />
            <span className="text-sm font-bold text-slate-600">{selectedIds.length} selected</span>
            <Button variant="secondary" onClick={() => setSelectedIds(pendingInView.map((a) => a._id))}>
              Select All Pending
            </Button>
            <Button isLoading={isBulkActing} disabled={!selectedIds.length} onClick={bulkApprove}>
              Quick Approve Selected
            </Button>
          </div>
        </Card>
      )}

      <Card title={t("sidebar.appointments")}>
        {error ? (
          <ErrorState description={error} onRetry={loadAppointments} />
        ) : appointments.length === 0 ? (
          <EmptyState title={t("ui.noAppointmentsFound")} description="Appointments will appear here." />
        ) : (
          <div className="space-y-3">
            {appointments.map((appointment) => {
              const isEmergency = (appointment.painLevel || 0) >= 8 && appointment.status !== "cancelled";
              const needsPrescription = appointment.status === "consultation_completed";
              const canReschedule = canDoctorCancel(appointment.status);

              const primaryAction = getDoctorAction(appointment);

              return (
                <div
                  key={appointment._id}
                  className={`rounded-card border p-4 transition ${
                    isEmergency
                      ? "border-rose-200 bg-rose-50/60"
                      : appointment.needsAttention
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    {/* PATIENT / TIME — primary information */}
                    <div className="flex items-start gap-3">
                      {appointment.status === "pending" && queueTab === "pending" && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(appointment._id)}
                          onChange={() => toggleSelected(appointment._id)}
                          className="mt-1.5 h-4 w-4"
                        />
                      )}
                      <div>
                        <h3 className="text-base font-bold text-slate-950">
                          {appointment.patientId?.name}
                          {isEmergency && <AlertTriangle size={14} className="ml-2 inline text-rose-600" />}
                          {appointment.needsAttention && !isEmergency && (
                            <AlertTriangle size={14} className="ml-2 inline text-amber-500" />
                          )}
                        </h3>
                        <p className="text-sm text-slate-500">{appointment.patientId?.email}</p>
                        <p className="mt-2 text-sm font-medium text-slate-700">
                          {formatDate(appointment.date)}
                          {" • "}
                          {appointment.timeSlot}
                          {appointment.reason ? ` • ${appointment.reason}` : ""}
                          {appointment.rescheduleHistory?.length > 0 && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-royal-600">
                              <CalendarClock size={12} /> Rescheduled
                            </span>
                          )}
                          {appointment.appointmentType === "follow_up" && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-amber-600">
                              <CalendarClock size={12} /> Follow-up
                            </span>
                          )}
                        </p>

                        {/* IMPORTANT CONTEXT — status + contextual chips */}
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <StatusBadge tone={appointmentStatusTone(appointment.status)}>
                            {appointmentStatusLabel(appointment.status)}
                          </StatusBadge>
                          <StatusBadge tone={paymentStatusTone(appointment.paymentStatus)}>
                            {paymentStatusLabel(appointment.paymentStatus)}
                          </StatusBadge>
                          {appointment.insuranceId && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-royal-100 px-2.5 py-1 text-[11px] font-bold text-royal-700">
                              <ShieldCheck size={12} /> Insured
                            </span>
                          )}
                          {appointment.reportIds?.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-700">
                              <FileText size={12} /> {appointment.reportIds.length} Report(s)
                            </span>
                          )}
                          {needsPrescription && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                              Needs Prescription
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ACTIONS — primary action visually dominant, everything
                        else de-emphasized so it never competes with it. */}
                    <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
                      {primaryAction && (
                        <Button
                          isLoading={updatingId === appointment._id}
                          onClick={() => updateStatus(appointment._id, primaryAction.nextStatus)}
                        >
                          {primaryAction.label}
                        </Button>
                      )}

                      {appointment.status === "pending" && (
                        <Button
                          variant="secondary"
                          isLoading={updatingId === appointment._id}
                          onClick={() => setCancelTarget(appointment)}
                        >
                          <Ban size={14} className="mr-1" /> Reject
                        </Button>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button variant="tertiary" size="sm" onClick={() => setDetailTarget(appointment)}>
                          <Eye size={14} className="mr-1" /> Details
                        </Button>

                        {canReschedule && (
                          <Button variant="tertiary" size="sm" onClick={() => setRescheduleTarget(appointment)}>
                            <CalendarClock size={14} className="mr-1" /> Reschedule
                          </Button>
                        )}

                        {canDoctorCancel(appointment.status) && appointment.status !== "pending" && (
                          <Button variant="tertiary" size="sm" isLoading={updatingId === appointment._id} onClick={() => setCancelTarget(appointment)}>
                            Cancel
                          </Button>
                        )}
                      </div>

                      <Button variant="tertiary" size="sm" to={`/doctor/clinical?patientId=${appointment.patientId?._id}&tab=history`}>
                        Open in Clinical Workspace
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!error && pagination.pages > 1 && (
          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500">
              Page {pagination.page} of {pagination.pages} · {pagination.total} total
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} /> Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={pagination.page >= pagination.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <CancelAppointmentDialog
        appointment={cancelTarget}
        mode={cancelTarget?.status === "pending" ? "reject" : "cancel"}
        onClose={() => setCancelTarget(null)}
        onConfirm={async (reason) => {
          const res = await appointmentApi.cancelAppointment(cancelTarget._id, reason);
          setCancelTarget(null);
          await refreshAll();
          return res;
        }}
      />

      <RescheduleAppointmentDialog
        appointment={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onDone={async () => {
          setRescheduleTarget(null);
          await refreshAll();
        }}
      />

      <DoctorAppointmentDetailDrawer appointment={detailTarget} onClose={() => setDetailTarget(null)} />
    </div>
  );
}

export default DoctorAppointments;
