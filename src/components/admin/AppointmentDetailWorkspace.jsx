import { Ban, CheckCircle2, ClipboardList, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import AppointmentCancelDialog from "./AppointmentCancelDialog";
import Button from "../ui/Button";
import ErrorState from "../shared/ErrorState";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import { useToast } from "../../context/ToastContext";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  consultationModeLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "../../utils/appointmentStatusDisplay";

const refundStatusTone = { pending: "warning", approved: "info", rejected: "danger", processed: "success" };

function AppointmentDetailWorkspace({ appointmentId, onChanged }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [cancelDialogMode, setCancelDialogMode] = useState(null); // null | "cancel" | "reject"

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getAppointmentDetailAdmin(appointmentId);
      setDetail(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
    setActiveTab("overview");
  }, [appointmentId]);

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await appointmentApi.updateAppointmentStatus(appointmentId, { status: "approved" });
      toast.success("Appointment approved");
      await loadDetail();
      onChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Appointment approval failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelDone = async () => {
    setCancelDialogMode(null);
    await loadDetail();
    onChanged?.();
  };

  if (loading) return <Loader label="Loading appointment workspace" />;
  if (error) return <ErrorState description={error} onRetry={loadDetail} />;
  if (!detail) return null;

  const { appointment, financial, clinical, cancellable, timeline } = detail;
  const patient = appointment.patientId;
  const doctor = appointment.doctorId;
  const isPending = appointment.status === "pending";

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "patient", label: "Patient" },
    { id: "doctor", label: "Doctor" },
    { id: "payment", label: "Payment" },
    { id: "clinical", label: "Clinical" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-950">
            {patient?.name} <span className="text-slate-400">with</span> Dr. {doctor?.userId?.name}
          </h3>
          <p className="text-sm text-slate-500">
            {new Date(appointment.date).toLocaleDateString()} · {appointment.timeSlot} ·{" "}
            {consultationModeLabel(appointment.consultationMode)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={appointmentStatusTone(appointment.status)}>
            {appointmentStatusLabel(appointment.status)}
          </StatusBadge>
          <StatusBadge tone={paymentStatusTone(appointment.paymentStatus)}>
            {paymentStatusLabel(appointment.paymentStatus)}
          </StatusBadge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isPending && (
          <Button variant="success" size="sm" isLoading={actionLoading} onClick={handleApprove}>
            <CheckCircle2 size={14} /> Approve
          </Button>
        )}
        {isPending && (
          <Button
            variant="danger"
            size="sm"
            disabled={actionLoading}
            onClick={() => setCancelDialogMode("reject")}
          >
            <Ban size={14} /> Reject
          </Button>
        )}
        {!isPending && cancellable && (
          <Button
            variant="danger"
            size="sm"
            disabled={actionLoading}
            onClick={() => setCancelDialogMode("cancel")}
          >
            <Ban size={14} /> Cancel Appointment
          </Button>
        )}
        {!cancellable && appointment.status !== "cancelled" && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <ClipboardList size={13} /> Consultation has started or finished — no longer cancellable from here.
          </p>
        )}
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Reason for Visit" value={appointment.reason || "Not provided"} />
          <MetricCard label="Symptoms" value={appointment.symptoms || "Not provided"} />
          {appointment.symptomDuration && <MetricCard label="Symptom Duration" value={appointment.symptomDuration} />}
          {appointment.painLevel != null && <MetricCard label="Pain Level" value={`${appointment.painLevel}/10`} />}
          <MetricCard label="Requested" value={new Date(appointment.createdAt).toLocaleString()} />
          <MetricCard label="Last Updated" value={new Date(appointment.updatedAt).toLocaleString()} />
          {appointment.cancelReason && (
            <MetricCard label="Cancellation Reason" value={appointment.cancelReason} tone="danger" />
          )}
        </div>
      )}

      {activeTab === "patient" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Name" value={patient?.name || "—"} />
          <MetricCard label="Email" value={patient?.email || "—"} />
          {patient?.patientProfile?.gender && <MetricCard label="Gender" value={patient.patientProfile.gender} />}
          {patient?.patientProfile?.bloodGroup && (
            <MetricCard label="Blood Group" value={patient.patientProfile.bloodGroup} />
          )}
          {patient?.patientProfile?.allergies?.length > 0 && (
            <MetricCard label="Allergies" value={patient.patientProfile.allergies.join(", ")} tone="danger" />
          )}
          {appointment.existingConditions && (
            <MetricCard label="Existing Conditions" value={appointment.existingConditions} />
          )}
          {appointment.currentMedications && (
            <MetricCard label="Current Medications" value={appointment.currentMedications} />
          )}
          {appointment.allergies && <MetricCard label="Allergies (this visit)" value={appointment.allergies} tone="danger" />}
          {appointment.emergencyContact?.name && (
            <MetricCard
              label="Emergency Contact"
              value={`${appointment.emergencyContact.name} (${appointment.emergencyContact.phone || "—"})`}
            />
          )}
          {appointment.familyMemberId && (
            <MetricCard
              label="Booked For"
              value={`${appointment.familyMemberId.name} (${appointment.familyMemberId.relation})`}
              caption="Family member, not the account holder"
            />
          )}
        </div>
      )}

      {activeTab === "doctor" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Name" value={doctor?.userId ? `Dr. ${doctor.userId.name}` : "—"} />
          <MetricCard label="Specialization" value={doctor?.specialization || "—"} />
          <MetricCard label="Consultation Fee" value={doctor?.fees != null ? `₹${doctor.fees}` : "—"} />
          <MetricCard label="Rating" value={doctor?.rating?.toFixed?.(1) ?? "0.0"} />
          <MetricCard
            label="Verification"
            value={doctor?.verificationStatus || "—"}
            tone={doctor?.verificationStatus === "approved" ? "success" : "warning"}
          />
          {doctor?.hospitalName && <MetricCard label="Hospital / Clinic" value={doctor.hospitalName} />}
          {(doctor?.city || doctor?.state) && (
            <MetricCard label="Location" value={[doctor.city, doctor.state].filter(Boolean).join(", ")} />
          )}
        </div>
      )}

      {activeTab === "payment" && (
        <div>
          {financial?.restricted ? (
            <div className="flex items-center gap-3 rounded-card border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
              <Lock size={18} /> Financial information restricted — your admin role does not have payment access.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {financial?.payment ? (
                <>
                  <MetricCard label="Amount" value={`₹${financial.payment.amount}`} />
                  {financial.payment.discountAmount > 0 && (
                    <MetricCard label="Discount" value={`₹${financial.payment.discountAmount}`} />
                  )}
                  <MetricCard label="Total Paid" value={`₹${financial.payment.totalAmount}`} />
                  <MetricCard
                    label="Payment Status"
                    value={financial.payment.status}
                    tone={financial.payment.status === "captured" ? "success" : "warning"}
                  />
                  {financial.invoiceNumber && <MetricCard label="Invoice" value={financial.invoiceNumber} />}
                  {financial.payment.paidAt && (
                    <MetricCard label="Paid At" value={new Date(financial.payment.paidAt).toLocaleString()} />
                  )}
                  {financial.refundRequest && (
                    <MetricCard
                      label="Refund Status"
                      value={`₹${financial.refundRequest.amount} — ${financial.refundRequest.status}`}
                      tone={refundStatusTone[financial.refundRequest.status] || "neutral"}
                    />
                  )}
                </>
              ) : (
                <p className="col-span-full text-sm text-slate-500">No payment has been recorded for this appointment.</p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "clinical" && (
        <div className="space-y-4">
          <div className="rounded-card border border-slate-200 p-5">
            <p className="mb-2 text-sm font-bold text-slate-800">Consultation Note</p>
            {clinical?.medicalNote ? (
              <div className="space-y-1 text-sm text-slate-600">
                <p>{clinical.medicalNote.notes}</p>
                {clinical.medicalNote.recommendations && (
                  <p className="text-slate-500">Recommendations: {clinical.medicalNote.recommendations}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No consultation note filed yet.</p>
            )}
          </div>
          <div className="rounded-card border border-slate-200 p-5">
            <p className="mb-2 text-sm font-bold text-slate-800">Prescription</p>
            {clinical?.prescription ? (
              <div className="space-y-1 text-sm text-slate-600">
                <p className="font-semibold text-slate-700">{clinical.prescription.diagnosis}</p>
                <p>{(clinical.prescription.medicines || []).map((m) => m.name).join(", ")}</p>
                {clinical.prescription.followUpDate && (
                  <p className="text-slate-500">
                    Follow-up: {new Date(clinical.prescription.followUpDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No prescription filed yet.</p>
            )}
          </div>
          <div className="rounded-card border border-slate-200 p-5">
            <p className="mb-2 text-sm font-bold text-slate-800">Medical Reports</p>
            {appointment.reportIds?.length > 0 ? (
              <ul className="space-y-1 text-sm text-slate-600">
                {appointment.reportIds.map((r) => (
                  <li key={r._id}>
                    {r.title} <span className="text-slate-400">· {r.category}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No reports attached.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "timeline" && (
        <ul className="space-y-3">
          {timeline.map((event) => (
            <li key={event.key} className="flex items-start gap-3 rounded-control border border-slate-200 p-3.5">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-royal-500" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{event.label}</p>
                <p className="text-xs text-slate-500">{event.at ? new Date(event.at).toLocaleString() : "—"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AppointmentCancelDialog
        appointment={cancelDialogMode ? appointment : null}
        mode={cancelDialogMode || "cancel"}
        onClose={() => setCancelDialogMode(null)}
        onDone={handleCancelDone}
      />
    </div>
  );
}

export default AppointmentDetailWorkspace;
