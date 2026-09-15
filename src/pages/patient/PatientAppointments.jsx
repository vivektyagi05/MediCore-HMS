import { CalendarDays, Search, Clock3, CheckCircle2, MapPin, Video, FileText,
  Receipt, ShieldCheck, RefreshCw, Users, Star, Download, X, CalendarPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { appointmentApi } from "../../api/appointmentApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { invoiceApi } from "../../api/invoiceApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";
import { downloadAppointmentICS } from "../../utils/icsGenerator";
import { consultationModeLabel } from "../../utils/appointmentStatusDisplay";

import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import AppointmentStatusTracker from "../../components/patient/AppointmentStatusTracker";
import RescheduleAppointmentDialog from "../../components/shared/RescheduleAppointmentDialog";
import CancelAppointmentDialog from "../../components/shared/CancelAppointmentDialog";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { useToast } from "../../context/ToastContext";

const ACTIVE_STATUSES = ["pending", "approved", "payment_pending", "payment_completed", "consultation_started"];
const COMPLETED_STATUSES = ["completed", "consultation_completed", "review_eligible"];

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function isSameDay(a, b) {
  const d1 = new Date(a); const d2 = new Date(b);
  return d1.toDateString() === d2.toDateString();
}

const TABS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "awaitingAction", label: "Needs Action" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

function PatientAppointments() {
  const toast = useToast();
  const navigate = useNavigate();

  const [appointments, setAppointments] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: "" });
  const [reviewLoading, setReviewLoading] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const loadAll = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [apptRes, rxRes, reviewRes] = await Promise.all([
        appointmentApi.getAppointments({ limit: 200 }),
        patientWorkflowApi.getPrescriptions(),
        patientWorkflowApi.getReviews(),
      ]);
      setAppointments(apptRes.data?.appointments || []);
      setPrescriptions(rxRes.data?.prescriptions || []);
      setReviews(reviewRes.data?.reviews || []);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const downloadBlob = async (loader, name) => {
    try {
      const blob = await loader();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const prescriptionByAppointment = useMemo(() => {
    const map = new Map();
    for (const rx of prescriptions) {
      const apptId = rx.appointmentId?._id || rx.appointmentId;
      if (apptId) map.set(String(apptId), rx);
    }
    return map;
  }, [prescriptions]);

  const reviewByAppointment = useMemo(() => {
    const map = new Map();
    for (const rv of reviews) {
      const apptId = rv.appointmentId?._id || rv.appointmentId;
      if (apptId) map.set(String(apptId), rv);
    }
    return map;
  }, [reviews]);

  const cancelAppointment = (appointment) => setCancelTarget(appointment);

  const openReview = (appointment) => {
    const existing = reviewByAppointment.get(String(appointment._id));
    setReviewTarget(appointment);
    setReviewForm({ rating: existing?.rating || 5, comment: existing?.comment || "" });
  };

  const submitReview = async (e) => {
    e.preventDefault();
    if (!reviewTarget) return;
    try {
      setReviewLoading(true);
      await patientWorkflowApi.saveReview({
        appointmentId: reviewTarget._id,
        rating: reviewForm.rating,
        comment: reviewForm.comment,
      });
      toast.success("Thanks for your feedback");
      setReviewTarget(null);
      loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setReviewLoading(false);
    }
  };

  const now = new Date();

  const withComputed = useMemo(() => {
    return appointments.map((a) => ({
      ...a,
      _isToday: isSameDay(a.date, now),
      _isFuture: new Date(a.date) >= new Date(now.toDateString()),
      _isActive: ACTIVE_STATUSES.includes(a.status),
      _isCompleted: COMPLETED_STATUSES.includes(a.status),
      _needsAction: a.status === "approved" || a.status === "payment_pending" || a.status === "review_eligible",
    }));
  }, [appointments]);

  const tabbed = useMemo(() => {
    return withComputed.filter((a) => {
      switch (tab) {
        case "today": return a._isToday && a.status !== "cancelled";
        case "upcoming": return a._isActive && a._isFuture;
        case "awaitingAction": return a._needsAction;
        case "completed": return a._isCompleted;
        case "cancelled": return a.status === "cancelled";
        default: return true;
      }
    });
  }, [withComputed, tab]);

  const filtered = useMemo(() => {
    return tabbed.filter((a) => {
      const doctorName = a.doctorId?.userId?.name || "Doctor Removed";
      return doctorName.toLowerCase().includes(search.toLowerCase());
    });
  }, [tabbed, search]);

  const stats = {
    total: appointments.length,
    today: withComputed.filter((a) => a._isToday && a.status !== "cancelled").length,
    upcoming: withComputed.filter((a) => a._isActive && a._isFuture).length,
    completed: withComputed.filter((a) => a._isCompleted).length,
  };

  // The single soonest active appointment — used for the AI prep panel,
  // mirroring the exact pattern already used on the Patient Dashboard.
  const nextAppointment = useMemo(() => {
    return withComputed
      .filter((a) => a._isActive && a._isFuture)
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  }, [withComputed]);

  if (isLoading) return <Loader label="Loading appointments..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Appointment Workspace</p>
          <h1 className="mt-2 text-3xl font-black">My Appointments</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your command center — track status, payments, prescriptions and follow-ups in one place.
          </p>
        </div>
        <Button variant="secondary" onClick={loadAll}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CalendarDays className="text-blue-600" />
          <p className="mt-4 text-3xl font-black">{stats.total}</p>
          <p className="text-sm font-bold text-slate-500">Total Appointments</p>
        </Card>
        <Card>
          <Clock3 className="text-amber-600" />
          <p className="mt-4 text-3xl font-black">{stats.today}</p>
          <p className="text-sm font-bold text-slate-500">Today</p>
        </Card>
        <Card>
          <CalendarDays className="text-blue-600" />
          <p className="mt-4 text-3xl font-black">{stats.upcoming}</p>
          <p className="text-sm font-bold text-slate-500">Upcoming</p>
        </Card>
        <Card>
          <CheckCircle2 className="text-emerald-600" />
          <p className="mt-4 text-3xl font-black">{stats.completed}</p>
          <p className="text-sm font-bold text-slate-500">Completed</p>
        </Card>
      </div>

      {nextAppointment && (
        <AIDraftPanel
          title="AI: Prepare for your next visit"
          actionLabel="Generate prep checklist"
          onGenerate={() => aiAssistApi.appointmentPrep(nextAppointment._id)}
        />
      )}

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tb) => (
              <button key={tb.key} onClick={() => setTab(tb.key)}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab === tb.key ? "bg-blue-600 text-white shadow-lg" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {tb.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search doctor..."
              className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-4"
            />
          </div>
        </div>
      </Card>

      {!filtered.length ? (
        <EmptyState title="No appointments found" description="Appointments matching your filters will appear here." />
      ) : (
        <div className="space-y-4">
          {filtered.map((appointment) => {
            const doctor = appointment.doctorId;
            const doctorUserId = doctor?.userId?._id;
            const prescription = prescriptionByAppointment.get(String(appointment._id));
            const alreadyReviewed = reviewByAppointment.has(String(appointment._id));
            const canReview = appointment.status === "completed" || appointment.status === "review_eligible";
            const canJoin = appointment.consultationMode === "online" &&
              ["payment_completed", "consultation_started"].includes(appointment.status);
            // A home visit means the doctor comes to the patient, not the
            // other way around — directions to the clinic only make sense
            // for an actual in-clinic ("in_person") appointment.
            const canGetDirections = appointment.consultationMode === "in_person" && doctor?.hospitalName;
            const canAddToCalendar = appointment._isActive;
            const canRebook = appointment._isCompleted;
            const canCancel = ["pending", "approved", "payment_pending"].includes(appointment.status);
            const mapsQuery = encodeURIComponent(
              [doctor?.hospitalName, doctor?.city, doctor?.state].filter(Boolean).join(", "),
            );

            return (
              <Card key={appointment._id}>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black">Dr. {doctor?.userId?.name || "Doctor Removed"}</h3>
                        {appointment.familyMemberId && (
                          <span className="flex items-center gap-1 rounded-lg bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">
                            <Users size={11} /> For {appointment.familyMemberId.name}
                          </span>
                        )}
                        {appointment.appointmentType === "follow_up" && (
                          <span className="flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                            <CalendarPlus size={11} /> Follow-up Visit
                          </span>
                        )}
                        {appointment.consultationMode && (
                          <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${
                            appointment.consultationMode === "online"
                              ? "bg-sky-100 text-sky-700"
                              : appointment.consultationMode === "home_visit"
                                ? "bg-violet-100 text-violet-700"
                                : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {consultationModeLabel(appointment.consultationMode)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{doctor?.specialization}</p>
                      <p className="mt-2 text-sm text-slate-600">
                        {formatDate(appointment.date)} • {appointment.timeSlot}
                      </p>
                      {appointment.reason && (
                        <p className="mt-2 text-sm text-slate-500">Reason: {appointment.reason}</p>
                      )}
                    </div>

                    <div className="w-full lg:max-w-sm">
                      <AppointmentStatusTracker
                        appointment={appointment}
                        onPayNow={() => navigate(`/patient/payments/${appointment._id}`)}
                        onReview={() => openReview(appointment)}
                      />
                    </div>
                  </div>

                  {/* PHASE DOC-05 audit (Step 16, patient-side lifecycle):
                      the doctor's reply was persisted and returned by
                      getReviews() but never rendered anywhere on the
                      patient side — the lifecycle silently stopped at
                      "Doctor responds." */}
                  {reviewByAppointment.get(String(appointment._id))?.doctorReply?.message && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm">
                      <p className="text-xs font-black uppercase tracking-wide text-blue-700">Doctor replied to your review</p>
                      <p className="mt-1 text-slate-700">
                        {reviewByAppointment.get(String(appointment._id)).doctorReply.message}
                      </p>
                    </div>
                  )}

                  {/* Insurance / documents / invoice summary */}
                  {(appointment.insuranceId || (appointment.reportIds && appointment.reportIds.length > 0) || prescription || appointment.invoiceId) && (
                    <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                      {appointment.insuranceId && (
                        <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs">
                          <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                          <div>
                            <p className="font-bold text-slate-700">{appointment.insuranceId.provider}</p>
                            <p className="text-slate-500">{appointment.insuranceId.claimStatus || "Insurance on file"}</p>
                          </div>
                        </div>
                      )}
                      {appointment.reportIds?.length > 0 && (
                        <div className="rounded-xl bg-slate-50 p-3 text-xs">
                          <p className="mb-1 flex items-center gap-1 font-bold text-slate-700"><FileText size={13} /> Reports ({appointment.reportIds.length})</p>
                          <div className="space-y-1">
                            {appointment.reportIds.slice(0, 3).map((r) => (
                              <button key={r._id} onClick={() => downloadBlob(() => patientWorkflowApi.downloadReport(r._id), r.fileName || `${r.title}.pdf`)}
                                className="flex items-center gap-1 text-slate-500 hover:text-blue-600">
                                <Download size={11} /> {r.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {prescription && (
                        <div className="rounded-xl bg-slate-50 p-3 text-xs">
                          <p className="mb-1 font-bold text-slate-700">Prescription available</p>
                          <button onClick={() => downloadBlob(() => patientWorkflowApi.downloadPrescription(prescription._id), `prescription-${prescription._id}.pdf`)}
                            className="flex items-center gap-1 text-slate-500 hover:text-blue-600">
                            <Download size={11} /> Download
                          </button>
                        </div>
                      )}
                      {appointment.invoiceId && (
                        <div className="rounded-xl bg-slate-50 p-3 text-xs">
                          <p className="mb-1 flex items-center gap-1 font-bold text-slate-700"><Receipt size={13} /> Invoice #{appointment.invoiceId.invoiceNumber}</p>
                          <button onClick={() => downloadBlob(() => invoiceApi.downloadInvoice(appointment.invoiceId._id), `invoice-${appointment.invoiceId.invoiceNumber}.pdf`)}
                            className="flex items-center gap-1 text-slate-500 hover:text-blue-600">
                            <Download size={11} /> Download
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                    {canJoin && doctorUserId && (
                      <Button onClick={() => navigate(`/chat/${doctorUserId}`)}>
                        <Video size={15} /> Join Consultation
                      </Button>
                    )}
                    {canGetDirections && (
                      <Button variant="secondary" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`, "_blank", "noopener")}>
                        <MapPin size={15} /> Directions
                      </Button>
                    )}
                    {canAddToCalendar && (
                      <Button variant="secondary" onClick={() => downloadAppointmentICS({
                        date: appointment.date,
                        timeSlot: appointment.timeSlot,
                        doctorName: doctor?.userId?.name,
                        specialization: doctor?.specialization,
                        hospitalName: doctor?.hospitalName,
                        consultationMode: appointment.consultationMode,
                        reason: appointment.reason,
                      })}>
                        <CalendarPlus size={15} /> Add to calendar
                      </Button>
                    )}
                    {canRebook && (
                      <Button variant="secondary" onClick={() => navigate(`/patient/appointments/book?doctorId=${doctor?._id}`)}>
                        <CalendarDays size={15} /> Book Follow-up
                      </Button>
                    )}
                    {canReview && (
                      <Button variant="secondary" onClick={() => openReview(appointment)}>
                        <Star size={15} /> {alreadyReviewed ? "Edit Review" : "Rate Consultation"}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => navigate(`/patient/appointments/${appointment._id}`)}>
                      <Clock3 size={15} /> View details
                    </Button>
                    {canCancel && (
                      <Button variant="secondary" onClick={() => setRescheduleTarget(appointment)}>
                        <RefreshCw size={15} /> Reschedule
                      </Button>
                    )}
                    {canCancel && (
                      <Button variant="secondary" className="border-red-300 text-red-600 hover:border-red-500 hover:bg-red-50"
                        onClick={() => cancelAppointment(appointment)}>
                        <X size={15} /> Cancel Appointment
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal isOpen={!!reviewTarget} title="Rate your consultation" onClose={() => setReviewTarget(null)}>
        <form onSubmit={submitReview} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setReviewForm({ ...reviewForm, rating: n })}>
                  <Star size={26} className={n <= reviewForm.rating ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Comment</label>
            <textarea
              value={reviewForm.comment}
              onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
              rows={4}
              placeholder="Share your experience..."
              className="w-full rounded-xl border border-slate-200 p-3 text-sm"
            />
          </div>
          <Button type="submit" className="w-full" isLoading={reviewLoading}>Submit Review</Button>
        </form>
      </Modal>

      <RescheduleAppointmentDialog appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} onDone={async () => { setRescheduleTarget(null); await loadAll(); }} />
      <CancelAppointmentDialog appointment={cancelTarget} mode="patient" onClose={() => setCancelTarget(null)} onConfirm={(reason) => appointmentApi.cancelAppointment(cancelTarget._id, reason).then(async (res) => { setCancelTarget(null); await loadAll(); return res; })} />
    </div>
  );
}

export default PatientAppointments;
