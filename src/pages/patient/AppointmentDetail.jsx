import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, CheckCircle2, Clock3, CreditCard, MapPin, RefreshCw, Stethoscope, XCircle } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { appointmentStatusLabel, consultationModeLabel, paymentStatusLabel } from "../../utils/appointmentStatusDisplay";
import { useI18n } from "../../i18n/I18nContext";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import Button from "../../components/ui/Button";
import EmptyState from "../../components/shared/EmptyState";
import AppointmentStatusTracker from "../../components/patient/AppointmentStatusTracker";
import RescheduleAppointmentDialog from "../../components/shared/RescheduleAppointmentDialog";
import CancelAppointmentDialog from "../../components/shared/CancelAppointmentDialog";

const canCancel = (status) => ["pending", "approved", "payment_pending"].includes(status);

export default function AppointmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = async () => {
    setLoading(true); setError("");
    try { const res = await appointmentApi.getAppointment(id); setAppointment(res.data); }
    catch (err) { setError(getApiErrorMessage(err)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const timeline = useMemo(() => (appointment?.statusHistory || []).map((entry) => ({ ...entry, at: new Date(entry.at) })), [appointment]);

  if (loading) return <Loader label={t("appointmentDetail.loading")} />;
  if (error) return <div className="space-y-4"><EmptyState title={t("appointmentDetail.loadFailed")} description={error} /><Button onClick={load}>{t("appointmentDetail.retry")}</Button></div>;
  if (!appointment) return null;

  const doctor = appointment.doctorId;
  const patient = appointment.patientId;
  const status = appointment.status;

  return <div className="mx-auto max-w-5xl space-y-6">
    <Link to="/patient/appointments" className="inline-flex items-center gap-2 text-sm font-black text-blue-600"><ArrowLeft size={16}/>{t("appointmentDetail.back")}</Link>
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">{t("appointmentDetail.eyebrow")}</p><h1 className="mt-2 text-3xl font-black text-slate-950">Dr. {doctor?.userId?.name || t("appointmentDetail.doctorRemoved")}</h1><p className="mt-1 text-sm text-slate-500">{doctor?.specialization || ""}</p></div>
      <div className="flex flex-wrap gap-2">
        {canCancel(status) && <Button variant="secondary" className="border-red-300 text-red-600" onClick={() => setCancelTarget(appointment)}><XCircle size={15}/>{t("appointmentDetail.cancel")}</Button>}
        {canCancel(status) && <Button variant="secondary" onClick={() => setRescheduleTarget(appointment)}><CalendarClock size={15}/>{t("appointmentDetail.reschedule")}</Button>}
        {status === "payment_pending" && <Button onClick={() => navigate(`/patient/payments/${appointment._id}`)}><CreditCard size={15}/>{t("appointmentDetail.pay")}</Button>}
      </div>
    </div>

    <AppointmentStatusTracker appointment={appointment} onPayNow={() => navigate(`/patient/payments/${appointment._id}`)} />

    <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
      <Card title={t("appointmentDetail.visitTitle")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Info icon={CalendarClock} label={t("appointmentDetail.dateTime")} value={`${new Date(appointment.date).toLocaleDateString()} · ${appointment.timeSlot}`} />
          <Info icon={Stethoscope} label={t("appointmentDetail.mode")} value={consultationModeLabel(appointment.consultationMode)} />
          <Info icon={MapPin} label={t("appointmentDetail.location")} value={[doctor?.hospitalName, doctor?.city, doctor?.state].filter(Boolean).join(", ") || t("appointmentDetail.notProvided")} />
          <Info icon={CreditCard} label={t("appointmentDetail.payment")} value={paymentStatusLabel(appointment.paymentStatus || appointment.paymentId?.status)} />
          <Info icon={Clock3} label={t("appointmentDetail.status")} value={appointmentStatusLabel(status)} />
          <Info icon={CheckCircle2} label={t("appointmentDetail.patient")} value={patient?.name || t("appointmentDetail.notProvided")} />
        </div>
        {appointment.cancelReason && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>{t("appointmentDetail.cancelReason")}:</strong> {appointment.cancelReason}</div>}
      </Card>

      <Card title={t("appointmentDetail.timelineTitle")}>
        {timeline.length ? <ol className="space-y-4">{timeline.map((entry, index) => <li key={`${entry.at.toISOString()}-${index}`} className="relative flex gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600"/><div><p className="text-sm font-bold text-slate-900">{appointmentStatusLabel(entry.status)}</p><p className="text-xs text-slate-500">{entry.at.toLocaleString()}</p>{entry.reason && <p className="mt-1 text-xs text-slate-600">{entry.reason}</p>}</div></li>)}</ol> : <p className="text-sm text-slate-500">{t("appointmentDetail.timelineEmpty")}</p>}
      </Card>
    </div>

    <RescheduleAppointmentDialog appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} onDone={async () => { setRescheduleTarget(null); await load(); }} />
    <CancelAppointmentDialog appointment={cancelTarget} mode="patient" onClose={() => setCancelTarget(null)} onConfirm={(reason) => appointmentApi.cancelAppointment(appointment._id, reason).then(async (res) => { setCancelTarget(null); await load(); return res; })} />
  </div>;
}

function Info({ icon: Icon, label, value }) { return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500"><Icon size={14}/>{label}</div><p className="mt-2 text-sm font-bold text-slate-900">{value}</p></div>; }
