import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  MessageSquare,
  FileText,
  Pill,
  Users,
  AlertTriangle,
  Download,
  Star,
} from "lucide-react";

import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import PatientSnapshot from "../../components/clinical/PatientSnapshot";
import ClinicalTimeline from "../../components/clinical/ClinicalTimeline";
import ConversationPanel from "../../components/realtime/ConversationPanel";
import ScheduleFollowUpDialog from "../../components/schedule/ScheduleFollowUpDialog";

import { useToast } from "../../context/ToastContext";
import { recordRecentlyViewedPatient } from "../../utils/doctorPatientPreferences";

function formatDate(value, opts) {
  if (!value) return "N/A";
  return new Date(value).toLocaleDateString(undefined, opts || { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}

const SEVERITY_STYLES = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  action_required: "border-blue-200 bg-blue-50 text-blue-700",
  info: "border-slate-200 bg-slate-50 text-slate-600",
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Clinical Timeline" },
  { key: "appointments", label: "Appointments" },
  { key: "prescriptions", label: "Prescriptions" },
  { key: "documents", label: "Documents" },
  { key: "communication", label: "Communication" },
];

function DoctorPatientProfile() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // Phase DOC-07 final pass — real follow-up scheduling from this page.
  const [followUpTarget, setFollowUpTarget] = useState(null);
  // STEP 6 — Deep Link Integrity: a tab is addressable via ?tab=, so
  // "Message this patient" / "Follow up on this patient" links from
  // elsewhere (patient list, dashboard attention items) land directly on
  // the right tab instead of always dropping the doctor on Overview.
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(
    TABS.some((tab) => tab.key === requestedTab) ? requestedTab : "overview",
  );
  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    }, { replace: true });
  };

  const [reports, setReports] = useState(null);
  const [reportsError, setReportsError] = useState("");
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await doctorWorkflowApi.getPatientClinicalProfile(patientId);
      setProfile(response.data);
      if (response.data?.patient) {
        recordRecentlyViewedPatient({ _id: patientId, name: response.data.patient.name, email: response.data.patient.email });
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [patientId]);

  const loadReports = async () => {
    if (reports) return;
    setIsLoadingReports(true);
    setReportsError("");
    try {
      const response = await doctorWorkflowApi.getPatientReports(patientId);
      setReports(response.data?.reports || []);
    } catch (err) {
      setReportsError(getApiErrorMessage(err));
    } finally {
      setIsLoadingReports(false);
    }
  };

  useEffect(() => {
    if (activeTab === "documents") loadReports();
  }, [activeTab]);

  const downloadReport = async (reportId, fileName) => {
    try {
      const blob = await doctorWorkflowApi.downloadPatientReport(patientId, reportId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName || "report";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  if (isLoading) return <Loader label="Loading patient profile..." />;
  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!profile) return null;

  const { appointments = [], prescriptions = [], reports: recentReports = [], insurance = [], family = [], timeline = [], attentionItems = [], followUp, scheduledFollowUps = [], unreadMessages, patient, reviews = [] } = profile;

  // Phase DOC-07 final pass: the pending prescription behind the follow-up
  // date shown above (if any) — real data only, never fabricated. Used so
  // "Schedule Follow-up" can link back to the actual prescription being
  // resolved (followUpScheduledAppointmentId), the same way the dashboard's
  // Follow-up Queue does.
  const pendingFollowUpDate = followUp?.overdue || (followUp?.bucket === "due_today" ? followUp.upcoming : null) || followUp?.upcoming;
  const pendingFollowUpPrescription = pendingFollowUpDate
    ? prescriptions.find((p) => !p.followUpScheduledAppointmentId && new Date(p.followUpDate).getTime() === new Date(pendingFollowUpDate).getTime())
    : null;

  // PHASE P10 — the most relevant scheduled-follow-up item for this card:
  // an active scheduled one takes priority over a completed one (nothing to
  // act on for a completed follow-up beyond what the timeline already
  // shows), and a cancelled-needs-action one takes priority over both since
  // it's the one state that actually needs the doctor back.
  const cancelledFollowUp = scheduledFollowUps.find((f) => f.bucket === "cancelled_needs_action");
  const activeScheduledFollowUp = scheduledFollowUps.find((f) => f.bucket === "scheduled");
  const cancelledFollowUpPrescription = cancelledFollowUp
    ? prescriptions.find((p) => String(p._id) === String(cancelledFollowUp.prescriptionId))
    : null;

  return (
    <div className="space-y-6">
      {/* HEADER / NAV */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("/doctor/patients")}
          className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Patients
        </button>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate(`/doctor/clinical?patientId=${patientId}&tab=history`)}>
            Open Clinical Workspace
          </Button>
          <Button onClick={() => setActiveTab("communication")}>
            <MessageSquare size={16} className="mr-1.5 inline" /> Message Patient
            {unreadMessages > 0 && <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{unreadMessages}</span>}
          </Button>
        </div>
      </div>

      {/* PATIENT HEADER (reuses the exact Clinical Workspace snapshot component) */}
      <PatientSnapshot profile={profile} />

      {/* ATTENTION */}
      {attentionItems.length > 0 && (
        <Card title="Needs Attention">
          <div className="grid gap-3 md:grid-cols-2">
            {attentionItems.map((item) => (
              <div key={item.key} className={`rounded-2xl border p-4 ${SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.info}`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-black">{item.what}</p>
                    <p className="mt-1 text-xs opacity-80">{item.why}</p>
                    <button
                      className="mt-2 text-xs font-black underline"
                      onClick={() => {
                        if (item.action === "chat") setActiveTab("communication");
                        else if (item.action === "appointments" || item.action === "followup") setActiveTab("appointments");
                        else if (item.action === "clinical") navigate(`/doctor/clinical?patientId=${patientId}&tab=notes`);
                        else if (item.action === "report") setActiveTab("documents");
                        else setActiveTab("overview");
                      }}
                    >
                      Open
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* TABS */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              activeTab === tab.key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Follow-up Status">
            <div className="flex items-start justify-between gap-3">
              <div>
                {cancelledFollowUp ? (
                  <p className="font-bold text-red-700">
                    Scheduled follow-up was cancelled ({formatDate(cancelledFollowUp.appointmentDate)}) — needs rescheduling
                  </p>
                ) : activeScheduledFollowUp ? (
                  <p className="font-bold text-violet-700">
                    Scheduled: {formatDate(activeScheduledFollowUp.appointmentDate)}
                    {activeScheduledFollowUp.appointmentTimeSlot ? ` at ${activeScheduledFollowUp.appointmentTimeSlot}` : ""}
                  </p>
                ) : followUp?.overdue ? (
                  <p className="font-bold text-red-700">Overdue since {formatDate(followUp.overdue)}</p>
                ) : followUp?.bucket === "due_today" ? (
                  <p className="font-bold text-amber-700">Due today ({formatDate(followUp.upcoming)})</p>
                ) : followUp?.upcoming ? (
                  <p className="font-bold text-slate-700">Upcoming: {formatDate(followUp.upcoming)}</p>
                ) : (
                  <p className="text-sm text-slate-500">No follow-up currently scheduled.</p>
                )}
              </div>
              {activeScheduledFollowUp ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(`/doctor/appointments?patientId=${patientId}&highlight=${activeScheduledFollowUp.appointmentId}`)}
                >
                  Open Appointment
                </Button>
              ) : (
                (cancelledFollowUp || followUp?.overdue || followUp?.bucket === "due_today" || followUp?.upcoming) && (
                  <Button
                    size="sm"
                    onClick={() =>
                      setFollowUpTarget({
                        patientId,
                        patientName: patient?.name || "this patient",
                        prescriptionId: cancelledFollowUp ? cancelledFollowUpPrescription?._id : pendingFollowUpPrescription?._id,
                        diagnosis: cancelledFollowUp ? cancelledFollowUpPrescription?.diagnosis : pendingFollowUpPrescription?.diagnosis,
                      })
                    }
                  >
                    Schedule Follow-up
                  </Button>
                )
              )}
            </div>
          </Card>

          <Card title="Family Members">
            {family.length ? (
              <div className="flex flex-wrap gap-2">
                {family.map((m) => (
                  <span key={m._id} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold">
                    <Users size={12} className="mr-1 inline" /> {m.name} ({m.relation})
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No family members linked.</p>
            )}
          </Card>

          <Card title="Insurance" className="lg:col-span-2">
            {insurance.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {insurance.map((policy) => (
                  <div key={policy._id} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-black text-slate-950">{policy.provider}</p>
                    <p className="text-xs text-slate-500">Policy #{policy.policyNumber}</p>
                    <p className="mt-1 text-xs font-bold text-slate-600">Valid till {formatDate(policy.validTill)}</p>
                    {policy.claimStatus && <p className="text-xs text-slate-500">Claim status: {policy.claimStatus}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No insurance on file.</p>
            )}
          </Card>

          {/* PHASE P3 — this patient's real reviews of this doctor. Reuses
              the exact Review model/fields the Reviews & Reputation
              workspace already reads; deep-links there via the existing
              reviewId focus mechanism (DOC-05) rather than building a
              second reply UI here. */}
          <Card title="Patient Reviews" className="lg:col-span-2">
            {reviews.length ? (
              <div className="space-y-3">
                {reviews.slice(0, 3).map((review) => (
                  <div key={review._id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
                    <div>
                      <p className="flex items-center gap-1 font-black text-slate-950">
                        {Array.from({ length: review.rating }).map((_, i) => (
                          <Star key={i} size={13} className="fill-amber-400 text-amber-400" />
                        ))}
                      </p>
                      {review.comment && <p className="mt-1 text-sm text-slate-600">{review.comment}</p>}
                      <p className="mt-1 text-xs text-slate-400">
                        {formatDate(review.createdAt)}{review.doctorReply?.message ? " · Replied" : " · Awaiting reply"}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/doctor/reviews?reviewId=${review._id}`)}>
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">This patient hasn't left a review yet.</p>
            )}
          </Card>

          <Card title="AI Patient Brief" className="lg:col-span-2">
            <AIDraftPanel
              title="AI Summary"
              actionLabel="Generate patient brief"
              onGenerate={() => aiAssistApi.getPatientClinicalBrief(patientId)}
              compact
            />
          </Card>
        </div>
      )}

      {/* CLINICAL TIMELINE (reuses the exact Clinical Workspace component) */}
      {activeTab === "timeline" && <ClinicalTimeline timeline={timeline} />}

      {/* APPOINTMENTS — deep-links into the real Appointments workspace
          (reschedule/cancel/full detail) instead of duplicating that state
          machine here. The Appointments page's existing ?patientId= filter
          (already supported server-side, previously had no frontend
          consumer) is what this links to. */}
      {activeTab === "appointments" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/doctor/appointments?patientId=${patientId}`)}>
              View all in Appointments
            </Button>
          </div>
          {appointments.length ? (
            appointments.map((appt) => (
              <Card key={appt._id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar size={18} className="text-blue-600" />
                    <div>
                      <p className="font-black text-slate-950">{formatDateTime(appt.date)}</p>
                      <p className="text-xs text-slate-500">{appt.reason || "No reason recorded"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-black capitalize">{appt.status?.replace(/_/g, " ")}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/doctor/appointments?patientId=${patientId}&highlight=${appt._id}`)}
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState title="No appointments yet" description="Appointments this doctor has had with this patient will appear here." />
          )}
        </div>
      )}

      {/* PRESCRIPTIONS */}
      {activeTab === "prescriptions" && (
        prescriptions.length ? (
          <div className="space-y-3">
            {prescriptions.map((rx) => (
              <Card key={rx._id}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Pill size={18} className="mt-1 text-blue-600" />
                    <div>
                      <p className="font-black text-slate-950">{rx.diagnosis}</p>
                      <p className="text-xs text-slate-500">{formatDate(rx.createdAt)} · {rx.medicines?.length || 0} medicine(s)</p>
                      {rx.followUpDate && <p className="mt-1 text-xs font-bold text-amber-700">Follow-up: {formatDate(rx.followUpDate)}</p>}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => doctorWorkflowApi.downloadPrescription(rx._id)}>
                    <Download size={14} />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No prescriptions yet" description="Prescriptions this doctor has issued for this patient will appear here." />
        )
      )}

      {/* DOCUMENTS (previously a real backend endpoint with zero frontend consumer — connected here) */}
      {activeTab === "documents" && (
        isLoadingReports ? (
          <Loader label="Loading documents..." />
        ) : reportsError ? (
          <ErrorState description={reportsError} onRetry={() => { setReports(null); loadReports(); }} />
        ) : (reports || recentReports).length ? (
          <div className="space-y-3">
            {(reports || recentReports).map((report) => (
              <Card key={report._id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText size={18} className="text-blue-600" />
                    <div>
                      <p className="font-black text-slate-950">{report.title}</p>
                      <p className="text-xs text-slate-500">{report.category} · {formatDate(report.reportDate)}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => downloadReport(report._id, report.fileName)}>
                    <Download size={14} />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No documents on file" description="Reports uploaded for this patient will appear here." />
        )
      )}

      {/* COMMUNICATION — genuinely embedded, live conversation (reuses the
          same ConversationPanel/chat engine ChatWorkspace uses; no second
          chat implementation). Preserves patient context: the doctor never
          has to leave the Relationship Center to message this patient. */}
      {activeTab === "communication" && (
        <Card title="Conversation">
          <ConversationPanel userId={patientId} height="55vh" typingLabel="Patient is typing" />
        </Card>
      )}

      <ScheduleFollowUpDialog
        target={followUpTarget}
        onClose={() => setFollowUpTarget(null)}
        onScheduled={async () => {
          setFollowUpTarget(null);
          await load();
        }}
      />
    </div>
  );
}

export default DoctorPatientProfile;
