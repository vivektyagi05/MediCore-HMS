import {
  AlertTriangle,
  Baby,
  Calendar,
  CalendarClock,
  Eye,
  IndianRupee,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import FilterBar from "../../components/admin/FilterBar";
import PatientWorkspace from "../../components/admin/PatientWorkspace";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Input from "../../components/ui/Input";
import MetricCard from "../../components/ui/MetricCard";
import Modal from "../../components/ui/Modal";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const riskTone = { high: "danger", medium: "warning", low: "success" };

const EMPTY_EDIT_FORM = { name: "", email: "", bloodGroup: "", address: "", emergencyName: "", emergencyPhone: "" };

function AdminPatients() {
  const toast = useToast();
  const navigate = useNavigate();
  const { dashboardSyncTick } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "",
    gender: searchParams.get("gender") || "",
    attention: searchParams.get("attention") || "",
    hasUpcoming: searchParams.get("hasUpcoming") || "",
    hasOutstanding: searchParams.get("hasOutstanding") || "",
    hasInsurance: searchParams.get("hasInsurance") || "",
    hasFamily: searchParams.get("hasFamily") || "",
  });

  const [patients, setPatients] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [workspacePatientId, setWorkspacePatientId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionError, setActionError] = useState("");
  const [isActing, setIsActing] = useState(false);

  const query = useMemo(
    () => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)),
    [searchParams],
  );

  const loadPatients = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await adminApi.getPatientsAdmin({ ...query, limit: 20 });
      setPatients(response.data.patients || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await adminApi.getPatientStatsAdmin();
      setStats(response.data || null);
    } catch {
      // Non-critical: the KPI strip simply doesn't render rather than
      // showing a fabricated number.
    }
  };

  useEffect(() => {
    loadPatients();
  }, [searchParams, dashboardSyncTick]);

  useEffect(() => {
    loadStats();
  }, [dashboardSyncTick]);

  const applyFilters = () => {
    setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  };

  const setMetricFilter = (patch) => {
    const next = {
      search: "",
      status: "",
      gender: "",
      attention: "",
      hasUpcoming: "",
      hasOutstanding: "",
      hasInsurance: "",
      hasFamily: "",
      ...patch,
    };
    setFilters(next);
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
  };

  const openEditModal = (patient) => {
    setEditForm({
      name: patient.name || "",
      email: patient.email || "",
      bloodGroup: patient.bloodGroup || "",
      address: "",
      emergencyName: "",
      emergencyPhone: "",
    });
    setEditTarget(patient);
  };

  const handleSaveEdit = async () => {
    setIsSaving(true);
    try {
      await adminApi.updateUser(editTarget._id, {
        name: editForm.name,
        email: editForm.email,
        patientProfile: {
          bloodGroup: editForm.bloodGroup,
          address: editForm.address,
          emergencyContact: { name: editForm.emergencyName, phone: editForm.emergencyPhone },
        },
      });
      toast.success("Patient profile updated successfully.");
      setEditTarget(null);
      await loadPatients();
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Patient profile could not be updated.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    setIsActing(true);
    try {
      await adminApi.toggleUserStatus(statusTarget._id);
      toast.success(statusTarget.isActive ? "Patient deactivated successfully." : "Patient activated successfully.");
      setStatusTarget(null);
      await Promise.all([loadPatients(), loadStats()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Status could not be updated.");
    } finally {
      setIsActing(false);
    }
  };

  const handleDelete = async () => {
    setIsActing(true);
    setActionError("");
    try {
      await adminApi.deleteUser(deleteTarget._id);
      toast.success("Patient deleted successfully.");
      setDeleteTarget(null);
      await Promise.all([loadPatients(), loadStats()]);
    } catch (error) {
      // Server-side referential-integrity guard (a patient with real
      // appointment history cannot be hard-deleted) surfaces here as a
      // real, human-readable message rather than a raw error dump.
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsActing(false);
    }
  };

  const columns = [
    {
      key: "identity",
      header: "Patient",
      render: (row) => (
        <div>
          <p className="font-bold text-slate-950">{row.name}</p>
          <p className="text-xs text-slate-500">{row.email}</p>
          <p className="text-xs text-slate-400">
            {row.age != null ? `${row.age} yrs` : "Age not on file"}
            {row.gender && ` · ${row.gender}`}
          </p>
        </div>
      ),
    },
    {
      key: "clinical",
      header: "Clinical Context",
      render: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.medicalConditions?.length ? row.medicalConditions.slice(0, 2).join(", ") : "No conditions on file"}</p>
          {row.allergies?.length > 0 && <p className="font-semibold text-amber-600">Allergy on file</p>}
          <StatusBadge tone={riskTone[row.riskLevel] || "neutral"} className="mt-1">
            {row.riskLevel} risk
          </StatusBadge>
        </div>
      ),
    },
    {
      key: "activity",
      header: "Activity",
      render: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.appointmentCount} appointment(s)</p>
          <p>{row.lastVisit ? `Last visit ${new Date(row.lastVisit).toLocaleDateString()}` : "No visits yet"}</p>
          {row.nextVisit && <p className="font-semibold text-royal-700">Next: {new Date(row.nextVisit).toLocaleDateString()}</p>}
        </div>
      ),
    },
    {
      key: "operations",
      header: "Operations",
      render: (row) => (
        <div className="text-xs text-slate-600">
          {row.financialRestricted ? (
            <p className="text-slate-400">Financial: restricted</p>
          ) : (
            <p className={row.outstandingAmount > 0 ? "font-semibold text-rose-600" : ""}>Outstanding: ₹{row.outstandingAmount}</p>
          )}
          <p>{row.hasInsurance ? "Insured" : "No insurance on file"}</p>
          <p>{row.reportsCount} report(s) · {row.prescriptionsCount} prescription(s)</p>
          {row.needsAttention && (
            <p className="flex items-center gap-1 font-bold text-amber-600">
              <AlertTriangle size={12} /> Needs attention ({row.attentionCount})
            </p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWorkspacePatientId(row._id)}>
            <Eye size={14} /> Open
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/appointments?patientId=${row._id}`)}>
            <CalendarClock size={14} /> Appointments
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openEditModal(row)}>
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setStatusTarget(row)}>
            {row.isActive ? <UserX size={14} /> : <UserCheck size={14} />} {row.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setActionError("");
              setDeleteTarget(row);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Patient Management"
        title="Patients Management Workspace"
        description="Understand and operate a patient from one place — identity, health context, history, and what needs attention."
      />

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <button type="button" className="text-left" onClick={() => setMetricFilter({})}>
            <MetricCard label="Total Patients" value={stats.totalPatients} icon={Users} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ status: "active" })}>
            <MetricCard label="Active Patients" value={stats.activePatients} icon={ShieldCheck} tone="success" />
          </button>
          <MetricCard label="New This Month" value={stats.newPatientsThisMonth} icon={Baby} caption="Registered this calendar month" />
          <button type="button" className="text-left" onClick={() => setMetricFilter({ hasUpcoming: "true" })}>
            <MetricCard label="Upcoming Appointment" value={stats.patientsWithUpcomingAppointment} icon={CalendarClock} />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ attention: "true" })}>
            <MetricCard
              label="Needs Attention"
              value={stats.patientsNeedingAttention}
              tone={stats.patientsNeedingAttention > 0 ? "danger" : "neutral"}
              icon={AlertTriangle}
            />
          </button>
          <MetricCard
            label="Missing Critical Info"
            value={stats.patientsWithMissingInfo}
            tone={stats.patientsWithMissingInfo > 0 ? "warning" : "neutral"}
            icon={Calendar}
          />
          {stats.canViewFinance && stats.outstandingBalanceTotal != null && (
            <button type="button" className="text-left" onClick={() => setMetricFilter({ hasOutstanding: "true" })}>
              <MetricCard
                label="Outstanding Balance"
                value={`₹${stats.outstandingBalanceTotal.toLocaleString("en-IN")}`}
                caption="Live · across pending/failed payments"
                icon={IndianRupee}
                tone={stats.outstandingBalanceTotal > 0 ? "danger" : "success"}
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
        <Select name="status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select name="gender" value={filters.gender} onChange={(event) => setFilters((current) => ({ ...current, gender: event.target.value }))}>
          <option value="">All genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </Select>
        <Select
          name="hasUpcoming"
          value={filters.hasUpcoming}
          onChange={(event) => setFilters((current) => ({ ...current, hasUpcoming: event.target.value }))}
        >
          <option value="">Any appointment activity</option>
          <option value="true">Has upcoming appointment</option>
        </Select>
        <Select
          name="hasInsurance"
          value={filters.hasInsurance}
          onChange={(event) => setFilters((current) => ({ ...current, hasInsurance: event.target.value }))}
        >
          <option value="">Any insurance status</option>
          <option value="true">Has insurance on file</option>
        </Select>
        <Select
          name="hasOutstanding"
          value={filters.hasOutstanding}
          onChange={(event) => setFilters((current) => ({ ...current, hasOutstanding: event.target.value }))}
        >
          <option value="">Any payment status</option>
          <option value="true">Has outstanding balance</option>
        </Select>
        <Select name="hasFamily" value={filters.hasFamily} onChange={(event) => setFilters((current) => ({ ...current, hasFamily: event.target.value }))}>
          <option value="">Any family status</option>
          <option value="true">Has linked family members</option>
        </Select>
      </FilterBar>

      {loadError ? (
        <ErrorState description={loadError} onRetry={loadPatients} />
      ) : (
        <Card>
          <AdminTable
            columns={columns}
            data={patients}
            isLoading={isLoading}
            emptyTitle="No patients found"
            emptyDescription={activeFilterCount > 0 ? "No patients match these filters. Try clearing them." : "No patients have registered yet."}
          />
        </Card>
      )}

      {pagination && pagination.total > pagination.limit && (
        <p className="text-center text-xs font-semibold text-slate-500">
          Showing {patients.length} of {pagination.total} patients. Narrow with search or filters to see more.
        </p>
      )}

      <AdminModal isOpen={Boolean(workspacePatientId)} title="Patient Workspace" onClose={() => setWorkspacePatientId(null)} size="xl">
        {workspacePatientId && (
          <PatientWorkspace
            patientId={workspacePatientId}
            onViewAppointments={(patientId) => navigate(`/admin/appointments?patientId=${patientId}`)}
          />
        )}
      </AdminModal>

      <Modal isOpen={Boolean(editTarget)} title="Edit patient profile" onClose={() => setEditTarget(null)}>
        <div className="space-y-4">
          <Input label="Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
          <Input label="Blood Group" value={editForm.bloodGroup} onChange={(e) => setEditForm((f) => ({ ...f, bloodGroup: e.target.value }))} />
          <Input label="Address" value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
          <Input
            label="Emergency Contact Name"
            value={editForm.emergencyName}
            onChange={(e) => setEditForm((f) => ({ ...f, emergencyName: e.target.value }))}
          />
          <Input
            label="Emergency Contact Phone"
            value={editForm.emergencyPhone}
            onChange={(e) => setEditForm((f) => ({ ...f, emergencyPhone: e.target.value }))}
          />
          <Button className="w-full" isLoading={isSaving} onClick={handleSaveEdit}>
            Save Changes
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(statusTarget)}
        title={statusTarget?.isActive ? "Deactivate patient?" : "Activate patient?"}
        description={
          statusTarget?.isActive
            ? `${statusTarget?.name} will lose access to their account. Medical and payment history is preserved and this can be reversed at any time.`
            : `${statusTarget?.name} will regain access to their account.`
        }
        confirmLabel={statusTarget?.isActive ? "Deactivate" : "Activate"}
        tone={statusTarget?.isActive ? "danger" : "success"}
        isLoading={isActing}
        onConfirm={handleToggleStatus}
        onClose={() => setStatusTarget(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete patient?"
        description={
          actionError ||
          `This permanently deletes ${deleteTarget?.name}'s account. This cannot be undone. If this patient has appointment history, the deletion will be blocked automatically to protect medical and payment records — deactivate instead in that case.`
        }
        confirmLabel="Delete"
        tone="danger"
        isLoading={isActing}
        onConfirm={handleDelete}
        onClose={() => {
          setDeleteTarget(null);
          setActionError("");
        }}
      />
    </div>
  );
}

export default AdminPatients;
