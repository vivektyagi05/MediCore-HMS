import { Award, CheckCircle2, Download, FileText, NotebookPen, PlayCircle, Sparkles, StopCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import AdminTable from "../../components/admin/AdminTable";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import PrescriptionEditor from "../../components/prescription/PrescriptionEditor";
import PatientSnapshot from "../../components/clinical/PatientSnapshot";
import ClinicalTimeline from "../../components/clinical/ClinicalTimeline";
import CertificateGenerator from "../../components/clinical/CertificateGenerator";
import ClinicalAttentionPanel from "../../components/clinical/ClinicalAttentionPanel";
import OpenClinicalActions from "../../components/clinical/OpenClinicalActions";
import SinceLastVisitPanel, { MedicationReconciliation } from "../../components/clinical/SinceLastVisitPanel";
import AIClinicalCopilotDrawer from "../../components/clinical/AIClinicalCopilotDrawer";
import ConsultationReadiness from "../../components/clinical/ConsultationReadiness";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { aiAssistApi } from "../../api/aiAssistApi";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const prescriptionForm = {
  appointmentId: "",
  diagnosis: "",
  medicines: [{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }],
  notes: "",
  followUpDate: "",
};

// Statuses at which the patient's consultation record is considered final
// enough to prescribe against / write a note for. Matches PAYOUT_ELIGIBLE /
// note-eligible statuses on the backend — NOT just "completed", which used
// to silently hide every appointment still at consultation_completed or
// review_eligible.
const RECORD_ELIGIBLE_STATUSES = ["consultation_completed", "completed", "review_eligible"];
const ACTIVE_CONSULTATION_STATUSES = ["payment_completed", "consultation_started"];
const TABS = ["overview", "prescriptions", "notes", "certificates", "history"];

function DoctorClinicalWorkspace() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(TABS.includes(params.get("tab")) ? params.get("tab") : "prescriptions");
  const [allAppointments, setAllAppointments] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [history, setHistory] = useState([]);
  const [clinicalProfile, setClinicalProfile] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [medicineTemplates, setMedicineTemplates] = useState([]);
  const [favouriteMedicines, setFavouriteMedicines] = useState([]);
  const [safetyWarnings, setSafetyWarnings] = useState([]);
  const [lastPrescriptionId, setLastPrescriptionId] = useState("");
  const [form, setForm] = useState(prescriptionForm);
  const [noteForm, setNoteForm] = useState({ appointmentId: "", symptoms: "", notes: "", recommendations: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [reviewingReportId, setReviewingReportId] = useState("");
  const [confirmingCompletionId, setConfirmingCompletionId] = useState("");
  const toast = useToast();
  const { t } = useI18n();
  const queryString = params.toString();
  const patientId = params.get("patientId") || "";
  const safetyCheckTimer = useRef(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const [apptRes, rxRes, noteRes, historyRes, templatesRes, favouritesRes] = await Promise.all([
        appointmentApi.getAppointments({ limit: 100, status: params.get("status") || undefined, patientId: patientId || undefined }),
        doctorWorkflowApi.getPrescriptions({ search: params.get("search") || undefined, patientId: patientId || undefined }),
        doctorWorkflowApi.getNotes({ search: params.get("search") || undefined, patientId: patientId || undefined }),
        doctorWorkflowApi.getHistory({ from: params.get("from") || undefined, to: params.get("to") || undefined, patientId: patientId || undefined }),
        doctorWorkflowApi.getMedicineTemplates(),
        doctorWorkflowApi.getFavouriteMedicines(),
      ]);

      setAllAppointments(apptRes.data.appointments || []);
      setPrescriptions(rxRes.data.prescriptions || []);
      setNotes(noteRes.data.notes || []);
      setHistory(historyRes.data.history || []);
      setMedicineTemplates(templatesRes.data.templates || []);
      setFavouriteMedicines(favouritesRes.data.favourites || []);

      if (patientId) {
        const [profileRes, certRes] = await Promise.all([
          doctorWorkflowApi.getPatientClinicalProfile(patientId),
          doctorWorkflowApi.getCertificates({ patientId }),
        ]);
        setClinicalProfile(profileRes.data);
        setCertificates(certRes.data.certificates || []);
      } else {
        setClinicalProfile(null);
        setCertificates([]);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
     
  }, [queryString]);

  // Live prescription safety check (Step 4/8): debounced against the real
  // backend rules — never a client-side guess at allergy/dosage logic.
  useEffect(() => {
    const hasContent = form.medicines.some((m) => m.name.trim());
    if (!hasContent) {
      setSafetyWarnings([]);
      return undefined;
    }
    clearTimeout(safetyCheckTimer.current);
    safetyCheckTimer.current = setTimeout(async () => {
      try {
        const res = await doctorWorkflowApi.checkPrescriptionSafety({
          appointmentId: form.appointmentId || undefined,
          medicines: form.medicines.filter((m) => m.name.trim()),
        });
        setSafetyWarnings(res.data.warnings || []);
      } catch {
        // A failed check just means no warnings surfaced yet — never blocks typing.
      }
    }, 600);
    return () => clearTimeout(safetyCheckTimer.current);
     
  }, [JSON.stringify(form.medicines), form.appointmentId]);

  const eligibleAppointments = useMemo(
    () => allAppointments.filter((appointment) => RECORD_ELIGIBLE_STATUSES.includes(appointment.status)),
    [allAppointments],
  );

  const activeConsultations = useMemo(
    () => allAppointments.filter((appointment) => ACTIVE_CONSULTATION_STATUSES.includes(appointment.status)),
    [allAppointments],
  );

  // Consultation that ended (CONSULTATION_COMPLETED) and are ready for the
  // one-click "Complete Consultation" action — backend now requires a
  // prescription or note to exist first (Step 8 safety guard).
  const consultationsAwaitingCompletion = useMemo(
    () => allAppointments.filter((appointment) => appointment.status === "consultation_completed"),
    [allAppointments],
  );

  // Phase DOC-06: the note form and the prescription form used to track two
  // independent appointmentId selections, so a doctor picking a consultation
  // in one form had to pick it again in the other. This keeps them in sync
  // without touching either form component's own props/behaviour — only the
  // appointment field is mirrored, nothing else.
  const setPrescriptionForm = (updater) => {
    setForm((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next.appointmentId !== current.appointmentId) {
        setNoteForm((prev) => ({ ...prev, appointmentId: next.appointmentId }));
      }
      return next;
    });
  };

  const setNoteAppointment = (appointmentId) => {
    setNoteForm((prev) => ({ ...prev, appointmentId }));
    setForm((prev) => ({ ...prev, appointmentId }));
  };

  // Real, already-loaded data only — never fabricated. Tells the doctor
  // exactly what documentation already exists for the consultation they
  // have selected, so "Complete Consultation" never feels like a surprise.
  const activeConsultationId = form.appointmentId;
  const activeConsultationNote = useMemo(
    () => notes.find((note) => String(note.appointmentId) === activeConsultationId),
    [notes, activeConsultationId],
  );
  const activeConsultationPrescription = useMemo(
    () => prescriptions.find((prescription) => String(prescription.appointmentId) === activeConsultationId),
    [prescriptions, activeConsultationId],
  );
  // PHASE P6 — Consultation Readiness only applies to a consultation that
  // has actually reached the backend's completion-eligible state (same
  // list the "One-click Complete Consultation" section above already
  // reads) — never fabricates eligibility for a consultation still active.
  const activeConsultationAwaitingCompletion = useMemo(
    () => consultationsAwaitingCompletion.find((appointment) => String(appointment._id) === activeConsultationId),
    [consultationsAwaitingCompletion, activeConsultationId],
  );

  const savePrescription = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const res = await doctorWorkflowApi.createPrescription(form);
      toast.success("Prescription saved");
      setLastPrescriptionId(res.data.prescription._id);
      if (res.data.safetyWarnings?.length) {
        toast.error(`Saved with ${res.data.safetyWarnings.length} safety warning(s) — review the prescription.`);
      }
      setForm(prescriptionForm);
      setSafetyWarnings([]);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const addFavourite = async (medicine) => {
    try {
      await doctorWorkflowApi.addFavouriteMedicine(medicine);
      toast.success(`${medicine.name} added to favourites`);
      const res = await doctorWorkflowApi.getFavouriteMedicines();
      setFavouriteMedicines(res.data.favourites || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const saveNote = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await doctorWorkflowApi.createNote({ ...noteForm, symptoms: noteForm.symptoms.split(",").map((item) => item.trim()).filter(Boolean) });
      toast.success("Medical note saved");
      setNoteForm({ appointmentId: "", symptoms: "", notes: "", recommendations: "" });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const downloadRx = async (id) => {
    const blob = await doctorWorkflowApi.downloadPrescription(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prescription-${id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const reviewReport = async (reportId) => {
    setReviewingReportId(reportId);
    try {
      await doctorWorkflowApi.reviewPatientReport(patientId, reportId);
      toast.success("Report marked as reviewed");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setReviewingReportId("");
    }
  };

  const advanceConsultation = async (appointmentId, nextStatus) => {
    setUpdatingId(appointmentId);
    try {
      await appointmentApi.updateAppointmentStatus(appointmentId, { status: nextStatus });
      const labels = {
        consultation_started: "Consultation started",
        consultation_completed: "Consultation ended",
        completed: "Consultation completed",
      };
      toast.success(labels[nextStatus] || "Status updated");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setUpdatingId("");
    }
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setParams({ ...Object.fromEntries(params), tab });
  };

  // Real route hints already computed by computeDoctorPatientAttentionItems
  // — gap-closure fix: each action now resolves to the place that actually
  // matches it (report → reports card, follow-up → scheduling, allergy/
  // profile → patient context) instead of every non-chat/appointments item
  // dumping into the Consultation tab.
  // PHASE P10 — optional appointmentId reuses the existing P3 deep-link
  // convention (?highlight=) so a "Follow-up appointment scheduled" open
  // clinical action jumps straight to that appointment instead of just the
  // patient's general appointment list. Fully additive: every existing
  // caller that doesn't pass one behaves exactly as before.
  const handleAttentionAction = (action, appointmentId) => {
    if (action === "chat") navigate(`/doctor/patients/${patientId}?tab=communication`);
    else if (action === "followup") navigate(`/doctor/patients/${patientId}?tab=appointments`);
    else if (action === "appointments") {
      navigate(
        appointmentId
          ? `/doctor/appointments?patientId=${patientId}&highlight=${appointmentId}`
          : `/doctor/appointments?patientId=${patientId}`,
      );
    }
    else if (action === "report") switchTab("overview");
    else if (action === "profile") navigate(`/doctor/patients/${patientId}`);
    else switchTab("prescriptions");
  };

  if (isLoading) return <Loader label="Loading clinical workspace" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Clinical Intelligence Workspace</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Consultation, prescriptions, and patient history</h1>
        </div>
        {patientId && (
          <Button variant="secondary" onClick={() => setIsCopilotOpen(true)}>
            <Sparkles size={16} /> AI Copilot
          </Button>
        )}
      </div>

      {clinicalProfile && <PatientSnapshot profile={clinicalProfile} />}

      {clinicalProfile?.attentionItems?.length > 0 && (
        <Card title="Clinical Attention">
          <ClinicalAttentionPanel items={clinicalProfile.attentionItems} onAction={handleAttentionAction} />
        </Card>
      )}

      {/* PHASE P6 (gap-closure) — Since Last Visit sits in the persistent
          spine (not gated behind a single tab) because it's needed whether
          the doctor is reviewing or actively documenting. */}
      {clinicalProfile && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Since Last Visit">
            <SinceLastVisitPanel comparison={clinicalProfile.sinceLastVisit} />
          </Card>
          <Card title="Medication Reconciliation">
            <MedicationReconciliation reconciliation={clinicalProfile.medicationReconciliation} />
          </Card>
        </div>
      )}

      <AIClinicalCopilotDrawer
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        patientId={patientId}
        patientName={clinicalProfile?.patient?.name}
      />

      {activeConsultations.length > 0 && (
        <Card title="Consultation Timer & Actions">
          <div className="space-y-3">
            {activeConsultations.map((appointment) => (
              <div key={appointment._id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg">
                <div>
                  <p className="font-black text-slate-950">{appointment.patientId?.name}</p>
                  <p className="text-sm text-slate-500">{new Date(appointment.date).toLocaleDateString()} · {appointment.timeSlot}</p>
                </div>
                {appointment.status === "payment_completed" ? (
                  <Button isLoading={updatingId === appointment._id} onClick={() => advanceConsultation(appointment._id, "consultation_started")}>
                    <PlayCircle size={16} /> Start Consultation
                  </Button>
                ) : (
                  <Button isLoading={updatingId === appointment._id} onClick={() => advanceConsultation(appointment._id, "consultation_completed")}>
                    <StopCircle size={16} /> End Consultation
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {consultationsAwaitingCompletion.length > 0 && (
        <Card title="One-click Complete Consultation">
          <div className="space-y-3">
            {consultationsAwaitingCompletion.map((appointment) => (
              <div key={appointment._id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-4">
                <div>
                  <p className="font-black text-slate-950">{appointment.patientId?.name}</p>
                  <p className="text-xs text-slate-500">Requires a prescription or clinical note on file before it can be marked complete.</p>
                </div>
                <Button isLoading={updatingId === appointment._id} onClick={() => setConfirmingCompletionId(appointment._id)}>
                  <CheckCircle2 size={16} /> Complete Consultation
                </Button>
              </div>
            ))}
          </div>
          <ConfirmDialog
            isOpen={Boolean(confirmingCompletionId)}
            title="Complete Consultation?"
            confirmLabel="Complete Consultation"
            tone="primary"
            isLoading={updatingId === confirmingCompletionId}
            description="This finalizes the consultation using MediCore's existing completion rules — no new status transition is introduced."
            onClose={() => setConfirmingCompletionId("")}
            onConfirm={async () => {
              await advanceConsultation(confirmingCompletionId, "completed");
              setConfirmingCompletionId("");
            }}
          />
        </Card>
      )}

      <div className="grid gap-3 rounded-2xl bg-white/50 p-4 shadow-lg lg:grid-cols-[1fr_auto]">
        <Input placeholder="Search consultations..." value={params.get("search") || ""} onChange={(e) => setParams({ ...Object.fromEntries(params), search: e.target.value })} />
        <div className="flex flex-wrap gap-2">
          {/* Phase DOC-06: "notes" is kept as a real, working tab value (many
              pages deep-link with ?tab=notes / ?tab=history — Dashboard,
              Patients, Appointments, review/appointment drawers) but is no
              longer shown as its own button. Documentation and prescribing
              are one workflow now, so both "notes" and "prescriptions" open
              the same combined Consultation view below. */}
          {(patientId ? TABS : TABS.filter((tab) => tab !== "overview"))
            .filter((tab) => tab !== "notes")
            .map((tab) => (
              <Button
                key={tab}
                variant={activeTab === tab || (tab === "prescriptions" && activeTab === "notes") ? "primary" : "secondary"}
                onClick={() => switchTab(tab)}
              >
                {{ overview: "Overview", prescriptions: "Consultation", certificates: "Certificates", history: "History" }[tab] || tab}
              </Button>
            ))}
        </div>
      </div>

      {activeTab === "overview" && clinicalProfile && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card title="Patient Timeline">
              <ClinicalTimeline timeline={clinicalProfile.timeline} />
            </Card>
            <Card title="Open Clinical Actions">
              <OpenClinicalActions
                actions={clinicalProfile.openClinicalActions}
                onAction={(item) => handleAttentionAction(item.action, item.appointmentId)}
              />
            </Card>
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card title="Reports on File">
              {clinicalProfile.reports?.length ? (
                <div className="space-y-2">
                  {clinicalProfile.reports.map((report) => (
                    <div key={report._id} className="flex items-center justify-between rounded-xl bg-white/60 p-3 text-sm shadow">
                      <div>
                        <p className="font-bold text-slate-900">{report.title}</p>
                        <p className="text-xs text-slate-500">{report.category} · {report.reportDate ? new Date(report.reportDate).toLocaleDateString() : "no date"}</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${report.reviewedAt ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {report.reviewedAt ? `Reviewed ${new Date(report.reviewedAt).toLocaleDateString()}` : "Not yet reviewed"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!report.reviewedAt && (
                          <Button variant="secondary" isLoading={reviewingReportId === report._id} onClick={() => reviewReport(report._id)}>
                            <CheckCircle2 size={14} /> Mark Reviewed
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            const blob = await doctorWorkflowApi.downloadPatientReport(patientId, report._id);
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = report.fileName || `report-${report._id}`;
                            link.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          <Download size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No reports on file" description="Lab/radiology reports the patient uploads will appear here." />
              )}
            </Card>
            {/* PHASE P6 (gap-closure §12) — Brief + Copilot as one coherent
                intelligence layer: the brief generates here, and "Ask
                Copilot" opens the SAME drawer used everywhere else in the
                workspace, sharing one evidence-backed grounding model. */}
            <div className="space-y-4">
              <AIDraftPanel
                title="AI: Patient Clinical Brief"
                actionLabel="Generate Brief"
                onGenerate={() => aiAssistApi.getPatientClinicalBrief(patientId)}
                compact
              />
              <Button variant="secondary" className="w-full" onClick={() => setIsCopilotOpen(true)}>
                <Sparkles size={14} /> Ask Copilot about this brief
              </Button>
            </div>
          </div>
        </div>
      )}

      {(activeTab === "prescriptions" || activeTab === "notes") && (
        <div className="space-y-6">
          {/* Shared consultation picker + real, already-loaded documentation
              status — the doctor sees at a glance what's already on file for
              the consultation they're working, before writing anything new.
              Never fabricated: both checks come straight from the notes/
              prescriptions arrays already fetched for this doctor. */}
          <div className="grid gap-6 xl:grid-cols-[0.8fr_1.3fr_1fr]">
            {/* LEFT — Patient Context (supporting, condensed; the full
                header above already carries identity/allergy alert). */}
            <div className="space-y-6">
              <Card title="Patient Context">
                {clinicalProfile ? (
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Allergies</p>
                      <p className={clinicalProfile.allergies?.length ? "font-bold text-rose-600" : "text-slate-500"}>
                        {clinicalProfile.allergies?.length ? clinicalProfile.allergies.join(", ") : "None on file"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Current Medicines</p>
                      {clinicalProfile.currentMedications?.length ? (
                        <ul className="list-inside list-disc text-slate-700">
                          {clinicalProfile.currentMedications.map((m, i) => <li key={i}>{m.name}</li>)}
                        </ul>
                      ) : (
                        <p className="text-slate-500">None on file</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Vitals</p>
                      {clinicalProfile.vitals && Object.values(clinicalProfile.vitals).some(Boolean) ? (
                        <p className="text-slate-700">
                          {[
                            clinicalProfile.vitals.heightCm && `Height ${clinicalProfile.vitals.heightCm}cm`,
                            clinicalProfile.vitals.weightKg && `Weight ${clinicalProfile.vitals.weightKg}kg`,
                            clinicalProfile.vitals.bloodPressureSystolic && `BP ${clinicalProfile.vitals.bloodPressureSystolic}/${clinicalProfile.vitals.bloodPressureDiastolic}`,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      ) : (
                        <p className="text-slate-500">Not recorded</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Recent Reports</p>
                      {clinicalProfile.reports?.length ? (
                        <ul className="space-y-1 text-slate-700">
                          {clinicalProfile.reports.slice(0, 3).map((r) => (
                            <li key={r._id}>{r.title} <span className="text-xs text-slate-400">({r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "no date"})</span></li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-slate-500">None on file</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Last Visit</p>
                      <p className="text-slate-700">{clinicalProfile.lastVisit ? new Date(clinicalProfile.lastVisit).toLocaleDateString() : "No prior visit on file"}</p>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="No patient selected" description="Pick a patient to see their clinical context here." />
                )}
              </Card>
            </div>

            {/* CENTER — Consultation, the PRIMARY work area. */}
            <div className="space-y-6">
              <Card title="Current Consultation">
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm"
                  value={activeConsultationId}
                  onChange={(e) => setNoteAppointment(e.target.value)}
                >
                  <option value="">Select a consultation to document…</option>
                  {eligibleAppointments.map((appointment) => (
                    <option key={appointment._id} value={appointment._id}>
                      {appointment.patientId?.name} - {new Date(appointment.date).toLocaleDateString()} {appointment.timeSlot}
                    </option>
                  ))}
                </select>
                {activeConsultationId && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className={`rounded-full px-3 py-1 ${activeConsultationNote ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      Clinical note {activeConsultationNote ? "✓ saved" : "— not yet documented"}
                    </span>
                    <span className={`rounded-full px-3 py-1 ${activeConsultationPrescription ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      Prescription {activeConsultationPrescription ? "✓ saved" : "— not yet written"}
                    </span>
                  </div>
                )}
              </Card>

              <Card title="SOAP / Medical Note">
                <form className="grid gap-4" onSubmit={saveNote}>
                  <Input label="Symptoms" placeholder="fever, cough" value={noteForm.symptoms} onChange={(e) => setNoteForm({ ...noteForm, symptoms: e.target.value })} />
                  <textarea className="min-h-28 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" placeholder="Clinical notes" value={noteForm.notes} onChange={(e) => setNoteForm({ ...noteForm, notes: e.target.value })} />
                  <textarea className="min-h-20 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" placeholder="Recommendations" value={noteForm.recommendations} onChange={(e) => setNoteForm({ ...noteForm, recommendations: e.target.value })} />
                  <Button type="submit" isLoading={isSaving} disabled={!noteForm.appointmentId}>Save Note</Button>
                </form>
                {noteForm.appointmentId && (
                  <div className="mt-5 space-y-4">
                    <AIDraftPanel
                      title="AI: Draft Clinical Note"
                      actionLabel="Draft Clinical Note"
                      onGenerate={() => aiAssistApi.draftClinicalNote({ appointmentId: noteForm.appointmentId })}
                      onInsert={(content) =>
                        setNoteForm((prev) => ({
                          ...prev,
                          notes: [content.subjective, content.objective].filter(Boolean).join("\n\n"),
                          recommendations: [content.assessment, content.plan].filter(Boolean).join("\n"),
                        }))
                      }
                      insertLabel="Insert into note"
                      compact
                    />
                    <AIDraftPanel
                      title="AI: Consultation Summary"
                      actionLabel="Draft Summary"
                      onGenerate={() => aiAssistApi.draftConsultationSummary({ appointmentId: noteForm.appointmentId })}
                      onInsert={(content) => setNoteForm((prev) => ({ ...prev, notes: typeof content === "string" ? content : prev.notes }))}
                      insertLabel="Insert into note"
                      compact
                    />
                    <AIDraftPanel
                      title="AI Consultation Assistant"
                      actionLabel="Get pre-charting suggestions"
                      onGenerate={() => aiAssistApi.getConsultationAssistant(noteForm.appointmentId)}
                      onInsert={(content) =>
                        setNoteForm((prev) => ({
                          ...prev,
                          recommendations: [
                            prev.recommendations,
                            ...(content.investigationsToConsider || []),
                            ...(content.lifestyleGuidance || []),
                            content.referralNote,
                          ]
                            .filter(Boolean)
                            .join("\n"),
                        }))
                      }
                      insertLabel="Add to recommendations"
                      compact
                    />
                  </div>
                )}
              </Card>

              <Card title="Diagnosis & Prescription">
                <PrescriptionEditor
                  form={form}
                  setForm={setPrescriptionForm}
                  appointments={eligibleAppointments}
                  onSubmit={savePrescription}
                  isSaving={isSaving}
                  medicineTemplates={medicineTemplates}
                  favouriteMedicines={favouriteMedicines}
                  safetyWarnings={safetyWarnings}
                  onAddFavourite={addFavourite}
                />
              </Card>
            </div>

            {/* RIGHT — AI supporting intelligence (never primary; the
                consultation above works fully without it, per §16). */}
            <div className="space-y-6">
              <Button variant="secondary" className="w-full" onClick={() => setIsCopilotOpen(true)}>
                <Sparkles size={14} /> Ask AI Copilot
              </Button>
              {lastPrescriptionId && (
                <AIDraftPanel
                  title="AI: Follow-up Suggestion"
                  actionLabel="Suggest Follow-up Window"
                  onGenerate={() => aiAssistApi.getPrescriptionFollowUpSuggestion(lastPrescriptionId)}
                  compact
                />
              )}
              {lastPrescriptionId && (
                <AIDraftPanel
                  title="AI: Patient Education Summary"
                  actionLabel="Draft patient-friendly summary"
                  onGenerate={() => aiAssistApi.getPatientEducationSummary(lastPrescriptionId)}
                  compact
                />
              )}
            </div>
          </div>

          {/* Consultation Readiness + Complete — its own full-width band
              beneath the 3-column work area, exactly as required, never a
              fabricated percentage: every check reads real note/
              prescription/follow-up state computed above. */}
          {activeConsultationAwaitingCompletion && (
            <Card title="Consultation Readiness">
              <ConsultationReadiness
                hasNote={Boolean(activeConsultationNote)}
                hasPrescription={Boolean(activeConsultationPrescription)}
                hasFollowUp={Boolean(activeConsultationPrescription?.followUpDate)}
                isCompleting={updatingId === activeConsultationId}
                onComplete={() => advanceConsultation(activeConsultationId, "completed")}
              />
            </Card>
          )}

          {/* Secondary — browsing prior consultations across patients, not
              the current workflow. Deliberately below the fold: the spec's
              golden rule is that this page is a workstation, not a
              dashboard, so the active documentation task stays primary. */}
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Prescription Library">
              {prescriptions.length ? (
                <AdminTable
                  columns={[
                    { key: "patientId", header: "Patient", render: (row) => row.patientId?.name },
                    { key: "diagnosis", header: "Diagnosis" },
                    { key: "createdAt", header: "Date", render: (row) => new Date(row.createdAt).toLocaleDateString() },
                    { key: "actions", header: "PDF", render: (row) => <Button variant="secondary" onClick={() => downloadRx(row._id)}><Download size={16} /></Button> },
                  ]}
                  data={prescriptions}
                />
              ) : (
                <EmptyState title="No prescriptions yet" description="Prescriptions you write will appear here." />
              )}
            </Card>
            <Card title="Searchable Notes">
              {notes.length ? (
                <AdminTable columns={[{ key: "patientId", header: "Patient", render: (row) => row.patientId?.name }, { key: "symptoms", header: "Symptoms", render: (row) => row.symptoms.join(", ") }, { key: "notes", header: t("dashboard.patient.notes") }]} data={notes} />
              ) : (
                <EmptyState title="No notes yet" description="Clinical notes you save will appear here." />
              )}
            </Card>
          </div>
        </div>
      )}
      {activeTab === "certificates" && (
        <Card title="Certificate Generator">
          {patientId ? (
            <CertificateGenerator
              patientId={patientId}
              certificates={certificates}
              onIssued={load}
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                <Award size={14} className="mr-1 inline" /> Open this tab from a specific patient (via Patients → Clinical Workspace) to issue a new certificate.
              </div>
              {certificates.length ? null : <EmptyState title="No patient selected" description="Certificates are always issued for one specific patient." />}
            </div>
          )}
        </Card>
      )}
      {activeTab === "history" && (
        <Card title="Consultation Timeline">
          {history.length ? (
            <div className="space-y-4">
              {history.map((item) => (
                <div key={item._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                  <div className="flex items-start gap-4">
                    <div className="rounded-xl bg-slate-950 p-3 text-white"><FileText size={18} /></div>
                    <div><p className="font-black text-slate-950">{item.patientId?.name}</p><p className="mt-1 text-sm text-slate-500">{item.prescriptionIds.length} prescriptions • {item.noteIds.length} notes</p></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No consultation history yet" description="Consultation history builds up as prescriptions and notes are recorded." />
          )}
        </Card>
      )}
      <Card title="Communication Note">
        <div className="flex gap-4 rounded-2xl bg-slate-950 p-5 text-white"><NotebookPen className="text-blue-400" /><p className="text-sm text-slate-300">Appointment issues can be recorded in medical notes today; the API is isolated so this can move to sockets later.</p></div>
      </Card>
    </div>
  );
}

export default DoctorClinicalWorkspace;
