import { useCallback, useEffect, useState } from "react";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { useAppointmentSync } from "../../hooks/useAppointmentSync";
import Card from "../ui/Card";

const Stat = ({ label, value, warn }) => (
  <div className={`rounded-xl border p-3 ${warn ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
    <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
  </div>
);

/** SUPER_ADMIN lifecycle health: unresolved/stale appointments, system cancellations, scheduler runs. */
export default function AppointmentOperationsOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const res = await appointmentApi.getOperationsOverview(); setData(res.data); setError(""); }
    catch (err) { setError(getApiErrorMessage(err)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAppointmentSync(load);

  if (error && !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error} <button className="font-bold underline" onClick={load}>Retry</button></div>;
  if (!data) return null;
  const t = data.totals;
  return (
    <Card title="Appointment operations">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Need resolution" value={t.needsResolution} warn={t.needsResolution > 0} />
        <Stat label="Stale consultations" value={t.staleStartedConsultations} warn={t.staleStartedConsultations > 0} />
        <Stat label="Double-booked slots" value={t.doubleBookedSlots} warn={t.doubleBookedSlots > 0} />
        <Stat label="Auto-cancelled (7d)" value={t.systemCancelledLast7Days} />
        <Stat label="No-shows (7d)" value={t.noShowsLast7Days} />
      </div>
      <p className="mt-3 text-xs text-slate-500">Resolution window {data.rules.resolutionWindowDays} days · check-in opens {data.rules.checkInEarlyWindowMinutes} min early · no-show grace {data.rules.noShowGraceMinutes} min · {data.timezone}</p>
      {data.schedulerRuns?.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">{data.schedulerRuns.slice(0, 5).map((r) => (
          <li key={r._id} className="flex justify-between"><span className="font-semibold">{r.jobName}</span><span className={r.status === "failed" ? "font-bold text-red-600" : "text-slate-500"}>{r.status} · {new Date(r.startedAt).toLocaleString()}</span></li>))}</ul>
      )}
      {data.recentUnresolved?.length > 0 && <p className="mt-2 text-xs font-semibold text-amber-800">{data.recentUnresolved.length} oldest unresolved appointment(s) are listed in the doctors' Today's Clinic.</p>}
    </Card>
  );
}
