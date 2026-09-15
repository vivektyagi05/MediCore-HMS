import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  CircleSlash,
  Plus,
  ShieldAlert,
  Trash2,
  UserCog,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { doctorApi } from "../../api/doctorApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import DoctorDetailWorkspace from "../../components/admin/DoctorDetailWorkspace";
import FilterBar from "../../components/admin/FilterBar";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Input from "../../components/ui/Input";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import Textarea from "../../components/ui/Textarea";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const emptyForm = { userId: "", specialization: "", experience: 0, fees: 0 };

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "rating", label: "Rating: high to low" },
  { value: "experience", label: "Experience: high to low" },
  { value: "activity", label: "Most appointments" },
];

const verificationTone = { pending: "warning", approved: "success", rejected: "danger" };

function AdminDoctors() {
  const toast = useToast();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    verificationStatus: searchParams.get("verificationStatus") || "",
    status: searchParams.get("status") || "",
    specialization: searchParams.get("specialization") || "",
  });
  const [sort, setSort] = useState(searchParams.get("sort") || "newest");

  const [doctors, setDoctors] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveTarget, setApproveTarget] = useState(null);
  const [rowActionLoading, setRowActionLoading] = useState(null);

  const [statusPendingId, setStatusPendingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [detailDoctorId, setDetailDoctorId] = useState(null);

  const query = useMemo(
    () => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)),
    [searchParams],
  );

  const loadDoctors = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await adminApi.getDoctorsAdmin({ ...query, sort, limit: 100 });
      setDoctors(response.data.doctors || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await adminApi.getDoctorStatsAdmin();
      setStats(response.data || null);
    } catch {
      // Non-critical: the metric row just doesn't render if this fails,
      // rather than showing a fabricated number.
    }
  };

  useEffect(() => {
    loadDoctors();
  }, [searchParams, sort]);

  useEffect(() => {
    loadStats();
  }, []);

  const applyFilters = () => {
    setSearchParams(Object.fromEntries(Object.entries({ ...filters, sort }).filter(([, value]) => value)));
  };

  const changeSort = (nextSort) => {
    setSort(nextSort);
    setSearchParams(Object.fromEntries(Object.entries({ ...filters, sort: nextSort }).filter(([, value]) => value)));
  };

  const openCreateModal = async () => {
    setForm(emptyForm);
    setFormErrors({});
    setIsModalOpen(true);
    try {
      const response = await adminApi.getEligibleDoctorUsers();
      setEligibleUsers(response.data.users || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Could not load eligible doctor users.");
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setForm(emptyForm);
    setFormErrors({});
  };

  const saveDoctor = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setFormErrors({});
    try {
      await doctorApi.createDoctor(form);
      toast.success("Doctor profile created.");
      closeModal();
      await Promise.all([loadDoctors(), loadStats()]);
    } catch (error) {
      setFormErrors(error.response?.data?.details || {});
      toast.error(getApiErrorMessage(error) || "Doctor profile could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleDoctorStatus = async (row) => {
    setStatusPendingId(row._id);
    try {
      await adminApi.toggleUserStatus(row.user._id);
      toast.success(row.user.isActive ? "Doctor deactivated." : "Doctor activated.");
      await Promise.all([loadDoctors(), loadStats()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Unable to update doctor status.");
    } finally {
      setStatusPendingId(null);
    }
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    setRowActionLoading(approveTarget._id);
    try {
      await doctorApi.approveDoctor(approveTarget._id);
      toast.success("Doctor approved successfully.");
      setApproveTarget(null);
      await Promise.all([loadDoctors(), loadStats()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Doctor approval failed.");
    } finally {
      setRowActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast.error(t("admin.doctors.rejectReason") || "Rejection reason required");
      return;
    }
    setRowActionLoading(rejectTarget._id);
    try {
      await doctorApi.rejectDoctor(rejectTarget._id, rejectReason.trim());
      toast.success("Doctor rejected.");
      setRejectTarget(null);
      setRejectReason("");
      await Promise.all([loadDoctors(), loadStats()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Verification update failed.");
    } finally {
      setRowActionLoading(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await doctorApi.deleteDoctor(deleteTarget._id);
      toast.success("Doctor profile removed.");
      setDeleteTarget(null);
      await Promise.all([loadDoctors(), loadStats()]);
    } catch (error) {
      // The backend now returns a specific, real reason (e.g. existing
      // appointment history) instead of a generic failure -- surface it
      // as-is rather than a canned message.
      toast.error(getApiErrorMessage(error) || "Doctor could not be deleted.");
    } finally {
      setIsDeleting(false);
    }
  };

  const hasActiveFilters = Boolean(
    filters.search || filters.verificationStatus || filters.status || filters.specialization,
  );

  const columns = [
    {
      key: "doctor",
      header: "Doctor",
      render: (row) => (
        <div>
          <p className="font-bold text-slate-950">Dr. {row.user?.name}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{row.user?.email}</p>
        </div>
      ),
    },
    { key: "specialization", header: "Specialization" },
    {
      key: "verification",
      header: "Verification",
      render: (row) => (
        <div className="flex items-center gap-2">
          <StatusBadge tone={verificationTone[row.verificationStatus] || "neutral"}>
            {row.verificationStatus}
          </StatusBadge>
          {row.pendingDocumentsCount > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              {row.pendingDocumentsCount} doc{row.pendingDocumentsCount === 1 ? "" : "s"} pending
            </span>
          )}
        </div>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      render: (row) => <span className="font-bold text-slate-950">{(row.rating || 0).toFixed(1)}</span>,
    },
    {
      key: "activity",
      header: "Activity",
      render: (row) => (
        <span>
          {row.appointmentCount} appt{row.appointmentCount === 1 ? "" : "s"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        if (statusPendingId === row._id) return <StatusBadge tone="info">Updating…</StatusBadge>;
        return row.user?.isActive ? (
          <StatusBadge tone="success">Active</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Deactivated</StatusBadge>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDetailDoctorId(row._id)}>
            <UserCog size={14} /> View
          </Button>
          {row.verificationStatus === "pending" && (
            <>
              <Button variant="success" size="sm" onClick={() => setApproveTarget(row)} aria-label={`Approve Dr. ${row.user?.name}`}>
                <CheckCircle size={14} />
              </Button>
              <Button variant="danger" size="sm" onClick={() => setRejectTarget(row)} aria-label={`Reject Dr. ${row.user?.name}`}>
                <XCircle size={14} />
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toggleDoctorStatus(row)}
            disabled={statusPendingId === row._id}
            aria-label={row.user?.isActive ? `Deactivate Dr. ${row.user?.name}` : `Activate Dr. ${row.user?.name}`}
          >
            {row.user?.isActive ? <CircleSlash size={14} /> : <CheckCircle2 size={14} />}
          </Button>
          <Button variant="secondary" size="icon" onClick={() => setDeleteTarget(row)} aria-label={`Delete Dr. ${row.user?.name}`}>
            <Trash2 size={16} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Doctor Management"
        title="Doctor workspace"
        description="Verification, documents, availability, performance, reputation, and earnings — one connected view per doctor."
        action={
          <Button onClick={openCreateModal}>
            <Plus size={18} /> {t("admin.doctors.addDoctor")}
          </Button>
        }
      />

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Total Doctors" value={stats.total} icon={Users} />
          <MetricCard label="Active" value={stats.active} tone="success" icon={CheckCircle2} />
          <MetricCard label="Pending Verification" value={stats.pending} tone="warning" icon={AlertTriangle} />
          <MetricCard label="Rejected" value={stats.rejected} icon={XCircle} />
          <MetricCard label="Needs Attention" value={stats.attentionRequired} tone="warning" icon={ShieldAlert} />
        </div>
      )}

      <FilterBar
        filters={filters}
        onChange={(event) => setFilters((current) => ({ ...current, [event.target.name]: event.target.value }))}
        onApply={applyFilters}
      >
        <Select
          name="verificationStatus"
          value={filters.verificationStatus}
          onChange={(event) => setFilters((current) => ({ ...current, verificationStatus: event.target.value }))}
        >
          <option value="">All verification</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Select
          name="status"
          value={filters.status}
          onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </Select>
        <Select value={sort} onChange={(event) => changeSort(event.target.value)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FilterBar>

      {loadError ? (
        <ErrorState description={loadError} onRetry={loadDoctors} />
      ) : (
        <Card>
          <AdminTable
            columns={columns}
            data={doctors}
            isLoading={isLoading}
            emptyTitle="No doctors found"
            emptyDescription={
              hasActiveFilters
                ? "No doctors match these filters. Try clearing them."
                : "No doctor profiles yet — add the hospital's first doctor."
            }
            emptyActionLabel={!hasActiveFilters ? t("admin.doctors.addDoctor") : undefined}
            onEmptyAction={openCreateModal}
          />
        </Card>
      )}

      {pagination && pagination.total > pagination.limit && (
        <p className="text-center text-xs font-semibold text-slate-500">
          Showing {doctors.length} of {pagination.total} doctors. Narrow with search or filters to see more.
        </p>
      )}

      <AdminModal isOpen={isModalOpen} title={t("admin.doctors.addDoctor")} onClose={closeModal}>
        <form className="grid gap-4" onSubmit={saveDoctor}>
          <Select
            label="Doctor user account"
            required
            value={form.userId}
            error={formErrors.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value })}
            helperText={
              eligibleUsers.length === 0
                ? "No doctor-role user accounts are available to link. The person must sign up with the doctor role first."
                : undefined
            }
          >
            <option value="">Select a doctor user…</option>
            {eligibleUsers.map((user) => (
              <option key={user._id} value={user._id}>
                {user.name} ({user.email})
              </option>
            ))}
          </Select>
          <Input
            label="Specialization"
            required
            value={form.specialization}
            error={formErrors.specialization}
            onChange={(e) => setForm({ ...form, specialization: e.target.value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Experience (years)"
              type="number"
              min="0"
              value={form.experience}
              error={formErrors.experience}
              onChange={(e) => setForm({ ...form, experience: e.target.value })}
            />
            <Input
              label="Consultation Fee (₹)"
              type="number"
              min="0"
              value={form.fees}
              error={formErrors.fees}
              onChange={(e) => setForm({ ...form, fees: e.target.value })}
            />
          </div>
          <Button type="submit" isLoading={isSaving} disabled={eligibleUsers.length === 0}>
            Create Doctor Profile
          </Button>
        </form>
      </AdminModal>

      <AdminModal
        isOpen={Boolean(detailDoctorId)}
        title="Doctor Workspace"
        onClose={() => setDetailDoctorId(null)}
        size="xl"
      >
        {detailDoctorId && (
          <DoctorDetailWorkspace
            doctorId={detailDoctorId}
            onChanged={() => {
              loadDoctors();
              loadStats();
            }}
          />
        )}
      </AdminModal>

      <ConfirmDialog
        isOpen={Boolean(approveTarget)}
        title="Approve this doctor?"
        tone="success"
        confirmLabel="Approve"
        isLoading={Boolean(rowActionLoading)}
        description={
          approveTarget ? `Dr. ${approveTarget.user?.name} will be verified and become bookable by patients.` : ""
        }
        onConfirm={handleApprove}
        onClose={() => setApproveTarget(null)}
      />

      <AdminModal
        isOpen={Boolean(rejectTarget)}
        title="Reject doctor verification"
        onClose={() => {
          setRejectTarget(null);
          setRejectReason("");
        }}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Dr. {rejectTarget?.user?.name} will be notified and will need to resubmit for verification.
          </p>
          <Textarea
            label="Rejection reason"
            required
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explain what needs to be corrected..."
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              disabled={Boolean(rowActionLoading)}
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" isLoading={Boolean(rowActionLoading)} onClick={handleReject}>
              Reject
            </Button>
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={t("admin.doctors.deleteConfirm")}
        description={
          deleteTarget
            ? `Dr. ${deleteTarget.user?.name}'s profile will be permanently removed. If this doctor has any appointment, review, or payment history, deletion will be blocked -- deactivate the account instead to preserve that history.`
            : ""
        }
        confirmLabel="Delete Doctor"
        isLoading={isDeleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default AdminDoctors;
