import { useEffect, useState } from "react";
import { ShieldCheck, Users2 } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useAuth } from "../../context/AuthContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Badge from "../../components/ui/Badge";
import Checkbox from "../../components/ui/Checkbox";
import Loader from "../../components/ui/Loader";
import ErrorState from "../../components/shared/ErrorState";
import EmptyState from "../../components/shared/EmptyState";
import Tabs from "../../components/ui/Tabs";

// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-14, PARTS B2 + B3 — Roles & Permissions / Admin Access Control.
//
// permissionAdminController.js (listPermissions/updateRolePermissions/
// listAdmins/updateAdminRole) was already real, audited (writeAdminLog)
// and even wired into Automation Studio's ROLE_CHANGED trigger — but had
// zero frontend consumers anywhere, even though adminApi.js already
// carried dead client methods for it. This page is the one workspace for
// both: the Permission Matrix and the Admin Hierarchy are two views over
// the same underlying access-control system, not two engines.
// Never a second permission system, never a fabricated matrix cell.
// ─────────────────────────────────────────────────────────────────────────

const ROLE_TONE = { super_admin: "violet", doctor: "info", patient: "success" };

function roleLabel(role) {
  return role.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function permissionLabel(key) {
  return key.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function AdminAccessControl() {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const { dashboardSyncTick } = useRealtime();
  const [tab, setTab] = useState("permissions");

  // Permission matrix
  const [permissions, setPermissions] = useState([]);
  const [permissionKeys, setPermissionKeys] = useState([]);
  const [loadingPerms, setLoadingPerms] = useState(true);
  const [permsError, setPermsError] = useState(null);
  const [savingCell, setSavingCell] = useState(null);

  // Admin hierarchy
  const [admins, setAdmins] = useState([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [adminsError, setAdminsError] = useState(null);

  // PHASE 2-D: there is no "admin" role to demote a super_admin to (see
  // constants/roles.js), so the old per-row promote/demote dropdown is
  // replaced with a one-way promotion flow: search an existing user, then
  // promote them to super_admin. This is the only mutation
  // updateAdminRole still supports.
  const [promoteQuery, setPromoteQuery] = useState("");
  const [promoteResults, setPromoteResults] = useState([]);
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteError, setPromoteError] = useState(null);
  const [promoteBusyId, setPromoteBusyId] = useState(null);

  useEffect(() => {
    loadPermissions();
    loadAdmins();
  }, [dashboardSyncTick]);

  async function loadPermissions() {
    setLoadingPerms(true);
    setPermsError(null);
    try {
      const res = await adminApi.getPermissions();
      setPermissions(res.data?.permissions || []);
      setPermissionKeys(res.data?.permissionKeys || []);
    } catch (err) {
      setPermsError(getApiErrorMessage(err));
    } finally {
      setLoadingPerms(false);
    }
  }

  async function loadAdmins() {
    setLoadingAdmins(true);
    setAdminsError(null);
    try {
      const res = await adminApi.getAdmins();
      setAdmins(res.data?.admins || []);
    } catch (err) {
      setAdminsError(getApiErrorMessage(err));
    } finally {
      setLoadingAdmins(false);
    }
  }

  async function toggleCell(roleEntry, key) {
    const cellId = `${roleEntry.role}:${key}`;
    setSavingCell(cellId);
    const nextValue = !roleEntry.permissions?.[key];
    try {
      await adminApi.updatePermissions(roleEntry.role, { ...roleEntry.permissions, [key]: nextValue });
      toast.success(`${permissionLabel(key)} ${nextValue ? "enabled" : "disabled"} for ${roleLabel(roleEntry.role)}.`);
      await loadPermissions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSavingCell(null);
    }
  }

  async function searchPromotable(query) {
    setPromoteQuery(query);
    setPromoteError(null);
    if (!query.trim()) {
      setPromoteResults([]);
      return;
    }
    setPromoteLoading(true);
    try {
      const res = await adminApi.getUsers({ search: query.trim(), pageSize: 5 });
      const candidates = (res.data?.users || []).filter((u) => u.role !== "super_admin");
      setPromoteResults(candidates);
    } catch (err) {
      setPromoteError(getApiErrorMessage(err));
    } finally {
      setPromoteLoading(false);
    }
  }

  async function promoteUser(user) {
    setPromoteBusyId(user._id);
    try {
      await adminApi.updateAdminRole(user._id, "super_admin");
      toast.success(`${user.name} is now a Super Admin.`);
      setPromoteResults((prev) => prev.filter((u) => u._id !== user._id));
      await loadAdmins();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setPromoteBusyId(null);
    }
  }

  const tabs = [
    { id: "permissions", label: "Permission Matrix" },
    { id: "hierarchy", label: "Admin Hierarchy" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-royal-600">Platform Administration</p>
        <h1 className="text-2xl font-black text-slate-950">Access Control</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every capability toggle here enforces on the backend — hiding an action in a role&rsquo;s UI is never the actual security
          boundary.
        </p>
      </div>

      <Tabs tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === "permissions" && (
        <Card
          title={
            <span className="flex items-center gap-2"><ShieldCheck size={17} className="text-royal-600" /> Permission Matrix</span>
          }
        >
          {loadingPerms ? (
            <Loader />
          ) : permsError ? (
            <ErrorState description={permsError} onRetry={loadPermissions} />
          ) : !permissions.length ? (
            <EmptyState title="No roles configured" description="Roles will appear once the permission system is initialized." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-bold">Permission</th>
                    {permissions.map((p) => (
                      <th key={p.role} className="px-4 py-3 text-center font-bold">
                        <Badge tone={ROLE_TONE[p.role] || "neutral"}>{roleLabel(p.role)}</Badge>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {permissionKeys.map((key) => (
                    <tr key={key}>
                      <td className="px-4 py-3 font-semibold text-slate-700">{permissionLabel(key)}</td>
                      {permissions.map((p) => {
                        const cellId = `${p.role}:${key}`;
                        const isSuperAdmin = p.role === "super_admin";
                        return (
                          <td key={p.role} className="px-4 py-3 text-center">
                            <Checkbox
                              checked={isSuperAdmin ? true : Boolean(p.permissions?.[key])}
                              disabled={isSuperAdmin || savingCell === cellId}
                              onChange={() => toggleCell(p, key)}
                              aria-label={`${permissionLabel(key)} for ${roleLabel(p.role)}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs font-semibold text-slate-400">
                Super Admin always has every permission and cannot be restricted from here.
              </p>
            </div>
          )}
        </Card>
      )}

      {tab === "hierarchy" && (
        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2"><Users2 size={17} className="text-royal-600" /> Promote to Super Admin</span>}>
            <p className="mb-3 text-sm text-slate-500">
              There is no intermediate admin tier — search for an existing user and grant them Super Admin directly.
            </p>
            <Input
              placeholder="Search by name or email…"
              value={promoteQuery}
              onChange={(e) => searchPromotable(e.target.value)}
            />
            {promoteError && (
              <p className="mt-2 text-xs font-semibold text-rose-600">{promoteError}</p>
            )}
            {promoteLoading ? (
              <div className="mt-3"><Loader /></div>
            ) : promoteResults.length > 0 ? (
              <div className="mt-3 space-y-2">
                {promoteResults.map((u) => (
                  <div key={u._id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-slate-200 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{u.name}</p>
                      <p className="truncate text-xs text-slate-500">{u.email} · <Badge tone={ROLE_TONE[u.role] || "neutral"}>{roleLabel(u.role)}</Badge></p>
                    </div>
                    <Button
                      variant="secondary"
                      isLoading={promoteBusyId === u._id}
                      onClick={() => promoteUser(u)}
                    >
                      Promote to Super Admin
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card title={<span className="flex items-center gap-2"><Users2 size={17} className="text-royal-600" /> Super Admins</span>}>
          {loadingAdmins ? (
            <Loader />
          ) : adminsError ? (
            <ErrorState description={adminsError} onRetry={loadAdmins} />
          ) : !admins.length ? (
            <EmptyState title="No admin accounts found" />
          ) : (
            <div className="space-y-3">
              {admins.map((admin) => {
                const isSelf = admin._id === currentUser?._id;
                return (
                  <div key={admin._id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-slate-200 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{admin.name}</p>
                      <p className="truncate text-xs text-slate-500">{admin.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={ROLE_TONE[admin.role] || "neutral"}>{roleLabel(admin.role)}</Badge>
                      {isSelf && (
                        <span className="text-xs font-semibold text-slate-400">This is you</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default AdminAccessControl;
