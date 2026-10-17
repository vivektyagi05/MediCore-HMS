import { ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import Textarea from "../../components/ui/Textarea";
import { useToast } from "../../context/ToastContext";
import {
  REASON_MAX,
  availableActions,
  caseKindLabel,
  caseKindTone,
  dispositionLabel,
  formatPaise,
  interpretResolutionError,
  isResolvable,
  successMessage,
  validateReason,
} from "../../utils/captureCaseDisplay";

const FILTERS = [
  { value: "unresolved", label: "Unresolved (open + insufficient evidence)" },
  { value: "resolved", label: "Resolved (decision recorded)" },
  { value: "all", label: "All cases" },
];
const caseKey = (c) => `${c.paymentId}:${c.gatewayPaymentId}:${c.disposition}`;
const when = (value) => (value ? new Date(value).toLocaleString("en-IN") : "—");

function AdminCaptureCases() {
  const toast = useToast();
  const [filter, setFilter] = useState("unresolved");
  const [cases, setCases] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [banner, setBanner] = useState(null); // { tone, text } — stale / conflict / evidence messages inside the dialog
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await adminApi.getCaptureCasesAdmin({ state: filter, limit: 100 });
      setCases(response.data?.cases || []);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // The selected case is always re-derived from the authoritative list, never from a stale copy.
  const selected = cases.find((c) => caseKey(c) === selectedKey) || null;
  const actions = availableActions(selected);

  const openCase = (c) => {
    setSelectedKey(caseKey(c));
    setAction("");
    setReason("");
    setReasonError("");
    setBanner(null);
  };
  const closeDialog = () => { if (!isSubmitting) { setSelectedKey(null); setBanner(null); } };

  const submit = async () => {
    if (inFlight.current || !selected) return; // never double-submit
    const error = validateReason(reason);
    if (!action) { setBanner({ tone: "warning", text: "Choose a decision first." }); return; }
    if (error) { setReasonError(error); return; }
    inFlight.current = true;
    setIsSubmitting(true);
    setBanner(null);
    try {
      await adminApi.resolveCaptureCaseAdmin(selected.paymentId, {
        gatewayPaymentId: selected.gatewayPaymentId,
        disposition: selected.disposition,
        action,
        reason: reason.trim(),
      });
      toast.success(successMessage(action));
      setSelectedKey(null);
      await load(); // authoritative state, never an optimistic local edit
    } catch (submitError) {
      const outcome = interpretResolutionError(submitError);
      setBanner({ tone: outcome.kind === "stale" ? "warning" : "danger", text: outcome.message });
      if (outcome.refetch) await load();
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const columns = [
    {
      key: "evidence",
      header: "Provider evidence",
      render: (c) => (
        <div>
          <p className="font-mono text-xs font-bold text-slate-950">{c.gatewayPaymentId}</p>
          <p className="text-xs text-slate-500">Order {c.gatewayOrderId || "—"}{c.attemptNumber != null ? ` · attempt ${c.attemptNumber}` : ""}</p>
        </div>
      ),
    },
    { key: "amount", header: "Captured", render: (c) => <span className="font-bold text-slate-950">{formatPaise(c.amountPaise, c.currency)}</span> },
    {
      key: "refs",
      header: "References",
      render: (c) => (
        <div className="text-xs text-slate-600">
          <p>Payment <span className="font-mono">{c.paymentId}</span> ({c.paymentState})</p>
          <p>Appointment <span className="font-mono">{c.appointmentId || "—"}</span></p>
        </div>
      ),
    },
    { key: "why", header: "What happened", render: (c) => <span className="text-xs text-slate-700">{dispositionLabel(c.disposition)}</span> },
    { key: "state", header: "Resolution", render: (c) => <StatusBadge tone={caseKindTone(c)}>{caseKindLabel(c)}</StatusBadge> },
    { key: "time", header: "Event time", render: (c) => <span className="text-xs text-slate-600">{when(c.eventAt)}</span> },
    {
      key: "action",
      header: "",
      render: (c) => (
        <Button size="sm" variant={isResolvable(c) ? "primary" : "secondary"} onClick={() => openCase(c)}>
          {isResolvable(c) ? "Review" : "View"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Finance"
        title="Capture cases"
        description="Provider captures that could not be applied normally (duplicate, late, or mismatched). Recording a decision here never refunds, credits or pays anyone."
      />

      <Card>
        <div className="max-w-md">
          <Select label="Show" name="capture-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
            {FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
      </Card>

      {loadError ? (
        <ErrorState title="Capture cases could not be loaded" description={loadError} onRetry={load} />
      ) : (
        <AdminTable
          columns={columns}
          data={cases}
          rowKey={caseKey}
          isLoading={isLoading}
          emptyTitle={filter === "unresolved" ? "No unresolved capture cases" : "No capture cases"}
          emptyDescription="Duplicate or unapplicable provider captures will appear here when the payment system records them."
        />
      )}

      <AdminModal isOpen={Boolean(selected)} title="Review capture case" onClose={closeDialog} size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="rounded-control border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={caseKindTone(selected)}>{caseKindLabel(selected)}</StatusBadge>
                <span className="text-slate-600">{dispositionLabel(selected.disposition)}</span>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Provider payment</dt><dd className="font-mono text-xs">{selected.gatewayPaymentId}</dd></div>
                <div><dt className="text-xs text-slate-500">Provider order</dt><dd className="font-mono text-xs">{selected.gatewayOrderId || "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Captured amount</dt><dd className="font-bold">{formatPaise(selected.amountPaise, selected.currency)}</dd></div>
                <div><dt className="text-xs text-slate-500">Payment total</dt><dd>{formatPaise(selected.paymentTotalPaise, selected.currency)}</dd></div>
                <div><dt className="text-xs text-slate-500">Payment state</dt><dd>{selected.paymentState}{selected.reconciliationState ? ` · reconciliation ${selected.reconciliationState}` : ""}</dd></div>
                <div><dt className="text-xs text-slate-500">Event time</dt><dd>{when(selected.eventAt)}</dd></div>
                {selected.resolutionReason && (
                  <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Recorded reason{selected.resolvedAt ? ` (${when(selected.resolvedAt)})` : ""}</dt><dd>{selected.resolutionReason}</dd></div>
                )}
                {selected.providerStatus && <div><dt className="text-xs text-slate-500">Provider status at resolution</dt><dd>{selected.providerStatus}</dd></div>}
              </dl>
            </div>

            {banner && (
              <div role="alert" className={`flex items-start gap-2 rounded-control border p-3 text-sm font-semibold ${banner.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{banner.text}</span>
              </div>
            )}

            {actions.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                This case is resolved.{selected.resolutionState === "refund_required" ? " A refund has NOT been issued by this decision; use the refund request flow." : ""}
              </p>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-700">Decision</legend>
                  {actions.map((option) => (
                    <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-control border border-slate-200 p-3 text-sm has-[:checked]:border-royal-600">
                      <input type="radio" name="capture-action" className="mt-1" value={option.value} checked={action === option.value} onChange={() => setAction(option.value)} disabled={isSubmitting} />
                      <span><span className="block font-bold text-slate-950">{option.label}</span><span className="text-xs text-slate-600">{option.help}</span></span>
                    </label>
                  ))}
                </fieldset>
                <Textarea
                  label="Reason (kept in the audit log)"
          name="capture-reason"
                  required
                  rows={3}
                  maxLength={REASON_MAX}
                  value={reason}
                  error={reasonError}
                  disabled={isSubmitting}
                  onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(""); }}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={closeDialog} disabled={isSubmitting}>Close</Button>
                  <Button onClick={submit} isLoading={isSubmitting} disabled={isSubmitting}>Record decision</Button>
                </div>
              </>
            )}
          </div>
        )}
      </AdminModal>
    </div>
  );
}

export default AdminCaptureCases;
