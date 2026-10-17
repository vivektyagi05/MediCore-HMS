import { Plus, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { financeApi } from "../../../api/financeApi";
import { getApiErrorMessage } from "../../../api/axios";
import EmptyState from "../../../components/shared/EmptyState";
import ErrorState from "../../../components/shared/ErrorState";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import Input from "../../../components/ui/Input";
import Loader from "../../../components/ui/Loader";
import Modal from "../../../components/ui/Modal";
import Select from "../../../components/ui/Select";
import StatusBadge from "../../../components/ui/StatusBadge";
import { useToast } from "../../../context/ToastContext";

const EMPTY = { code: "", type: "percentage", value: "", maxDiscount: "", expiresAt: "", usageLimit: "1", description: "" };
const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
// Server validation is authoritative; these checks only avoid an obviously wasted round trip.
const localErrors = (form, isCreate) => {
  const errors = {};
  if (isCreate && !/^[A-Za-z0-9_-]{3,30}$/.test(form.code.trim())) errors.code = "3-30 letters, digits, _ or -";
  const value = Number(form.value);
  if (!(value > 0)) errors.value = "Enter a value greater than zero";
  else if (form.type === "percentage" && value > 100) errors.value = "A percentage cannot exceed 100";
  if (!form.expiresAt) errors.expiresAt = "Choose an expiry date";
  if (!Number.isInteger(Number(form.usageLimit)) || Number(form.usageLimit) < 1) errors.usageLimit = "Whole number, at least 1";
  return errors;
};

// Existing coupon API (/finance/coupons) had no admin UI. Usage is server-computed:
// reserved (order open) vs redeemed (payment captured) are shown separately.
function CouponManager() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null); // null | {mode: 'create'|'edit', coupon?}
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [usage, setUsage] = useState(null);
  const [togglingId, setTogglingId] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      setData((await financeApi.getCoupons({ page, limit: 15, status: status || undefined, search: search.trim() || undefined })).data);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [page, status, search]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY); setErrors({}); setEditing({ mode: "create" }); };
  const openEdit = (coupon) => {
    setForm({ code: coupon.code, type: coupon.type, value: String(coupon.value), maxDiscount: coupon.maxDiscount ? String(coupon.maxDiscount) : "", expiresAt: dateInput(coupon.expiresAt), usageLimit: String(coupon.usageLimit), description: coupon.description || "" });
    setErrors({});
    setEditing({ mode: "edit", coupon });
  };
  const set = (field) => (e) => { setForm((f) => ({ ...f, [field]: e.target.value })); setErrors((er) => ({ ...er, [field]: undefined })); };

  const save = async () => {
    if (isSaving) return;
    const isCreate = editing.mode === "create";
    const found = localErrors(form, isCreate);
    setErrors(found);
    if (Object.keys(found).length) return;
    setIsSaving(true);
    try {
      const payload = { value: Number(form.value), expiresAt: form.expiresAt, usageLimit: Number(form.usageLimit), description: form.description.trim() || undefined, maxDiscount: form.type === "percentage" && form.maxDiscount ? Number(form.maxDiscount) : undefined };
      if (isCreate) await financeApi.createCoupon({ ...payload, code: form.code.trim(), type: form.type });
      else await financeApi.updateCoupon(editing.coupon._id, payload);
      toast.success(isCreate ? "Coupon created" : "Coupon updated");
      setEditing(null);
      await load();
    } catch (error) {
      const serverErrors = error?.response?.data?.details?.errors;
      if (Array.isArray(serverErrors)) setErrors(Object.fromEntries(serverErrors.map((e) => [e.field, e.message])));
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = async (coupon) => {
    if (togglingId) return;
    setTogglingId(coupon._id);
    try {
      await financeApi.updateCoupon(coupon._id, { isActive: !coupon.isActive });
      toast.success(coupon.isActive ? "Coupon deactivated" : "Coupon activated");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setTogglingId("");
    }
  };

  const showUsage = async (coupon) => {
    setUsage({ loading: true, code: coupon.code });
    try {
      setUsage({ ...(await financeApi.getCouponUsage(coupon._id)).data, loading: false });
    } catch (error) {
      setUsage(null);
      toast.error(getApiErrorMessage(error));
    }
  };

  if (isLoading && !data) return <Loader label="Loading coupons" />;
  if (loadError) return <ErrorState description={loadError} onRetry={load} />;
  const isCreate = editing?.mode === "create";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="w-52"><Input label="Search code" name="coupon-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="e.g. SAVE" /></div>
          <div className="w-40"><Select label="Status" name="coupon-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCcw size={14} /> Refresh</Button>
          <Button size="sm" onClick={openCreate}><Plus size={14} /> New coupon</Button>
        </div>
      </div>

      {data.coupons.length === 0 ? (
        <EmptyState title="No coupons found" description="Create a coupon, or adjust the filters." />
      ) : (
        <div className="space-y-2">
          {data.coupons.map((coupon) => {
            const expired = new Date(coupon.expiresAt) < new Date();
            return (
              <Card key={coupon._id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-mono text-base font-bold text-slate-950">
                      {coupon.code}
                      <StatusBadge tone={!coupon.isActive ? "neutral" : expired ? "warning" : "success"}>{!coupon.isActive ? "inactive" : expired ? "expired" : "active"}</StatusBadge>
                    </p>
                    <p className="text-xs text-slate-500">
                      {coupon.type === "percentage" ? `${coupon.value}%${coupon.maxDiscount ? ` (max ₹${coupon.maxDiscount})` : ""}` : `₹${coupon.value}`} · expires {new Date(coupon.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-xs text-slate-600">
                    <p><span className="font-bold">{coupon.usage.reserved}</span> reserved · <span className="font-bold">{coupon.usage.redeemed}</span> redeemed{coupon.usage.legacyUnclassified ? ` · ${coupon.usage.legacyUnclassified} legacy` : ""}</p>
                    <p>{coupon.usage.usedCount}/{coupon.usageLimit} slots used · {coupon.usage.released} released · {coupon.rejectedCount || 0} rejected{coupon.usage.consistent ? "" : " · counter mismatch"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="tertiary" onClick={() => showUsage(coupon)}>Usage</Button>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(coupon)}>Edit</Button>
                    <Button size="sm" variant={coupon.isActive ? "danger" : "primary"} isLoading={togglingId === coupon._id} onClick={() => toggle(coupon)}>{coupon.isActive ? "Deactivate" : "Activate"}</Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">Page {data.pagination.page} of {Math.max(data.pagination.pages, 1)} · {data.pagination.total} coupons</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      <Modal isOpen={Boolean(editing)} title={isCreate ? "New coupon" : `Edit ${editing?.coupon?.code || ""}`} onClose={() => !isSaving && setEditing(null)}>
        <div className="space-y-3">
          {isCreate && <Input label="Code" name="code" required value={form.code} error={errors.code} onChange={set("code")} />}
          {isCreate && <Select label="Type" name="type" value={form.type} onChange={set("type")}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></Select>}
          <Input label={form.type === "percentage" ? "Discount (%)" : "Discount (₹)"} name="value" type="number" min="0" step="0.01" required value={form.value} error={errors.value} onChange={set("value")} />
          {form.type === "percentage" && <Input label="Maximum discount (₹, optional)" name="maxDiscount" type="number" min="0" step="0.01" value={form.maxDiscount} error={errors.maxDiscount} onChange={set("maxDiscount")} />}
          <Input label="Expires on" name="expiresAt" type="date" required value={form.expiresAt} error={errors.expiresAt} onChange={set("expiresAt")} />
          <Input label="Total usage limit" name="usageLimit" type="number" min="1" step="1" required value={form.usageLimit} error={errors.usageLimit} onChange={set("usageLimit")} helperText={isCreate ? undefined : `Cannot be lower than current usage (${editing?.coupon?.usedCount ?? 0}).`} />
          <Input label="Description (optional)" name="description" value={form.description} onChange={set("description")} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setEditing(null)} disabled={isSaving}>Cancel</Button>
          <Button onClick={save} isLoading={isSaving}>{isCreate ? "Create coupon" : "Save changes"}</Button>
        </div>
      </Modal>

      <Modal isOpen={Boolean(usage)} size="lg" title={`Usage — ${usage?.code || usage?.coupon?.code || ""}`} onClose={() => setUsage(null)}>
        {usage?.loading ? <Loader label="Loading usage" /> : usage && (
          <div className="space-y-4 text-sm">
            <p>{usage.usage.reserved} reserved · {usage.usage.redeemed} redeemed · {usage.usage.released} released · {usage.coupon.rejectedCount} rejected{usage.coupon.lastRejectionCode ? ` (last: ${usage.coupon.lastRejectionCode})` : ""}</p>
            <div>
              <p className="mb-1 font-bold text-slate-900">Current uses (latest 100)</p>
              {usage.entries.length === 0 ? <p className="text-slate-500">No active uses.</p> : usage.entries.map((e, i) => (
                <p key={`${e.paymentId}-${i}`} className="flex justify-between border-b border-slate-100 py-1 text-xs"><span className="font-mono">{e.paymentId}</span><span>{e.state}{e.redeemedAt ? ` · ${new Date(e.redeemedAt).toLocaleString()}` : ""}</span></p>
              ))}
            </div>
            <div>
              <p className="mb-1 font-bold text-slate-900">Admin audit history</p>
              {usage.history.length === 0 ? <p className="text-slate-500">No admin changes recorded.</p> : usage.history.map((h, i) => (
                <p key={i} className="border-b border-slate-100 py-1 text-xs"><span className="font-bold">{h.action}</span> · {h.actor?.name || "system"} · {new Date(h.at).toLocaleString()}</p>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default CouponManager;
