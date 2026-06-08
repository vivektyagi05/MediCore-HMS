import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import AdminTable from "../../components/admin/AdminTable";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function DoctorDocuments() {
  const [documents, setDocuments] = useState([]);
  const [form, setForm] = useState({ title: "", type: "certification", file: null });
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const toast = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      const response = await doctorWorkflowApi.getDocuments();
      setDocuments(response.data.documents || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const upload = async (event) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append("title", form.title);
    formData.append("type", form.type);
    formData.append("document", form.file);
    setIsUploading(true);
    try {
      await doctorWorkflowApi.uploadDocument(formData);
      toast.success("Document uploaded for verification");
      setForm({ title: "", type: "certification", file: null });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) return <Loader label="Loading documents" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Documents</p><h1 className="mt-2 text-3xl font-black text-slate-950">Certificates and identity proofs</h1></div>
      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <Card title="Secure Upload">
          <form className="grid gap-4" onSubmit={upload}>
            <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="certification">Certification</option><option value="identity">Identity</option><option value="profile">Profile</option><option value="other">Other</option></select>
            <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} className="rounded-xl bg-white/70 p-3 text-sm" />
            <Button type="submit" isLoading={isUploading} disabled={!form.file}><Upload size={17} /> Upload</Button>
          </form>
        </Card>
        <Card title="Document Status">
          <AdminTable columns={[{ key: "title", header: "Title" }, { key: "type", header: "Type" }, { key: "status", header: "Status" }, { key: "uploadedAt", header: "Uploaded", render: (r) => new Date(r.uploadedAt).toLocaleDateString() }]} data={documents} />
        </Card>
      </div>
    </div>
  );
}

export default DoctorDocuments;
