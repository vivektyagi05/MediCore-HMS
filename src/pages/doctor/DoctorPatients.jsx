import { Search, Users, UserCheck, Clock3, Activity, AlertTriangle, Pin, ShieldAlert, Wallet, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { doctorApi } from "../../api/doctorApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import MetricCard from "../../components/ui/MetricCard";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";

import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import {
  getPinnedPatientIds,
  togglePinnedPatient,
  recordRecentlyViewedPatient,
} from "../../utils/doctorPatientPreferences";

function formatDate(value) {
  if (!value) return "N/A";

  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const RISK_STYLES = {
  high: "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
};

// STEP 3 — real, backend-supported filters only (matches
// doctorPatientRelationshipService.js's PATIENT_LIST_FILTERS). No status
// here is invented on the frontend; each maps to a real server-side rule.
const LIST_FILTERS = [
  { value: "all", label: "All" },
  { value: "followup_due", label: "Follow-up Due" },
  { value: "upcoming_appointment", label: "Upcoming Appointment" },
  { value: "recent", label: "Recent" },
  { value: "no_recent_visit", label: "No Recent Visit" },
  { value: "high_risk", label: "High Risk" },
];

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Identity + attention block shared by both the "Needs Attention" row and
// the regular grid, so a patient looks like the same person wherever they
// appear — only the surrounding layout differs.
function PatientIdentity({ patient, pinned, onTogglePin }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-royal-100 text-sm font-bold text-royal-700">
          {initials(patient.name)}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-950">{patient.name}</h3>
          <p className="truncate text-xs text-slate-500">{patient.email}</p>
        </div>
      </div>
      <button onClick={() => onTogglePin(patient._id)} title="Pin patient" className="shrink-0">
        <Pin size={16} className={pinned ? "fill-royal-600 text-royal-600" : "text-slate-300"} />
      </button>
    </div>
  );
}

function AttentionBadges({ patient }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${RISK_STYLES[patient.riskLevel] || "bg-slate-100 text-slate-600"}`}>
        {patient.riskLevel || "low"} risk
      </span>
      {patient.needsFollowUp && (
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">Follow-up due</span>
      )}
      {patient.unreadMessages > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-royal-100 px-2.5 py-1 text-[11px] font-bold text-royal-700">
          <MessageSquare size={11} /> {patient.unreadMessages} unread
        </span>
      )}
    </div>
  );
}

function MetaRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${tone || "text-slate-900"}`}>{value}</span>
    </div>
  );
}

function PatientActions({ patient, onOpen }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <Button onClick={() => onOpen(patient, `/doctor/patients/${patient._id}`)}>
        View Profile
      </Button>
      <Button variant="secondary" onClick={() => onOpen(patient, `/doctor/clinical?patientId=${patient._id}&tab=history`)}>
        History
      </Button>
      <Button variant="secondary" onClick={() => onOpen(patient, `/doctor/patients/${patient._id}?tab=communication`)}>
        <MessageSquare size={14} className="mr-1 inline" /> Chat
        {patient.unreadMessages > 0 && (
          <span className="ml-1.5 rounded-full bg-royal-100 px-1.5 text-[10px] text-royal-700">{patient.unreadMessages}</span>
        )}
      </Button>
      <Button variant="secondary" onClick={() => onOpen(patient, `/doctor/clinical?patientId=${patient._id}&tab=notes`)}>
        Follow Up
      </Button>
    </div>
  );
}

function DoctorPatients() {
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { dashboardSyncTick } = useRealtime();

  const [patients, setPatients] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [pagination, setPagination] = useState(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [page, setPage] = useState(1);
  const [pinnedIds, setPinnedIds] = useState(getPinnedPatientIds());

  // Debounce the search box so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const loadPatients = async (targetPage = page) => {
    setIsLoading(true);
    setError("");

    try {
      const response = await doctorApi.getPatients({
        search: search || undefined,
        filter,
        sort: sortBy,
        page: targetPage,
        pageSize: 12,
      });

      setPatients(response.data?.patients || []);
      setAnalytics(response.data?.analytics || {});
      setPagination(response.data?.pagination || null);
    } catch (err) {
      setError(getApiErrorMessage(err));
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPatients(page);
  }, [dashboardSyncTick, search, filter, sortBy, page]);

  const openPatient = (patient, path) => {
    recordRecentlyViewedPatient(patient);
    navigate(path);
  };

  const togglePin = (patientId) => {
    setPinnedIds(togglePinnedPatient(patientId));
  };

  const changeFilter = (value) => {
    setFilter(value);
    setPage(1);
  };

  const changeSort = (value) => {
    setSortBy(value);
    setPage(1);
  };

  // "Who needs my attention?" — a client-side grouping of the page of real,
  // already-loaded patients already returned by the backend. Nothing new is
  // fetched or computed server-side; this only decides which already-real
  // patients surface first. High risk, an overdue follow-up, or an existing
  // clinical alert are all real fields the backend already sends.
  const { attentionPatients, otherPatients } = useMemo(() => {
    const attention = [];
    const rest = [];
    for (const patient of patients) {
      if (patient.riskLevel === "high" || patient.needsFollowUp || patient.alerts?.length > 0) {
        attention.push(patient);
      } else {
        rest.push(patient);
      }
    }
    return { attentionPatients: attention, otherPatients: rest };
  }, [patients]);

  if (isLoading && patients.length === 0 && !error) {
    return <Loader label={t("ui.loadingPatients")} />;
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-royal-600">Doctor Patients</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Patient Relationship Center</h1>
          <p className="mt-2 text-sm text-slate-500">
            Who needs attention, what happened before, and what's next — all in one workspace.
          </p>
        </div>
        <Button onClick={() => loadPatients(page)}>Refresh Patients</Button>
      </div>

      {/* ERROR */}
      {error && <ErrorState description={error} onRetry={() => loadPatients(page)} />}

      {/* ANALYTICS */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Total Patients" value={analytics.totalPatients || 0} icon={Users} tone="info" />
        <MetricCard label="Active Patients" value={analytics.activePatients || 0} icon={UserCheck} tone="success" />
        <MetricCard label="Follow Ups" value={analytics.followUps || 0} icon={Clock3} tone="warning" />
        <MetricCard label="New This Month" value={analytics.newPatientsThisMonth || 0} icon={Activity} tone="violet" />
        <MetricCard label="High Risk" value={analytics.highRiskPatients || 0} icon={AlertTriangle} tone="danger" />
        <MetricCard label="Outstanding Bills" value={analytics.outstandingBillsCount || 0} icon={Wallet} tone="premium" />
      </div>

      {/* SEARCH + FILTERS */}
      <Card title={t("ui.searchPatients")}>
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("ui.searchByNameEmail")}
            className="w-full rounded-control border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm font-medium outline-none transition focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {LIST_FILTERS.map((item) => (
            <button
              key={item.value}
              onClick={() => changeFilter(item.value)}
              className={`rounded-control px-3 py-2 text-xs font-bold transition ${
                filter === item.value ? "bg-navy-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {item.label}
            </button>
          ))}

          <select
            value={sortBy}
            onChange={(e) => changeSort(e.target.value)}
            className="ml-auto rounded-control border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none"
          >
            <option value="recent">Sort: Last Visit</option>
            <option value="name">Sort: Name</option>
            <option value="risk">Sort: Risk Level</option>
          </select>
        </div>
      </Card>

      {/* PATIENTS */}
      {!isLoading && patients.length === 0 ? (
        <EmptyState
          title={t("ui.noPatients")}
          description={
            search || filter !== "all"
              ? "No patients match this search/filter. Try clearing it."
              : t("ui.patientsAfterAppointments")
          }
        />
      ) : (
        <>
          {attentionPatients.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-control bg-rose-100 text-rose-600">
                  <ShieldAlert size={14} />
                </span>
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                  Needs Your Attention
                </h2>
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                  {attentionPatients.length}
                </span>
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {attentionPatients.map((patient) => (
                  <Card key={patient._id} className="border-rose-200/70 bg-rose-50/30">
                    <PatientIdentity patient={patient} pinned={pinnedIds.includes(patient._id)} onTogglePin={togglePin} />
                    <AttentionBadges patient={patient} />

                    {patient.alerts?.length > 0 && (
                      <div className="mt-3 space-y-1.5 rounded-control bg-rose-100/60 p-3">
                        {patient.alerts.map((alert, i) => (
                          <p key={i} className="flex items-start gap-1.5 text-xs font-semibold text-rose-700">
                            <ShieldAlert size={13} className="mt-0.5 shrink-0" /> {alert}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="mt-4">
                      <MetaRow label="Total Visits" value={patient.appointmentCount} />
                      <MetaRow label="Last Visit" value={formatDate(patient.lastVisit)} />
                      <MetaRow label="Next Visit" value={formatDate(patient.nextVisit)} />
                      {patient.outstandingAmount > 0 && (
                        <MetaRow label="Outstanding Bill" value={`₹${patient.outstandingAmount}`} tone="text-rose-600" />
                      )}
                    </div>

                    <PatientActions patient={patient} onOpen={openPatient} />
                  </Card>
                ))}
              </div>
            </div>
          )}

          {otherPatients.length > 0 && (
            <div>
              {attentionPatients.length > 0 && (
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">All Other Patients</h2>
              )}
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {otherPatients.map((patient) => (
                  <Card key={patient._id}>
                    <PatientIdentity patient={patient} pinned={pinnedIds.includes(patient._id)} onTogglePin={togglePin} />
                    <AttentionBadges patient={patient} />

                    <div className="mt-4">
                      <MetaRow label="Gender" value={<span className="capitalize">{patient.gender || "N/A"}</span>} />
                      <MetaRow label="Blood Group" value={patient.bloodGroup || "N/A"} />
                      <MetaRow label="Total Visits" value={patient.appointmentCount} tone="text-royal-600" />
                      <MetaRow label="Last Visit" value={formatDate(patient.lastVisit)} />
                      <MetaRow label="Next Visit" value={formatDate(patient.nextVisit)} />
                      {patient.insurance && (
                        <MetaRow
                          label="Insurance"
                          value={`${patient.insurance.provider}${patient.insurance.expiringSoon ? " (expiring soon)" : ""}`}
                          tone={patient.insurance.expiringSoon ? "text-amber-600" : undefined}
                        />
                      )}
                      {patient.outstandingAmount > 0 && (
                        <MetaRow label="Outstanding Bill" value={`₹${patient.outstandingAmount}`} tone="text-rose-600" />
                      )}
                      {patient.reportsCount > 0 && <MetaRow label="Reports on File" value={patient.reportsCount} />}
                      {patient.familyMembers?.length > 0 && (
                        <MetaRow label="Family Members" value={patient.familyMembers.map((m) => m.name).join(", ")} />
                      )}
                    </div>

                    {(patient.medicalConditions?.length > 0 || patient.allergies?.length > 0) && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {patient.medicalConditions?.map((c) => (
                          <span key={c} className="rounded-control bg-royal-50 px-2 py-1 text-[11px] font-bold text-royal-700">{c}</span>
                        ))}
                        {patient.allergies?.map((a) => (
                          <span key={a} className="rounded-control bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">⚠ {a}</span>
                        ))}
                      </div>
                    )}

                    <PatientActions patient={patient} onOpen={openPatient} />
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* PAGINATION */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between rounded-card border border-slate-200 bg-white px-5 py-3">
          <p className="text-xs font-bold text-slate-500">
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} patients
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!pagination.hasPrevious} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={16} /> Prev
            </Button>
            <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DoctorPatients;
