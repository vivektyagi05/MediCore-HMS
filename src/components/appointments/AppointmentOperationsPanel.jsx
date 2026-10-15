import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, LogIn, WifiOff } from "lucide-react";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { isStaleStateError } from "../../utils/appointmentErrors";
import { describeOperationalState, OPERATIONAL_TONE } from "../../utils/appointmentOperationalState";
import { useAppointmentSync } from "../../hooks/useAppointmentSync";
import { useToast } from "../../context/ToastContext";
import Button from "../ui/Button";

const REASON_TEXT = {
  CHECKIN_NOT_OPEN: "Check-in opens shortly before your appointment.",
  PAYMENT_REQUIRED: "Complete payment to enable check-in.",
};

/**
 * Patient-side operational state + actions. Every button is rendered from
 * the server's /actions verdicts — the UI never decides eligibility itself.
 * Stays correct across reconnects (refetches) and shows an honest offline banner.
 */
export default function AppointmentOperationsPanel({ appointmentId, onChanged, onActionsLoaded }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await appointmentApi.getAllowedActions(appointmentId);
      setState(res.data); setError(""); onActionsLoaded?.(res.data);
    } catch (err) { setError(getApiErrorMessage(err)); }
    finally { setLoading(false); }
  }, [appointmentId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  const { connectionStatus, isLive } = useAppointmentSync(async () => { await load(); onChanged?.(); }, { filterId: appointmentId });

  const run = async (key, fn, success) => {
    setBusy(key);
    try { await fn(); toast.success(success); await load(); onChanged?.(); }
    catch (err) {
      toast.error(getApiErrorMessage(err));
      if (isStaleStateError(err)) { await load(); onChanged?.(); } // our screen was stale → re-read the truth
    } finally { setBusy(""); }
  };

  if (loading) return <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} />Checking appointment state…</div>;
  if (error && !state) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button className="font-bold underline" onClick={load}>Retry</button></div>;
  if (!state) return null;

  const view = describeOperationalState(state);
  const a = state.actions || {};
  const checkIn = a.check_in;
  const reportDoctor = a.report_doctor_no_show;

  return (
    <section aria-label="Appointment status" className="space-y-3">
      {!isLive && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          <WifiOff size={14} />{connectionStatus === "connecting" ? "Connecting to live updates…" : "Live updates are offline. This screen refreshes when you reconnect."}
        </div>
      )}
      <div className={`rounded-xl border p-4 ${OPERATIONAL_TONE[view.tone]}`}>
        <div className="flex items-center gap-2 text-sm font-black"><CheckCircle2 size={16} />{view.label}</div>
        {view.detail && <p className="mt-1 text-sm">{view.detail}</p>}
        {state.impact && <p className="mt-2 flex items-center gap-2 text-sm font-bold"><AlertTriangle size={14} />The doctor's {state.impact.type === "leave" ? "availability" : "schedule"} changed. Please reschedule or cancel this appointment.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {checkIn?.allowed && <Button disabled={busy === "checkin"} onClick={() => run("checkin", () => appointmentApi.checkIn(appointmentId), "You're checked in")}><LogIn size={15} />Check in</Button>}
        {!checkIn?.allowed && state.status === "payment_completed" && REASON_TEXT[checkIn?.code] && <p className="text-xs text-slate-500">{REASON_TEXT[checkIn.code]}</p>}
        {reportDoctor?.allowed && <Button variant="secondary" className="border-red-300 text-red-600" disabled={busy === "docnoshow"} onClick={() => { if (window.confirm("Report that the doctor did not start your consultation? A refund request will be raised.")) run("docnoshow", () => appointmentApi.reportDoctorNoShow(appointmentId), "Reported. A refund request was raised."); }}>Doctor hasn't started</Button>}
      </div>
    </section>
  );
}
