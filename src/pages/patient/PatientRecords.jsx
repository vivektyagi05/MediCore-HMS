import { Download, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import AdminModal from "../../components/admin/AdminModal";
import ReportCard from "../../components/reports/ReportCard";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

const reportFormInitial = { title: "", category: "", reportDate: "", notes: "", tags: "", file: null };

function PatientRecords() {
  const [params, setParams] = useSearchParams();
  const [reports, setReports] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [form, setForm] = useState(reportFormInitial);
  const [preview, setPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const toast = useToast();
  const queryString = params.toString();

  const load = async () => {
    setIsLoading(true);
    try {
      const search = params.get("search") || undefined;
      const [reportRes, rxRes, timelineRes] = await Promise.all([
        patientWorkflowApi.getReports({ search, category: params.get("category") || undefined }),
        patientWorkflowApi.getPrescriptions({ search }),
        patientWorkflowApi.getTimeline({ search }),
      ]);
      setReports(reportRes.data.reports || []);
      setPrescriptions(rxRes.data.prescriptions || []);
      setTimeline(timelineRes.data.timeline || []);
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
      else formData.append(key, value);
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

  const exportData = async (resource, format) => {
    await downloadBlob(() => patientWorkflowApi.exportData({ resource, format }), `${resource}.${format}`);
  };

  if (isLoading) return <Loader label="Loading digital health records" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Digital Records</p><h1 className="mt-2 text-3xl font-black text-slate-950">Reports, prescriptions, and health timeline</h1></div>
      <div className="grid gap-3 rounded-2xl bg-white/50 p-4 shadow-lg md:grid-cols-3">
        <Input placeholder="Search records..." value={params.get("search") || ""} onChange={(e) => setParams({ ...Object.fromEntries(params), search: e.target.value })} />
        <Input placeholder="Report category" value={params.get("category") || ""} onChange={(e) => setParams({ ...Object.fromEntries(params), category: e.target.value })} />
        <div className="flex gap-2"><Button onClick={() => exportData("reports", "csv")}><Download size={16} /> Reports</Button><Button variant="secondary" onClick={() => exportData("prescriptions", "pdf")}>RX PDF</Button></div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card title="Upload Medical Report">
          <form className="grid gap-4" onSubmit={uploadReport}>
            <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <Input label="Report date" type="date" value={form.reportDate} onChange={(e) => setForm({ ...form, reportDate: e.target.value })} />
            <Input label="Tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} className="rounded-xl bg-white/70 p-3 text-sm" />
            <textarea className="min-h-24 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <Button type="submit" isLoading={isUploading} disabled={!form.file}>Upload Report</Button>
          </form>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map((report) => <ReportCard key={report._id} report={report} onPreview={() => setPreview(report)} onDownload={() => downloadBlob(() => patientWorkflowApi.downloadReport(report._id), report.fileName)} />)}
        </div>
      </div>
      <Card title="Prescription Timeline">
        <div className="space-y-3">
          {prescriptions.map((rx) => (
            <div key={rx._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div><p className="font-black text-slate-950">{rx.diagnosis}</p><p className="mt-1 text-sm text-slate-500">{rx.medicines.length} medicines • Follow-up {rx.followUpDate ? new Date(rx.followUpDate).toLocaleDateString() : "not set"}</p></div>
                <div className="flex gap-2"><Button variant="secondary" onClick={() => window.print()}><Printer size={16} /></Button><Button onClick={() => downloadBlob(() => patientWorkflowApi.downloadPrescription(rx._id), `prescription-${rx._id}.pdf`)}>Download</Button></div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">{rx.medicines.map((med) => <div key={med._id} className="rounded-xl bg-white/70 p-3"><p className="font-black">{med.name}</p><p className="text-sm text-slate-500">{med.dosage} • {med.frequency}</p></div>)}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Health Timeline">
        <div className="space-y-4">{timeline.map((item, index) => <div key={`${item.type}-${index}`} className="rounded-2xl bg-white/60 p-4 shadow-lg"><p className="font-black capitalize text-blue-600">{item.type}</p><p className="mt-1 font-black text-slate-950">{item.title}</p><p className="text-sm text-slate-500">{new Date(item.date).toLocaleDateString()}</p></div>)}</div>
      </Card>
      <AdminModal isOpen={Boolean(preview)} title={preview?.title || "Report preview"} onClose={() => setPreview(null)}>
        <p className="text-sm leading-6 text-slate-600">{preview?.notes || "No notes added."}</p>
        <Button className="mt-4" onClick={() => downloadBlob(() => patientWorkflowApi.downloadReport(preview._id), preview.fileName)}>Download secure file</Button>
      </AdminModal>
    </div>
  );
}

export default PatientRecords;
