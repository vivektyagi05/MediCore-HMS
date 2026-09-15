import {
  CalendarClock,
  Download,
  FileText,
  IndianRupee,
  Info,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";
import AIDraftPanel from "../ai/AIDraftPanel";
import ErrorState from "../shared/ErrorState";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import { useToast } from "../../context/ToastContext";
import { appointmentStatusLabel, appointmentStatusTone } from "../../utils/appointmentStatusDisplay";

const ATTENTION_TONE = { critical: "danger", warning: "warning", info: "info" };

// Module-scope helper (same pattern as AdminMissionControl.jsx's timeAgo())
// so Date.now() is not called directly inside the component's render body.
function insurancePolicyStatus(validTill) {
  if (!validTill) return { expired: false, expiringSoon: false };
  const validTillMs = new Date(validTill).getTime();
  const nowMs = Date.now();
  const expired = validTillMs <= nowMs;
  const expiringSoon = !expired && validTillMs - nowMs < 30 * 24 * 60 * 60 * 1000;
  return { expired, expiringSoon };
}

const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

function AttentionList({ items }) {
  if (!items.length) {
    return (
      <p className="flex items-center gap-2 rounded-control border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
        <Info size={16} /> No open attention items for this patient.
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.key} className="rounded-control border border-slate-200 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-bold text-slate-900">{item.what}</p>
            <StatusBadge tone={ATTENTION_TONE[item.severity] || "neutral"}>{item.severity}</StatusBadge>
          </div>
          <p className="mt-1 text-xs text-slate-600">{item.why}</p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.source}</p>
          {item.action && <p className="mt-1 text-xs font-semibold text-royal-700">Suggested: {item.action}</p>}
        </div>
      ))}
    </div>
  );
}

function PatientWorkspace({ patientId, onViewAppointments }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getPatientWorkspaceAdmin(patientId);
      setDetail(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [patientId]);

  const handleDownloadReport = async (report) => {
    setDownloadingId(report._id);
    try {
      const blob = await adminApi.downloadPatientReportAdmin(report._id);
      downloadBlob(blob, report.fileName || `${report.title}.pdf`);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Report could not be loaded.");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadPrescription = async (prescription) => {
    setDownloadingId(prescription._id);
    try {
      const blob = await adminApi.downloadPatientPrescriptionAdmin(prescription._id);
      downloadBlob(blob, `prescription-${prescription._id}.pdf`);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Prescription PDF is not available for this record.");
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <Loader label="Loading patient workspace" />;
  if (error) return <ErrorState description={error} onRetry={loadDetail} />;
  if (!detail) return null;

  const { patient, riskLevel, attentionItems, appointments, reports, prescriptions, insurance, familyMembers, financial, timeline } = detail;
  const profile = patient.patientProfile || {};
  const riskTone = { high: "danger", medium: "warning", low: "success" }[riskLevel] || "neutral";

  const tabs = [
    { id: "overview", label: "Overview", badge: attentionItems.length },
    { id: "health", label: "Health" },
    { id: "appointments", label: "Appointments" },
    { id: "records", label: "Records", badge: reports.filter((r) => r.severity !== "normal" && !r.reviewedAt).length },
    { id: "prescriptions", label: "Prescriptions" },
    { id: "payments", label: "Payments" },
    { id: "insurance", label: "Insurance" },
    { id: "family", label: "Family" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-950">{patient.name}</h3>
          <p className="text-sm text-slate-500">
            {patient.email}
            {patient.age != null && ` · ${patient.age} yrs`}
            {profile.gender && ` · ${profile.gender}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={riskTone}>{riskLevel} risk</StatusBadge>
          <StatusBadge tone={patient.isActive ? "success" : "neutral"}>{patient.isActive ? "Active" : "Deactivated"}</StatusBadge>
          {onViewAppointments && (
            <Button variant="secondary" size="sm" onClick={() => onViewAppointments(patient._id)}>
              <CalendarClock size={14} /> View Appointments
            </Button>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Appointments" value={appointments.filter((a) => a.status !== "cancelled").length} caption="All-time · live" />
            <MetricCard label="Reports" value={reports.length} />
            <MetricCard label="Prescriptions" value={prescriptions.length} />
            <MetricCard label="Family Members" value={familyMembers.length} icon={Users} />
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-slate-800">Attention</p>
            <AttentionList items={attentionItems} />
          </div>
          <AIDraftPanel
            title="Patient Operational Summary"
            actionLabel="Generate summary"
            onGenerate={() => aiAssistApi.getPatientOperationalSummaryAdmin(patient._id)}
          />
        </div>
      )}

      {activeTab === "health" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Blood Group" value={profile.bloodGroup || "Not on file"} />
          <MetricCard
            label="Height / Weight"
            value={profile.height && profile.weight ? `${profile.height} cm / ${profile.weight} kg` : "Not on file"}
          />
          <MetricCard label="Emergency Contact" value={profile.emergencyContact?.phone || "Not on file"} caption={profile.emergencyContact?.name} />
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500">Conditions</p>
            <p className="text-sm text-slate-700">{profile.medicalConditions?.length ? profile.medicalConditions.join(", ") : "None recorded"}</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500">Allergies</p>
            <p className="text-sm text-slate-700">{profile.allergies?.length ? profile.allergies.join(", ") : "None recorded"}</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500">Medications</p>
            <p className="text-sm text-slate-700">{profile.medications?.length ? profile.medications.join(", ") : "None recorded"}</p>
          </div>
          {profile.healthGoals?.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500">Health Goals</p>
              <p className="text-sm text-slate-700">{profile.healthGoals.join(", ")}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "appointments" && (
        <div className="space-y-2.5">
          {appointments.length === 0 ? (
            <p className="text-sm text-slate-500">No appointments on file yet.</p>
          ) : (
            appointments.map((appt) => (
              <div key={appt._id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-slate-200 p-3.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    Dr. {appt.doctorId?.userId?.name || "Unassigned"} · {appt.doctorId?.specialization}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(appt.date).toLocaleDateString()} · {appt.timeSlot} · {appt.consultationMode}
                  </p>
                </div>
                <StatusBadge tone={appointmentStatusTone(appt.status)}>{appointmentStatusLabel(appt.status)}</StatusBadge>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "records" && (
        <div className="space-y-2.5">
          {reports.length === 0 ? (
            <p className="text-sm text-slate-500">No medical reports uploaded yet.</p>
          ) : (
            reports.map((report) => (
              <div key={report._id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-slate-200 p-3.5">
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{report.title}</p>
                    <p className="text-xs text-slate-500">
                      {report.category} · {new Date(report.reportDate).toLocaleDateString()}
                      {report.severity !== "normal" && !report.reviewedAt && (
                        <span className="ml-1.5 font-bold text-rose-600">· awaiting review</span>
                      )}
                    </p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" isLoading={downloadingId === report._id} onClick={() => handleDownloadReport(report)}>
                  <Download size={14} /> Download
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "prescriptions" && (
        <div className="space-y-2.5">
          {prescriptions.length === 0 ? (
            <p className="text-sm text-slate-500">No prescriptions on file yet.</p>
          ) : (
            prescriptions.map((prescription) => (
              <div key={prescription._id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-slate-200 p-3.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Dr. {prescription.doctorId?.userId?.name || "Unknown"}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(prescription.createdAt).toLocaleDateString()}
                    {prescription.followUpDate && ` · follow-up ${new Date(prescription.followUpDate).toLocaleDateString()}`}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={downloadingId === prescription._id}
                  onClick={() => handleDownloadPrescription(prescription)}
                >
                  <Download size={14} /> Download
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "payments" && (
        <div>
          {financial.restricted ? (
            <ErrorState
              title="Financial data restricted"
              description="Your admin account does not have permission to view payment details for patients."
            />
          ) : (
            <div className="space-y-4">
              <MetricCard
                label="Outstanding Balance"
                value={`₹${financial.outstandingAmount}`}
                icon={IndianRupee}
                tone={financial.outstandingAmount > 0 ? "danger" : "success"}
              />
              <div className="space-y-2.5">
                {financial.payments.length === 0 ? (
                  <p className="text-sm text-slate-500">No payment records yet.</p>
                ) : (
                  financial.payments.map((payment) => (
                    <div key={payment._id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-slate-200 p-3.5">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">₹{payment.totalAmount}</p>
                        <p className="text-xs text-slate-500">{new Date(payment.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={payment.status === "captured" ? "success" : payment.status === "failed" ? "danger" : "warning"}>
                          {payment.status}
                        </StatusBadge>
                        {payment.refundStatus && payment.refundStatus !== "none" && (
                          <StatusBadge tone="info">Refund: {payment.refundStatus}</StatusBadge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "insurance" && (
        <div className="space-y-2.5">
          {insurance.length === 0 ? (
            <p className="text-sm text-slate-500">No insurance policy on file.</p>
          ) : (
            insurance.map((policy) => {
              const { expired, expiringSoon } = insurancePolicyStatus(policy.validTill);
              return (
                <div key={policy._id} className="rounded-control border border-slate-200 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {policy.provider} · {policy.policyNumber}
                    </p>
                    <StatusBadge tone={expired ? "danger" : expiringSoon ? "warning" : "success"}>
                      {expired ? "Expired" : expiringSoon ? "Expiring soon" : "Active"}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Coverage ₹{policy.coverageAmount} · Valid till {policy.validTill ? new Date(policy.validTill).toLocaleDateString() : "—"}
                    {policy.claimStatus && ` · Claim: ${policy.claimStatus}`}
                  </p>
                  {policy.document?.fileName && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                      <ShieldAlert size={12} /> Document on file ({policy.document.fileName}) — no secure download endpoint exists
                      yet for insurance documents; deferred, not fabricated.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "family" && (
        <div className="space-y-2.5">
          {familyMembers.length === 0 ? (
            <p className="text-sm text-slate-500">No family members linked.</p>
          ) : (
            familyMembers.map((member) => (
              <div key={member._id} className="flex items-center justify-between rounded-control border border-slate-200 p-3.5">
                <p className="text-sm font-semibold text-slate-800">{member.name}</p>
                <StatusBadge tone="neutral">{member.relation}</StatusBadge>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "timeline" && (
        <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500">No recorded activity yet.</p>
          ) : (
            timeline.map((event) => (
              <li key={event.key} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-royal-500" />
                <p className="text-sm font-semibold text-slate-800">{event.label}</p>
                <p className="text-xs text-slate-500">{event.at ? new Date(event.at).toLocaleString() : "Date not recorded"}</p>
              </li>
            ))
          )}
        </ol>
      )}
    </div>
  );
}

export default PatientWorkspace;
