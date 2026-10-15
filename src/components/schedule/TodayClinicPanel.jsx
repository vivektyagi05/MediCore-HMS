import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock3, Loader2, PhoneCall, RefreshCw, Users, WifiOff } from "lucide-react";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { isStaleStateError } from "../../utils/appointmentErrors";
import { useAppointmentSync } from "../../hooks/useAppointmentSync";
import { useToast } from "../../context/ToastContext";
import Card from "../ui/Card";
import Button from "../ui/Button";
import ResolveAppointmentDialog from "./ResolveAppointmentDialog";

const ALERT_TEXT = {
  NEEDS_RESOLUTION: (a) => `${a.count} appointment(s) need resolution`,
  CALENDAR_IMPACT: (a) => `${a.count} booked appointment(s) no longer fit your calendar — reschedule or cancel them`,
  OUTSIDE_SCHEDULE: (a) => `${a.count} appointment(s) today fall outside your working hours`,
  DOUBLE_BOOKED: (a) => `${a.count} double-booked slot(s) today`,
  RUNNING_LATE: (a) => `You are running about ${a.minutes} minutes behind`,
  ON_LEAVE_WITH_APPOINTMENTS: (a) => `You are on approved leave but have ${a.count} appointment(s) today`,
};

const Tile = ({ label, value, sub }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-black text-slate-900">{value ?? "—"}</p>
    {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
  </div>
);

/** Doctor's operational dashboard. Every number is computed by the backend from persisted data. */
export default function TodayClinicPanel() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolveItem, setResolveItem] = useState(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try { const res = await appointmentApi.getTodayClinic(); setData(res.data); setError(""); }
    catch (err) { setError(getApiErrorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const { isLive, connectionStatus } = useAppointmentSync(load);

  const call = async (item) => {
    setBusyId(item.appointmentId);
    try { await appointmentApi.callPatient(item.appointmentId); toast.success(`Called ${item.patientName}`); await load(); }
    catch (err) { toast.error(getApiErrorMessage(err)); if (isStaleStateError(err)) await load(); }
    finally { setBusyId(""); }
  };

  if (loading) return <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} />Loading today's clinic…</div>;
  if (error && !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button className="font-bold underline" onClick={load}>Retry</button></div>;
  if (!data) return null;
  const c = data.counts;

  return (
    <section aria-label="Today's clinic" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-black text-slate-900">Today's clinic</h2><p className="text-xs text-slate-500">{data.date} · {data.timezone}</p></div>
        <div className="flex items-center gap-2">
          {!isLive && <span role="status" className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800"><WifiOff size={12} />{connectionStatus === "connecting" ? "Connecting…" : "Offline — refreshes on reconnect"}</span>}
          <Button variant="secondary" onClick={load}><RefreshCw size={14} />Refresh</Button>
        </div>
      </div>

      {data.alerts.length > 0 && (
        <ul className="space-y-1">
          {data.alerts.map((a) => <li key={a.code} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"><AlertTriangle size={14} />{(ALERT_TEXT[a.code] || (() => a.code))(a)}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Tile label="Patients today" value={c.total} sub={`${c.newPatients} new · ${c.followUps} follow-up`} />
        <Tile label="Completed" value={c.completed} />
        <Tile label="Waiting" value={c.waiting} />
        <Tile label="In consultation" value={c.inConsultation} />
        <Tile label="Missed / no-show" value={`${c.missed} / ${c.noShow}`} sub={`${c.cancelled} cancelled`} />
        <Tile label="Remaining capacity" value={data.remainingCapacity.slots} sub={`${data.remainingCapacity.minutes ?? 0} min free`} />
        <Tile label="Clinical minutes" value={c.clinicalMinutesBooked} sub={data.utilization.minutesPercent != null ? `${data.utilization.minutesPercent}% utilised` : "no working hours today"} />
        <Tile label="Online" value={c.byMode.online} />
        <Tile label="In clinic" value={c.byMode.in_person} />
        <Tile label="Home visits" value={c.byMode.home_visit} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Next patient">
          {data.currentConsultation ? (
            <div className="space-y-1 text-sm"><p className="font-black text-slate-900">In consultation: {data.currentConsultation.patientName}</p><p className="text-slate-600">{data.currentConsultation.timeSlot}</p>
              {data.currentConsultation.delayMinutes > 0 && <p className="font-semibold text-amber-700">Started {data.currentConsultation.delayMinutes} min after the scheduled time.</p>}</div>
          ) : data.nextPatient ? (
            <div className="space-y-1 text-sm"><p className="font-black text-slate-900">{data.nextPatient.patientName}</p><p className="text-slate-600">{data.nextPatient.timeSlot}{data.nextPatient.consultationMode ? ` · ${String(data.nextPatient.consultationMode).replace("_", " ")}` : ""}</p>
              <p className="font-semibold text-blue-700">{data.nextPatient.source === "queue" ? `Checked in · waiting ${data.nextPatient.waitingMinutes ?? 0} min` : "Not checked in yet"}</p>
              {data.delay.runningLateMinutes != null && data.delay.runningLateMinutes > 0 && <p className="font-semibold text-amber-700">Running {data.delay.runningLateMinutes} min late</p>}</div>
          ) : <p className="text-sm text-slate-500">No upcoming patients today.</p>}
        </Card>

        <Card title={`Waiting room (${data.queue.length})`}>
          {data.queue.length === 0 ? <p className="text-sm text-slate-500">Nobody is checked in.</p> : (
            <ol className="space-y-2">{data.queue.map((q) => (
              <li key={q.appointmentId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                <span><span className="font-black">{q.position}.</span> {q.patientName} <span className="text-xs text-slate-500">· {q.timeSlot} · waiting {q.waitingMinutes ?? 0} min</span></span>
                {q.visitState === "checked_in"
                  ? <Button disabled={busyId === q.appointmentId} onClick={() => call(q)}><PhoneCall size={14} />Call</Button>
                  : <span className="text-xs font-bold text-emerald-700">Called</span>}
              </li>))}</ol>
          )}
        </Card>
      </div>

      {data.needsResolution.length > 0 && (
        <Card title={`Needs resolution (${data.needsResolution.length})`}>
          <ul className="space-y-2">{data.needsResolution.map((n) => (
            <li key={n.appointmentId} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm">
              <span><span className="font-bold">{n.patientName}</span> · {new Date(n.date).toLocaleDateString()} · {n.timeSlot}</span>
              <Button variant="secondary" onClick={() => setResolveItem(n)}>Resolve</Button>
            </li>))}</ul>
        </Card>
      )}

      {data.impactedAppointments?.length > 0 && (
        <Card title={`Calendar changes affect ${data.impactedAppointments.length} appointment(s)`}>
          <ul className="space-y-1 text-sm">{data.impactedAppointments.map((n) => (
            <li key={n.appointmentId} className="flex items-center gap-2"><Clock3 size={13} className="text-amber-600" /><span className="font-bold">{n.patientName}</span> · {new Date(n.date).toLocaleDateString()} · {n.timeSlot} <span className="text-xs text-slate-500">— {n.reason}</span></li>))}</ul>
          <p className="mt-2 text-xs text-slate-500">Reschedule or cancel these from Appointments. Patients have been notified.</p>
        </Card>
      )}

      <ResolveAppointmentDialog item={resolveItem} onClose={() => setResolveItem(null)} onDone={async () => { setResolveItem(null); toast.success("Appointment resolved"); await load(); }} />
      {c.total === 0 && <p className="flex items-center gap-2 text-sm text-slate-500"><Users size={14} />No appointments today.</p>}
    </section>
  );
}
