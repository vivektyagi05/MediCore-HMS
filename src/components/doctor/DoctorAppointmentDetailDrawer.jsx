import { ExternalLink, MessageCircle, Receipt, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  consultationModeLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "../../utils/appointmentStatusDisplay";

// Phase DOC-04, Step 4 — "Appointment Detail Experience". Deliberately does
// NOT duplicate the Clinical Workspace or Patient Relationship Center: it
// renders only what the appointment list already returned (patientProfile/
// insurance/reports are already populated for doctor requests — see
// appointmentController.getAppointments) and deep-links to the real
// dedicated pages for anything deeper, per the brief's explicit example.
// Payment.status/refundStatus (backend/models/Payment.js) are a distinct,
// richer enum from the Appointment's own paymentStatus field (see
// appointmentStatusDisplay.js) — captured/partially_refunded/etc have no
// equivalent there. Humanized inline rather than duplicating a second full
// label map for fields that only ever render in this one place.
const humanize = (value) => (value ? String(value).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

function DoctorAppointmentDetailDrawer({ appointment, onClose }) {
  const [activeTab, setActiveTab] = useState("overview");
  if (!appointment) return null;

  const patient = appointment.patientId;
  const profile = patient?.patientProfile;
  const payment = appointment.paymentId;
  const invoice = appointment.invoiceId;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "patient", label: "Patient" },
    // PHASE P4 — BUGFIX: appointmentController.getAppointments already
    // populates paymentId (status/refundStatus/refundedAmount/amount) and
    // invoiceId (invoiceNumber) for every doctor-facing appointment — real
    // data was being fetched and silently dropped, so the doctor's detail
    // workspace could never answer "PAYMENT?" (brief §6) beyond the coarse
    // paymentStatus badge already shown above. Tab only appears once there's
    // real billing data to show — never fabricated for an unpaid/no-invoice
    // appointment.
    ...(payment || invoice ? [{ id: "billing", label: "Billing" }] : []),
  ];

  return (
    <Modal isOpen={Boolean(appointment)} title="Appointment Detail" onClose={() => { setActiveTab("overview"); onClose(); }} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-slate-950">{patient?.name || "Patient"}</h3>
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
            {appointment.appointmentType === "follow_up" && (
              <StatusBadge tone="warning">Follow-up Visit</StatusBadge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" to={`/doctor/patients/${patient?._id}`}>
            <User size={14} /> Open Patient
          </Button>
          <Button variant="secondary" size="sm" to={`/doctor/clinical?patientId=${patient?._id}&tab=history`}>
            <ExternalLink size={14} /> Open Clinical Workspace
          </Button>
          <Button variant="secondary" size="sm" to={`/doctor/patients/${patient?._id}?tab=communication`}>
            <MessageCircle size={14} /> Message Patient
          </Button>
        </div>

        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === "overview" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Reason for Visit" value={appointment.reason || "Not provided"} />
            {appointment.symptoms?.length > 0 && (
              <MetricCard label="Symptoms" value={appointment.symptoms.join(", ")} />
            )}
            {appointment.symptomDuration && <MetricCard label="Symptom Duration" value={appointment.symptomDuration} />}
            {appointment.painLevel != null && (
              <MetricCard label="Pain Level" value={`${appointment.painLevel}/10`} tone={appointment.painLevel >= 8 ? "danger" : "neutral"} />
            )}
            <MetricCard label="Requested" value={new Date(appointment.createdAt).toLocaleString()} />
            <MetricCard label="Last Updated" value={new Date(appointment.updatedAt).toLocaleString()} />
            {appointment.cancelReason && (
              <MetricCard label="Cancellation Reason" value={appointment.cancelReason} tone="danger" />
            )}
            {appointment.insuranceId && (
              <MetricCard
                label="Insurance"
                value={`${appointment.insuranceId.provider} · ${appointment.insuranceId.policyNumber}`}
                icon={ShieldCheck}
              />
            )}
            {appointment.reportIds?.length > 0 && (
              <MetricCard
                label="Reports Attached"
                value={appointment.reportIds.map((r) => r.title).join(", ")}
              />
            )}
            {appointment.rescheduleHistory?.length > 0 && (
              <MetricCard
                label="Rescheduled"
                value={`${appointment.rescheduleHistory.length} time(s) — most recently from ${new Date(
                  appointment.rescheduleHistory[appointment.rescheduleHistory.length - 1].fromDate,
                ).toLocaleDateString()} ${appointment.rescheduleHistory[appointment.rescheduleHistory.length - 1].fromTimeSlot}`}
              />
            )}
          </div>
        )}

        {activeTab === "patient" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Name" value={patient?.name || "—"} />
            <MetricCard label="Email" value={patient?.email || "—"} />
            {profile?.gender && <MetricCard label="Gender" value={profile.gender} />}
            {profile?.bloodGroup && <MetricCard label="Blood Group" value={profile.bloodGroup} />}
            {profile?.allergies?.length > 0 && (
              <MetricCard label="Allergies" value={profile.allergies.join(", ")} tone="danger" />
            )}
            {appointment.existingConditions?.length > 0 && (
              <MetricCard label="Existing Conditions" value={appointment.existingConditions.join(", ")} />
            )}
            {appointment.currentMedications?.length > 0 && (
              <MetricCard label="Current Medications" value={appointment.currentMedications.join(", ")} />
            )}
            {appointment.allergies?.length > 0 && (
              <MetricCard label="Allergies (this visit)" value={appointment.allergies.join(", ")} tone="danger" />
            )}
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

        {activeTab === "billing" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {payment && (
                <>
                  <MetricCard label="Payment Status" value={humanize(payment.status)} />
                  <MetricCard label="Amount" value={payment.amount != null ? `₹${payment.amount}` : "—"} />
                  {payment.refundStatus && payment.refundStatus !== "none" && (
                    <MetricCard
                      label="Refund Status"
                      value={humanize(payment.refundStatus)}
                      tone={payment.refundStatus === "failed" ? "danger" : "info"}
                    />
                  )}
                  {payment.refundedAmount > 0 && (
                    <MetricCard label="Refunded Amount" value={`₹${payment.refundedAmount}`} tone="info" />
                  )}
                </>
              )}
              {invoice?.invoiceNumber && (
                <MetricCard label="Invoice" value={`#${invoice.invoiceNumber}`} icon={Receipt} />
              )}
              {!payment && !invoice && <MetricCard label="Billing" value="No payment or invoice on this appointment yet" />}
            </div>
            <Button variant="secondary" size="sm" to="/doctor/earnings">
              <Receipt size={14} /> Open Earnings &amp; Payments
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default DoctorAppointmentDetailDrawer;
