import { Award, Download, FileText, Pin, PinOff, Printer, Share2, Star, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import AdminModal from "../../components/admin/AdminModal";
import HealthEcosystemNav from "../../components/health/HealthEcosystemNav";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import SecureFilePreview from "../../components/shared/SecureFilePreview";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { aiAssistApi } from "../../api/aiAssistApi";

const reportFormInitial = { title: "", category: "", reportDate: "", notes: "", tags: "", familyMemberId: "", file: null };

function PatientRecords() {
  const [params, setParams] = useSearchParams();
  const [overview, setOverview] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsPagination, setReportsPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1, hasNext: false, hasPrevious: false });
  const [categories, setCategories] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [family, setFamily] = useState([]);
  const [form, setForm] = useState(reportFormInitial);
  const [preview, setPreview] = useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const toast = useToast();
  const { t } = useI18n();
  const queryString = params.toString();
  const currentPage = Math.max(Number.parseInt(params.get("page"), 10) || 1, 1);

  const load = async () => {
    setIsLoading(true);
    try {
      const search = params.get("search") || undefined;
      const [overviewRes, reportRes, rxRes, certRes, timelineRes, familyRes, categoriesRes] = await Promise.all([
        patientWorkflowApi.getEcosystemOverview(),
        patientWorkflowApi.getReports({
          search,
          category: params.get("category") || undefined,
          familyMemberId: params.get("familyMemberId") || undefined,
          pinned: params.get("pinned") || undefined,
          page: currentPage,
        }),
        patientWorkflowApi.getPrescriptions({ search }),
        patientWorkflowApi.getCertificates(),
        patientWorkflowApi.getTimeline({ search }),
        patientWorkflowApi.getFamily(),
        // PHASE P9 gap closure: category dropdown must reflect ALL of the
        // patient's categories, not just whichever page happens to be
        // loaded right now that listReports is properly paginated.
        patientWorkflowApi.getReportCategories(),
      ]);
      setOverview(overviewRes.data);
      setReports(reportRes.data.reports || []);
      setReportsPagination(reportRes.data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 1, hasNext: false, hasPrevious: false });
      setCategories(categoriesRes.data.categories || []);
      setPrescriptions(rxRes.data.prescriptions || []);
      setCertificates(certRes.data.certificates || []);
      setTimeline(timelineRes.data.timeline || []);
      setFamily(familyRes.data.familyMembers || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [queryString]);

  const downloadBlob = async (loader, name) => {
    const blob = await loader();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const uploadReport = async (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === "file") formData.append("report", value);
      else if (value) formData.append(key, value);
    });
    setIsUploading(true);
    try {
      await patientWorkflowApi.uploadReport(formData);
      toast.success("Report uploaded");
      setForm(reportFormInitial);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  };

  const togglePin = async (report) => {
    try {
      await patientWorkflowApi.updateReport(report._id, { isPinned: !report.isPinned });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    try {
      await patientWorkflowApi.updateReport(editing._id, {
        title: editing.title,
        category: editing.category,
        notes: editing.notes,
        tags: editing.tags,
      });
      toast.success("Report updated");
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const removeReport = async (report) => {
    if (!window.confirm(`Delete "${report.title}"? This cannot be undone.`)) return;
    try {
      await patientWorkflowApi.deleteReport(report._id);
      toast.success("Report deleted");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const shareReport = async (report) => {
    const shareText = `${report.title} (${report.category}) — ${new Date(report.reportDate).toLocaleDateString()}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: report.title, text: shareText });
        return;
      } catch {
        // user cancelled share sheet — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(shareText);
    toast.success("Report details copied to clipboard");
  };

  const exportData = async (resource, format) => {
    await downloadBlob(() => patientWorkflowApi.exportData({ resource, format }), `${resource}.${format}`);
  };

  const setParam = (key, value) => {
    const next = Object.fromEntries(params);
    if (value) next[key] = value;
    else delete next[key];
    // A real filter change invalidates whatever page the patient was on —
    // same convention as PatientPayments' setPage(1) on filter change —
    // so they never land on an empty "page 4 of 1" after narrowing results.
    if (key !== "page") delete next.page;
    setParams(next);
  };

  const setPage = (page) => {
    const next = Object.fromEntries(params);
    if (page > 1) next.page = String(page);
    else delete next.page;
    setParams(next);
  };

  if (isLoading) return <Loader label="Loading digital health records" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Digital Health Ecosystem</p><h1 className="mt-2 text-3xl font-black text-slate-950">Records, prescriptions, and health timeline</h1></div>
      <HealthEcosystemNav overview={overview} active="records" />
      <div className="grid gap-3 rounded-2xl bg-white/50 p-4 shadow-lg md:grid-cols-4">
        <Input placeholder="Search records..." value={params.get("search") || ""} onChange={(e) => setParam("search", e.target.value)} />
        <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={params.get("category") || ""} onChange={(e) => setParam("category", e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={params.get("familyMemberId") || ""} onChange={(e) => setParam("familyMemberId", e.target.value)}>
          <option value="">Everyone</option>
          {family.map((member) => <option key={member._id} value={member._id}>{member.name} ({member.relation})</option>)}
        </select>
        <div className="flex gap-2">
          <Button variant={params.get("pinned") === "true" ? "primary" : "secondary"} onClick={() => setParam("pinned", params.get("pinned") === "true" ? "" : "true")}>
            <Star size={16} /> Pinned
          </Button>
          <Button variant="secondary" onClick={() => exportData("reports", "csv")}><Download size={16} /></Button>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card title={t("patient.records.upload")}>
          <form className="grid gap-4" onSubmit={uploadReport}>
            <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Lab report, prescription, radiology..." required />
            <Input label="Report date" type="date" value={form.reportDate} onChange={(e) => setForm({ ...form, reportDate: e.target.value })} required />
            <Input label="Tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="comma, separated, tags" />
            <div>
              <span className="mb-2 block text-sm font-semibold text-slate-700">For</span>
              <select className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.familyMemberId} onChange={(e) => setForm({ ...form, familyMemberId: e.target.value })}>
                <option value="">Myself</option>
                {family.map((member) => <option key={member._id} value={member._id}>{member.name} ({member.relation})</option>)}
              </select>
            </div>
            <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} className="rounded-xl bg-white/70 p-3 text-sm" required />
            <textarea className="min-h-24 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <Button type="submit" isLoading={isUploading} disabled={!form.file}>Upload Report</Button>
          </form>
        </Card>
        <div>
          {reports.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {reports.map((report) => (
                <Card key={report._id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg">
                        <FileText size={21} />
                      </div>
                      <p className="truncate text-lg font-black text-slate-950">{report.title}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{report.category} • {new Date(report.reportDate).toLocaleDateString()}</p>
                      {report.familyMemberId && <p className="mt-1 text-xs font-bold text-blue-600">For {report.familyMemberId.name}</p>}
                      {report.doctorId?.userId?.name && <p className="mt-1 text-xs font-semibold text-slate-500">Dr. {report.doctorId.userId.name}</p>}
                      {report.appointmentId && <p className="mt-1 text-xs font-semibold text-slate-500">Linked to visit on {new Date(report.appointmentId.date).toLocaleDateString()}</p>}
                      {report.tags?.length ? <p className="mt-3 text-xs font-bold text-blue-600">{report.tags.join(" / ")}</p> : null}
                    </div>
                    <button onClick={() => togglePin(report)} title={report.isPinned ? "Unpin" : "Pin"} className={`shrink-0 rounded-lg p-2 ${report.isPinned ? "bg-blue-600 text-white" : "bg-white/60 text-slate-400 hover:text-blue-600"}`}>
                      {report.isPinned ? <Pin size={16} /> : <PinOff size={16} />}
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setPreview(report)}>Preview</Button>
                    <Button onClick={() => downloadBlob(() => patientWorkflowApi.downloadReport(report._id), report.fileName)}><Download size={16} /></Button>
                    <Button variant="secondary" onClick={() => shareReport(report)}><Share2 size={16} /></Button>
                    <Button variant="secondary" onClick={() => setEditing({ ...report, tags: report.tags?.join(", ") || "" })}>Edit</Button>
                    <Button variant="secondary" onClick={() => removeReport(report)}><Trash2 size={16} /></Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState title="No records yet" description="Upload a report to start building this patient's lifelong digital health file." />
          )}
          {reportsPagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button variant="secondary" disabled={!reportsPagination.hasPrevious} onClick={() => setPage(reportsPagination.page - 1)}>Previous</Button>
              <span className="text-sm font-bold text-slate-600">Page {reportsPagination.page} of {reportsPagination.totalPages} · {reportsPagination.total} total</span>
              <Button variant="secondary" disabled={!reportsPagination.hasNext} onClick={() => setPage(reportsPagination.page + 1)}>Next</Button>
            </div>
          )}
        </div>
      </div>
      <Card title="Prescription Timeline">
        {prescriptions.length ? (
          <div className="space-y-3">
            {prescriptions.map((rx) => (
              <div key={rx._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div><p className="font-black text-slate-950">{rx.diagnosis}</p><p className="mt-1 text-sm text-slate-500">{rx.medicines.length} medicines • Follow-up {rx.followUpDate ? new Date(rx.followUpDate).toLocaleDateString() : "not set"}</p></div>
                  <div className="flex gap-2"><Button variant="secondary" onClick={() => setPrescriptionPreview(rx)}><Printer size={16} /> Print</Button><Button onClick={() => downloadBlob(() => patientWorkflowApi.downloadPrescription(rx._id), `prescription-${rx._id}.pdf`)}>Download</Button></div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">{rx.medicines.map((med) => <div key={med._id} className="rounded-xl bg-white/70 p-3"><p className="font-black">{med.name}</p><p className="text-sm text-slate-500">{med.dosage} • {med.frequency}</p></div>)}</div>
                <div className="mt-4">
                  <AIDraftPanel
                    title="AI: Explain this prescription"
                    actionLabel="Explain in plain language"
                    onGenerate={() => aiAssistApi.explainPrescription(rx._id)}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No prescriptions yet" description="Prescriptions from your doctor visits will appear here." />
        )}
      </Card>
      <Card title="Certificates">
        {certificates.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {certificates.map((certificate) => (
              <div key={certificate._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg">
                      <Award size={21} />
                    </div>
                    <p className="truncate text-lg font-black text-slate-950">{certificate.title}</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-slate-500">{certificate.type?.replace(/_/g, " ")} · {new Date(certificate.createdAt).toLocaleDateString()}</p>
                    {certificate.doctorId?.userId?.name && <p className="mt-1 text-xs font-semibold text-slate-500">Dr. {certificate.doctorId.userId.name}</p>}
                    {certificate.status === "revoked" && <p className="mt-2 text-xs font-bold text-rose-600">Revoked{certificate.revokedReason ? `: ${certificate.revokedReason}` : ""}</p>}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => downloadBlob(() => patientWorkflowApi.downloadCertificate(certificate._id), `certificate-${certificate._id}.pdf`)}><Download size={16} /> Download</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No certificates yet" description="Fitness, sick-leave, or referral certificates your doctor issues will appear here." />
        )}
      </Card>
      <Card title="Health Timeline">
        {timeline.length ? (
          <div className="space-y-4">{timeline.map((item, index) => <div key={`${item.type}-${index}`} className="rounded-2xl bg-white/60 p-4 shadow-lg"><p className="font-black capitalize text-blue-600">{item.type}</p><p className="mt-1 font-black text-slate-950">{item.title}</p><p className="text-sm text-slate-500">{new Date(item.date).toLocaleDateString()}</p></div>)}</div>
        ) : (
          <EmptyState title="Your timeline is empty" description="Appointments, reports, prescriptions, and payments will show up here as one connected history." />
        )}
      </Card>
      <AdminModal isOpen={Boolean(preview)} title={preview?.title || "Report preview"} onClose={() => setPreview(null)} size="xl">
        {preview && (
          <SecureFilePreview
            cacheKey={preview._id}
            mimeType={preview.mimeType}
            fileName={preview.fileName}
            fetchBlob={() => patientWorkflowApi.downloadReport(preview._id)}
            onDownload={() => downloadBlob(() => patientWorkflowApi.downloadReport(preview._id), preview.fileName)}
          />
        )}
        {preview?.notes && <p className="mt-4 text-sm leading-6 text-slate-600">{preview.notes}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => downloadBlob(() => patientWorkflowApi.downloadReport(preview._id), preview.fileName)}>Download secure file</Button>
        </div>
        {preview && (
          <div className="mt-4">
            <AIDraftPanel
              title="AI: Summarize this document"
              actionLabel="Summarize"
              onGenerate={() => aiAssistApi.summarizeDocument(preview._id)}
              compact
            />
          </div>
        )}
      </AdminModal>
      <AdminModal
        isOpen={Boolean(prescriptionPreview)}
        title={prescriptionPreview ? `Prescription · ${prescriptionPreview.diagnosis}` : "Prescription"}
        onClose={() => setPrescriptionPreview(null)}
        size="xl"
      >
        {prescriptionPreview && (
          // FIX (PHASE P9 gap closure): reuses the exact same source of
          // truth as the Download button (downloadPrescription -> the
          // doctor-generated PDF at prescription.pdfPath) — no second
          // prescription model, no re-rendered/re-derived document. The
          // only change from Download is where the fetched bytes go: into
          // an inline, print-scoped preview instead of straight to disk.
          <SecureFilePreview
            cacheKey={prescriptionPreview._id}
            mimeType="application/pdf"
            fileName={`prescription-${prescriptionPreview._id}.pdf`}
            fetchBlob={() => patientWorkflowApi.downloadPrescription(prescriptionPreview._id)}
            onDownload={() => downloadBlob(() => patientWorkflowApi.downloadPrescription(prescriptionPreview._id), `prescription-${prescriptionPreview._id}.pdf`)}
            showPrintButton
          />
        )}
      </AdminModal>
      <AdminModal isOpen={Boolean(editing)} title="Edit record" onClose={() => setEditing(null)}>
        {editing && (
          <form className="grid gap-4" onSubmit={saveEdit}>
            <Input label="Title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <Input label="Category" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
            <Input label="Tags" value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} />
            <textarea className="min-h-24 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" placeholder="Notes" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}><X size={16} /> Cancel</Button>
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        )}
      </AdminModal>
    </div>
  );
}

export default PatientRecords;
