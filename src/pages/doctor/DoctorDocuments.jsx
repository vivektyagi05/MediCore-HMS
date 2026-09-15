import { AlertTriangle, Award, CheckCircle2, Download, ExternalLink, FileText, Pill, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { commandCenterApi } from "../../api/commandCenterApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AdminTable from "../../components/admin/AdminTable";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const STATUS_STYLES = {
  verified: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-rose-100 text-rose-700",
};

const REPORT_PRIORITY_STYLES = {
  critical: "border-rose-300 bg-rose-50 text-rose-800",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

function DoctorDocuments() {
  const [overview, setOverview] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  // PHASE P9 — Documents & Records: patient reports awaiting review, across
  // ALL of this doctor's patients. Reuses the exact same
  // commandCenter.pendingReports the Dashboard's "Reports awaiting review"
  // count and top-5 preview already come from (computeReportAttentionItems,
  // one source of truth) — this page is simply where the FULL list lives,
  // since /doctor/documents is the natural home for "documents that need my
  // attention", not a second calculation or a new page.
  const [reportsAttention, setReportsAttention] = useState([]);
  const [reviewingReportId, setReviewingReportId] = useState(null);
  const [form, setForm] = useState({ title: "", type: "certification", expiryDate: "", file: null });
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const toast = useToast();
  const { t } = useI18n();

  // Deep-link support for Smart Inbox's "Open Documents" action
  // (/doctor/documents?documentId=...) — STEP 18 of the DOC-02 brief.
  const [searchParams] = useSearchParams();
  const highlightedDocumentId = searchParams.get("documentId") || "";
  const highlightedRef = useRef(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, certRes, rxRes, commandCenterRes] = await Promise.all([
        doctorWorkflowApi.getDocumentCenterOverview(),
        doctorWorkflowApi.getCertificates(),
        doctorWorkflowApi.getPrescriptions({ limit: 20 }),
        commandCenterApi.getCommandCenter().catch(() => null),
      ]);
      setOverview(overviewRes.data);
      setCertificates(certRes.data.certificates || []);
      setPrescriptions(rxRes.data.prescriptions || []);
      setReportsAttention(commandCenterRes?.data?.pendingReports || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markReportReviewed = async (reportId) => {
    setReviewingReportId(reportId);
    try {
      await commandCenterApi.markReportReviewed(reportId);
      setReportsAttention((current) => current.filter((r) => r.reportId !== reportId));
      toast.success("Report marked as reviewed");
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Couldn't mark this report reviewed. It's still in your queue below.");
    } finally {
      setReviewingReportId(null);
    }
  };

  // Once documents load, if a deep-linked document exists, clear filters so
  // it's guaranteed visible and scroll it into view.
  useEffect(() => {
    if (!highlightedDocumentId || !overview?.identityAndLicenses?.length) return;
    const exists = overview.identityAndLicenses.some((d) => d._id === highlightedDocumentId);
    if (!exists) return;
    setCategoryFilter("all");
    setSearch("");
  }, [highlightedDocumentId, overview]);

  const upload = async (event) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append("title", form.title);
    formData.append("type", form.type);
    if (form.expiryDate) formData.append("expiryDate", form.expiryDate);
    formData.append("document", form.file);
    setIsUploading(true);
    try {
      await doctorWorkflowApi.uploadDocument(formData);
      toast.success("Document uploaded for verification");
      setForm({ title: "", type: "certification", expiryDate: "", file: null });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  };

  const deleteDocument = async (id) => {
    try {
      await doctorWorkflowApi.deleteDocument(id);
      toast.success("Document removed");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const downloadCertificate = async (id) => {
    const blob = await doctorWorkflowApi.downloadCertificate(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `certificate-${id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadPrescription = async (id) => {
    const blob = await doctorWorkflowApi.downloadPrescription(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prescription-${id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Search + category filters run entirely on the already-loaded document
  // list — no extra request, no fabricated categories beyond the real
  // upload `type` values.
  const filteredDocuments = useMemo(() => {
    const all = overview?.identityAndLicenses || [];
    return all.filter((doc) => {
      const matchesCategory = categoryFilter === "all" || doc.type === categoryFilter;
      const matchesSearch = !search.trim() || doc.title.toLowerCase().includes(search.trim().toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [overview, categoryFilter, search]);

  useEffect(() => {
    if (highlightedDocumentId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedDocumentId, filteredDocuments]);

  if (isLoading) return <Loader label="Loading document center" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Document Center</p><h1 className="mt-2 text-3xl font-black text-slate-950">Professional Clinical Vault</h1></div>

      {(overview?.expiringSoon?.length > 0 || overview?.expired?.length > 0) && (
        <Card className="border border-amber-300 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 text-amber-600" />
            <div className="text-sm text-amber-800">
              {overview.expired.length > 0 && <p className="font-black">{overview.expired.length} document(s) already expired — renewal overdue.</p>}
              {overview.expiringSoon.length > 0 && <p>{overview.expiringSoon.length} document(s) expiring within 30 days.</p>}
            </div>
          </div>
        </Card>
      )}

      <Card title="Patient Reports Needing Review" action={reportsAttention.length > 0 ? <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">{reportsAttention.length} pending</span> : null}>
        {reportsAttention.length ? (
          <div className="space-y-2">
            {reportsAttention.map((r) => (
              <div key={r.reportId} className={`flex items-center justify-between rounded-xl border p-3 text-sm shadow-sm ${REPORT_PRIORITY_STYLES[r.priority] || REPORT_PRIORITY_STYLES.info}`}>
                <div>
                  <p className="font-bold">{r.title} <span className="ml-1 rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">{r.severity}</span></p>
                  <p className="text-xs opacity-80">{r.patientName} · {r.category} · {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "Date not recorded"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" to={`/doctor/clinical?patientId=${r.patientId}&tab=history`}><ExternalLink size={14} /> Open Patient</Button>
                  <Button isLoading={reviewingReportId === r.reportId} onClick={() => markReportReviewed(r.reportId)}><CheckCircle2 size={14} /> Mark Reviewed</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No reports awaiting review" description="Once a patient uploads a report against your name, it will appear here until you review it." />
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <Card title={t("doctor.documents.secureUpload")}>
          <form className="grid gap-4" onSubmit={upload}>
            <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="certification">Certification / Medical License</option>
              <option value="identity">Identity</option>
              <option value="profile">Profile</option>
              <option value="other">Other</option>
            </select>
            <Input label="Expiry date (optional)" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} className="rounded-xl bg-white/70 p-3 text-sm" />
            <Button type="submit" isLoading={isUploading} disabled={!form.file}><Upload size={17} /> Upload</Button>
          </form>
        </Card>

        <Card
          title="Identity, Licenses & Registrations"
          action={
            <div className="flex gap-2">
              <Input placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                <option value="certification">Certification</option>
                <option value="identity">Identity</option>
                <option value="profile">Profile</option>
                <option value="other">Other</option>
              </select>
            </div>
          }
        >
          {filteredDocuments.length ? (
            <AdminTable
              columns={[
                { key: "title", header: "Title" },
                { key: "type", header: "Type" },
                { key: "status", header: "Status", render: (r) => <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLES[r.status] || "bg-slate-100 text-slate-600"}`}>{r.status}</span> },
                { key: "expiryDate", header: "Expiry", render: (r) => (r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : "—") },
                { key: "uploadedAt", header: "Uploaded", render: (r) => new Date(r.uploadedAt).toLocaleDateString() },
                { key: "actions", header: "", render: (r) => <Button variant="secondary" onClick={() => deleteDocument(r._id)}><Trash2 size={14} /></Button> },
              ]}
              data={filteredDocuments}
              highlightRowId={highlightedDocumentId}
              highlightedRowRef={highlightedRef}
            />
          ) : (
            <EmptyState title="No documents found" description="Upload your license, registration, or identity documents above." />
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Generated Certificates">
          {certificates.length ? (
            <div className="space-y-2">
              {certificates.map((certificate) => (
                <div key={certificate._id} className="flex items-center justify-between rounded-xl bg-white/60 p-3 text-sm shadow">
                  <div className="flex items-center gap-2">
                    <Award size={15} className="text-blue-600" />
                    <div>
                      <p className="font-bold text-slate-900">{certificate.title}</p>
                      <p className="text-xs text-slate-500">{certificate.patientId?.name} · {new Date(certificate.createdAt).toLocaleDateString()} · {certificate.status}</p>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => downloadCertificate(certificate._id)}><Download size={14} /></Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No certificates yet" description="Certificates you issue from the Clinical Workspace will appear here." />
          )}
        </Card>
        <Card title="Generated Prescriptions">
          {prescriptions.length ? (
            <div className="space-y-2">
              {prescriptions.map((rx) => (
                <div key={rx._id} className="flex items-center justify-between rounded-xl bg-white/60 p-3 text-sm shadow">
                  <div className="flex items-center gap-2">
                    <Pill size={15} className="text-blue-600" />
                    <div>
                      <p className="font-bold text-slate-900">{rx.patientId?.name}</p>
                      <p className="text-xs text-slate-500">{rx.diagnosis} · {new Date(rx.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => downloadPrescription(rx._id)}><Download size={14} /></Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No prescriptions yet" description="Prescriptions you write appear here too, for a single downloads hub." />
          )}
        </Card>
      </div>

      <Card className="border border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <FileText size={16} /> Document version history isn't tracked yet — uploading a new file replaces the record rather than keeping prior versions. Reported here rather than shown as a feature.
        </div>
      </Card>

      <AIDraftPanel
        title="AI: Document Center Suggestions"
        actionLabel="Get Suggestions"
        onGenerate={() => aiAssistApi.getDocumentCenterSuggestions()}
        compact
      />
    </div>
  );
}

export default DoctorDocuments;
