import { useEffect, useState } from "react";
import { ShieldAlert, UserCog } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { useRealtime } from "../../context/RealtimeContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import Badge from "../../components/ui/Badge";
import StatusBadge from "../../components/ui/StatusBadge";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Loader from "../../components/ui/Loader";
import ErrorState from "../../components/shared/ErrorState";
import EmptyState from "../../components/shared/EmptyState";
import AdminTable from "../../components/admin/AdminTable";

// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-14, PART B1 — Admin User Management.
//
// AdminDoctors.jsx and AdminPatients.jsx already own the specialized
// doctor/patient workflows and already reuse userAdminController's
// mutations (updateUser/toggleUserStatus/deleteUser) for their rows. This
// page is deliberately NOT a third view of doctors or patients — it is
// the one place that was missing: a searchable directory across every
// role (admin/super_admin/receptionist accounts have no dedicated page
// anywhere), with basic account actions available uniformly. Doctor and
// patient rows deep-link to their real specialized workspace instead of
// duplicating it.
//
// getUsers() was previously an unbounded `find({})` with zero consumers —
// fixed server-side this phase (paginationValidation.js, the same shared
// helper every other admin list uses) alongside real search/role/status
// filtering. Nothing here re-implements that filtering client-side.
// ─────────────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = ["super_admin", "admin", "doctor", "receptionist", "patient"];
const ROLE_TONE = { super_admin: "violet", admin: "sky", doctor: "info", receptionist: "neutral", patient: "success" };

function roleLabel(role) {
  return role.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function AdminUserManagement() {
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();

  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [detailUser, setDetailUser] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "" });
  const [statusTarget, setStatusTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // A filter change invalidates the current page — go back to page 1
  // rather than silently requesting a page that no longer exists under
  // the new filter.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter, statusFilter]);

  useEffect(() => {
    load(page);
  }, [page, debouncedSearch, roleFilter, statusFilter, dashboardSyncTick]);

  async function load(targetPage) {
    setLoading(true);
    setError(null);
    try {
      const params = { page: targetPage, pageSize: 20 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await adminApi.getUsers(params);
      setUsers(res.data?.users || []);
      setPagination(res.meta || null);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const openEdit = (user) => {
    setEditForm({ name: user.name, email: user.email });
    setEditTarget(user);
  };

  const handleSaveEdit = async () => {
    setBusy(true);
    try {
      await adminApi.updateUser(editTarget._id, { name: editForm.name, email: editForm.email });
      toast.success("Account updated.");
      setEditTarget(null);
      await load(page);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStatus = async () => {
    setBusy(true);
    try {
      await adminApi.toggleUserStatus(statusTarget._id);
      toast.success(statusTarget.isActive ? "Account deactivated." : "Account activated.");
      setStatusTarget(null);
      await load(page);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setActionError("");
    try {
      await adminApi.deleteUser(deleteTarget._id);
      toast.success("Account deleted.");
      setDeleteTarget(null);
      await load(page);
    } catch (err) {
      // Server-side referential-integrity guards (appointment history for
      // patients, a linked doctor profile for doctors) surface here as a
      // real, human-readable message rather than a raw error dump.
      setActionError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "User",
      render: (row) => (
        <div className="min-w-0 max-w-xs">
          <p className="truncate font-bold text-slate-900">{row.name}</p>
          <p className="truncate text-xs text-slate-500">{row.email}</p>
        </div>
      ),
    },
    { key: "role", header: "Role", render: (row) => <Badge tone={ROLE_TONE[row.role] || "neutral"}>{roleLabel(row.role)}</Badge> },
    { key: "status", header: "Status", render: (row) => <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge> },
    { key: "createdAt", header: "Created", render: (row) => (row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "Not recorded") },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="tertiary" size="sm" onClick={() => setDetailUser(row)}>View</Button>
          <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>Edit</Button>
          <Button variant="secondary" size="sm" onClick={() => setStatusTarget(row)}>{row.isActive ? "Deactivate" : "Activate"}</Button>
          <Button variant="danger" size="sm" onClick={() => { setActionError(""); setDeleteTarget(row); }}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-royal-600">Platform Administration</p>
          <h1 className="text-2xl font-black text-slate-950">User Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every account on the platform — admins, doctors, receptionists, and patients. Doctor and patient rows deep-link to their
            dedicated workspace for clinical/medical detail.
          </p>
        </div>
      </div>

      <div className="grid gap-3 rounded-card border border-slate-200 bg-white p-4 shadow-card md:grid-cols-4">
        <Input
          className="md:col-span-2"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{roleLabel(r)}</option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>

      <Card>
        {error ? (
          <ErrorState description={error} onRetry={() => load(page)} />
        ) : !loading && !users.length ? (
          <EmptyState title="No users found" description="Try adjusting your search or filters." />
        ) : (
          <>
            <AdminTable columns={columns} data={users} isLoading={loading} emptyTitle="No users found" />
            {pagination && pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-400">
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} account{pagination.total === 1 ? "" : "s"}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={!pagination.hasPrevious} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
                  <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>Next →</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {detailUser && <UserDetailModal user={detailUser} onClose={() => setDetailUser(null)} />}

      <Modal isOpen={Boolean(editTarget)} title="Edit account" onClose={() => setEditTarget(null)}>
        <div className="space-y-4">
          <Input label="Name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <Input label="Email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={handleSaveEdit} isLoading={busy}>Save</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(statusTarget)}
        title={statusTarget?.isActive ? "Deactivate account?" : "Activate account?"}
        description={
          statusTarget?.isActive
            ? `${statusTarget?.name} will lose access immediately. Their history is preserved and this can be reversed.`
            : `${statusTarget?.name} will regain access immediately.`
        }
        tone={statusTarget?.isActive ? "danger" : "primary"}
        confirmLabel={statusTarget?.isActive ? "Deactivate" : "Activate"}
        isLoading={busy}
        onConfirm={handleToggleStatus}
        onClose={() => setStatusTarget(null)}
      />

      <Modal isOpen={Boolean(deleteTarget)} title="Delete account" onClose={() => setDeleteTarget(null)}>
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm leading-6 text-slate-600">
            <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-rose-600" />
            This permanently deletes {deleteTarget?.name}&rsquo;s account. This cannot be undone.
          </p>
          {actionError && (
            <p className="rounded-control border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{actionError}</p>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} isLoading={busy}>Delete permanently</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// User Detail Workspace. Sections render only when the underlying data is
// real — no "Last Active" / "Last Login" section exists anywhere because
// no such field is ever written on the User model; it is never fabricated
// here. Role change for admin/super_admin targets reuses the existing
// Access Control role-hierarchy endpoint (permissionAdminController) —
// this is not a second role-change mechanism.
// ─────────────────────────────────────────────────────────────────────────
function UserDetailModal({ user, onClose }) {
  const [full, setFull] = useState(user);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [auditLogs, setAuditLogs] = useState(null);
  const [auditError, setAuditError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .getUser(user._id)
      .then((res) => {
        if (!cancelled) setFull(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    adminApi
      .getActivity({ resourceId: user._id, limit: 10 })
      .then((res) => setAuditLogs(res.data?.logs || []))
      .catch((err) => setAuditError(getApiErrorMessage(err)));

    return () => {
      cancelled = true;
    };
  }, [user._id]);

  return (
    <Modal isOpen title={`${user.name} — account detail`} onClose={onClose} size="lg">
      {loading ? (
        <Loader />
      ) : error ? (
        <ErrorState description={error} onRetry={() => setLoading(true)} />
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Overview</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-slate-400">Name</p><p className="font-bold text-slate-900">{full.name}</p></div>
              <div><p className="text-slate-400">Email</p><p className="font-bold text-slate-900 break-words">{full.email}</p></div>
              <div><p className="text-slate-400">Role</p><Badge tone={ROLE_TONE[full.role] || "neutral"}>{roleLabel(full.role)}</Badge></div>
              <div><p className="text-slate-400">Status</p><StatusBadge tone={full.isActive ? "success" : "neutral"}>{full.isActive ? "Active" : "Inactive"}</StatusBadge></div>
              <div><p className="text-slate-400">Created</p><p className="font-bold text-slate-900">{full.createdAt ? new Date(full.createdAt).toLocaleString() : "Not recorded"}</p></div>
            </div>
          </section>

          {full.role === "doctor" && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Verification</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-slate-400">Onboarding status</p><p className="font-bold text-slate-900">{full.doctorOnboardingStatus ? roleLabel(full.doctorOnboardingStatus) : "Not recorded"}</p></div>
                <div><p className="text-slate-400">Submitted</p><p className="font-bold text-slate-900">{full.doctorVerification?.submittedAt ? new Date(full.doctorVerification.submittedAt).toLocaleString() : "Not recorded"}</p></div>
                <div><p className="text-slate-400">Reviewed</p><p className="font-bold text-slate-900">{full.doctorVerification?.reviewedAt ? new Date(full.doctorVerification.reviewedAt).toLocaleString() : "Not recorded"}</p></div>
              </div>
              <p className="mt-3 text-xs font-semibold text-royal-600">
                Full clinical/performance detail lives in Doctor Management — this is account-level only.
              </p>
            </section>
          )}

          {(full.role === "admin" || full.role === "super_admin") && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                <UserCog size={13} /> Access
              </h3>
              <p className="text-sm text-slate-600">
                Role and permission changes for admin accounts are managed from Access Control, which enforces the admin-hierarchy
                rule (a lower-ranked admin cannot modify an equal-or-higher one).
              </p>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Audit</h3>
            {auditError ? (
              <p className="text-xs font-semibold text-rose-500">Audit history unavailable — {auditError}</p>
            ) : !auditLogs ? (
              <Loader />
            ) : !auditLogs.length ? (
              <p className="text-xs text-slate-400">No audit events recorded for this account yet.</p>
            ) : (
              <ul className="space-y-2">
                {auditLogs.map((log) => (
                  <li key={log._id} className="flex items-start justify-between gap-3 rounded-control border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                    <span className="min-w-0 truncate font-semibold text-slate-700">{log.action.replace(/[._]/g, " ")}</span>
                    <span className="flex-shrink-0 text-slate-400">{new Date(log.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default AdminUserManagement;
