import { RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../../api/adminApi";
import { getApiErrorMessage } from "../../../api/axios";
import EmptyState from "../../../components/shared/EmptyState";
import ErrorState from "../../../components/shared/ErrorState";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import Loader from "../../../components/ui/Loader";
import StatusBadge from "../../../components/ui/StatusBadge";
import Textarea from "../../../components/ui/Textarea";
import { useToast } from "../../../context/ToastContext";

const inr = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format((paise || 0) / 100);
const ACTIONS = {
  release: { label: "Release hold", tone: "danger", help: "Returns the held amount to the patient's available balance. The server refuses this if the payment could still be captured." },
  commit: { label: "Commit debit", tone: "primary", help: "Posts the wallet debit for a payment that was captured. Goes through the canonical wallet service." },
};
const validateReason = (value) => {
  const text = value.trim();
  if (text.length < 10) return "Enter a reason of at least 10 characters.";
  if (text.length > 300) return "Reason must be 300 characters or fewer.";
  return "";
};

// Wallet reservations flagged recovery_required. The backend (Phase 02) decides which
// actions are legal; this screen never edits a balance and never shows success until the
// server accepts the decision and the refetched list no longer contains the case.
function WalletReservationReview() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState("release");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await adminApi.getWalletReservationsAdmin({ limit: 100 });
      setRows(res.data.reservations || []);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const choose = (row) => { setSelected(row); setAction("release"); setReason(""); setReasonError(""); };
  const requestConfirm = () => {
    const error = validateReason(reason);
    setReasonError(error);
    if (!error) setConfirming(true);
  };
  const submit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await adminApi.resolveWalletReservationAdmin(selected.paymentId, { action, reason: reason.trim() });
      toast.success(`Decision recorded by the server: ${res.data.outcome}`);
      setConfirming(false);
      setSelected(null);
    } catch (error) {
      // 409 = someone else resolved it / state changed: refresh so the operator sees the truth.
      toast.error(getApiErrorMessage(error));
      setConfirming(false);
    } finally {
      setIsSubmitting(false);
      await load();
    }
  };

  if (isLoading) return <Loader label="Loading wallet reservations" />;
  if (loadError) return <ErrorState description={loadError} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-600">
          Wallet holds the system could not settle on its own. Each decision is checked and executed by the canonical
          wallet service and written to the admin audit log.
        </p>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCcw size={14} /> Refresh</Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No reservations need review" description="Every wallet hold is either active, committed or released." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2" role="list" aria-label="Reservations needing review">
            {rows.map((row) => (
              <button
                type="button" role="listitem" key={row.paymentId} onClick={() => choose(row)}
                className={`w-full rounded-card border bg-white p-3 text-left transition hover:border-royal-300 ${selected?.paymentId === row.paymentId ? "border-royal-500 ring-2 ring-royal-100" : "border-slate-200"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs text-slate-500">{row.paymentId}</p>
                  <StatusBadge tone="warning">recovery required</StatusBadge>
                </div>
                <p className="mt-1 text-lg font-bold text-slate-950">{inr(row.amountPaise)}</p>
                <p className="text-xs text-slate-500">{row.recoveryAttempts} recovery attempts · updated {new Date(row.updatedAt).toLocaleString()}</p>
              </button>
            ))}
          </div>

          <Card title={selected ? "Review decision" : "Select a reservation"}>
            {!selected ? (
              <p className="text-sm text-slate-500">Choose a reservation to see its evidence and the actions the server allows.</p>
            ) : (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-slate-500">Payment</dt><dd className="break-all font-mono text-xs">{selected.paymentId}</dd></div>
                  <div><dt className="text-xs text-slate-500">Held amount</dt><dd className="font-bold">{inr(selected.amountPaise)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Recovery attempts</dt><dd>{selected.recoveryAttempts}</dd></div>
                  <div><dt className="text-xs text-slate-500">Last updated</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd></div>
                  <div className="col-span-2"><dt className="text-xs text-slate-500">Last error</dt><dd>{selected.lastError || "None recorded"}</dd></div>
                </dl>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-700">Action</legend>
                  {Object.entries(ACTIONS).map(([key, def]) => (
                    <label key={key} className="flex cursor-pointer items-start gap-2 rounded-card border border-slate-200 p-3 text-sm">
                      <input type="radio" name="reservation-action" checked={action === key} onChange={() => setAction(key)} className="mt-1" />
                      <span><span className="font-bold text-slate-900">{def.label}</span><br /><span className="text-xs text-slate-500">{def.help}</span></span>
                    </label>
                  ))}
                </fieldset>
                <Textarea
                  label="Reason (recorded in the audit log)" name="reservation-reason" required rows={3}
                  value={reason} error={reasonError} onChange={(e) => { setReason(e.target.value); setReasonError(""); }}
                />
                <Button onClick={requestConfirm} disabled={isSubmitting}>Review &amp; confirm</Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirming && Boolean(selected)} tone={ACTIONS[action].tone} isLoading={isSubmitting}
        title={`${ACTIONS[action].label} for ${selected ? inr(selected.amountPaise) : ""}?`}
        description={`${ACTIONS[action].help} This is recorded against your account and cannot be undone from this screen.`}
        confirmLabel={ACTIONS[action].label} onConfirm={submit} onClose={() => !isSubmitting && setConfirming(false)}
      />
    </div>
  );
}

export default WalletReservationReview;
