import { useState } from "react";
import { Award, Download, XCircle } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import EmptyState from "../shared/EmptyState";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";

const CERT_TYPES = [
  { value: "fitness", label: "Fitness Certificate" },
  { value: "sick_leave", label: "Sick Leave Certificate" },
  { value: "referral", label: "Referral Note" },
  { value: "other", label: "Other" },
];

const emptyForm = (patientId, appointmentId) => ({
  patientId: patientId || "",
  appointmentId: appointmentId || "",
  type: "fitness",
  title: "",
  content: { diagnosis: "", validFrom: "", validTill: "", referredTo: "", notes: "" },
});

// Certificates always require a real patientId + (when supplied) appointment
// the doctor treated — enforced server-side, this component just surfaces
// that clearly rather than letting the doctor guess why a save failed.
function CertificateGenerator({ patientId, appointmentId, certificates = [], onIssued }) {
  const [form, setForm] = useState(emptyForm(patientId, appointmentId));
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const submit = async (event) => {
    event.preventDefault();
    if (!form.patientId) {
      toast.error("Select a patient before issuing a certificate");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Certificate title is required");
      return;
    }
    setIsSaving(true);
    try {
      await doctorWorkflowApi.createCertificate(form);
      toast.success("Certificate issued");
      setForm(emptyForm(patientId, appointmentId));
      onIssued?.();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const download = async (id) => {
    const blob = await doctorWorkflowApi.downloadCertificate(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `certificate-${id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const revoke = async (id) => {
    try {
      await doctorWorkflowApi.revokeCertificate(id, { reason: "Revoked by issuing doctor" });
      toast.success("Certificate revoked");
      onIssued?.();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <form className="grid gap-4 rounded-2xl bg-white/60 p-4 shadow-lg" onSubmit={submit}>
        <p className="flex items-center gap-2 text-sm font-black text-slate-950"><Award size={16} /> Certificate Generator</p>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">Certificate Type</span>
          <select className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {CERT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <Input label="Title" placeholder="e.g. Fitness to Resume Work" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input label="Diagnosis / Reason (optional)" value={form.content.diagnosis} onChange={(e) => setForm({ ...form, content: { ...form.content, diagnosis: e.target.value } })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valid From" type="date" value={form.content.validFrom} onChange={(e) => setForm({ ...form, content: { ...form.content, validFrom: e.target.value } })} />
          <Input label="Valid Till" type="date" value={form.content.validTill} onChange={(e) => setForm({ ...form, content: { ...form.content, validTill: e.target.value } })} />
        </div>
        {form.type === "referral" && (
          <Input label="Referred To" value={form.content.referredTo} onChange={(e) => setForm({ ...form, content: { ...form.content, referredTo: e.target.value } })} />
        )}
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">Notes</span>
          <textarea className="min-h-20 w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.content.notes} onChange={(e) => setForm({ ...form, content: { ...form.content, notes: e.target.value } })} />
        </label>
        <Button type="submit" isLoading={isSaving} disabled={!form.patientId}>Issue Certificate</Button>
        {!form.patientId && <p className="text-xs text-slate-500">Open this from a patient's Clinical Workspace to issue a certificate.</p>}
      </form>

      <div>
        {certificates.length ? (
          <div className="space-y-3">
            {certificates.map((certificate) => (
              <div key={certificate._id} className="flex items-center justify-between rounded-2xl bg-white/60 p-4 shadow-lg">
                <div>
                  <p className="font-black text-slate-950">{certificate.title}</p>
                  <p className="text-xs text-slate-500">{certificate.type.replace("_", " ")} · {new Date(certificate.createdAt).toLocaleDateString()} · {certificate.status}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => download(certificate._id)}><Download size={16} /></Button>
                  {certificate.status === "issued" && (
                    <Button variant="secondary" onClick={() => revoke(certificate._id)}><XCircle size={16} /></Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No certificates issued yet" description="Certificates you issue for this patient will appear here." />
        )}
      </div>
    </div>
  );
}

export default CertificateGenerator;
