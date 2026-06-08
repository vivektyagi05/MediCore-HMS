import { Download, FileText, NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import AdminTable from "../../components/admin/AdminTable";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import PrescriptionEditor from "../../components/prescription/PrescriptionEditor";
import { useToast } from "../../context/ToastContext";

const prescriptionForm = {
  appointmentId: "",
  diagnosis: "",
  medicines: [{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }],
  notes: "",
  followUpDate: "",
};

function DoctorClinicalWorkspace() {
  const [params, setParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("prescriptions");
  const [appointments, setAppointments] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState(prescriptionForm);
  const [noteForm, setNoteForm] = useState({ appointmentId: "", symptoms: "", notes: "", recommendations: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();
  const queryString = params.toString();

  const load = async () => {
    setIsLoading(true);
    try {
      const [apptRes, rxRes, noteRes, historyRes] = await Promise.all([
        appointmentApi.getAppointments({ limit: 100, status: params.get("status") || undefined }),
        doctorWorkflowApi.getPrescriptions({ search: params.get("search") || undefined }),
        doctorWorkflowApi.getNotes({ search: params.get("search") || undefined }),
        doctorWorkflowApi.getHistory({ from: params.get("from") || undefined, to: params.get("to") || undefined }),
      ]);
      const completedAppointments =
      (
        apptRes.data.appointments || []
      ).filter(
        (appointment) =>
          appointment.status ===
          "completed"
      );

      setAppointments(
        completedAppointments
      );
      setPrescriptions(rxRes.data.prescriptions || []);
      setNotes(noteRes.data.notes || []);
      setHistory(historyRes.data.history || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [queryString]);

  const savePrescription = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await doctorWorkflowApi.createPrescription(form);
      toast.success("Prescription saved");
      setForm(prescriptionForm);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
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

  if (isLoading) return <Loader label="Loading clinical workspace" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Clinical Workspace</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Prescriptions, notes, and patient history</h1>
      </div>
      <div className="grid gap-3 rounded-2xl bg-white/50 p-4 shadow-lg lg:grid-cols-[1fr_auto]">
        <Input placeholder="Search consultations..." value={params.get("search") || ""} onChange={(e) => setParams({ ...Object.fromEntries(params), search: e.target.value })} />
        <div className="flex flex-wrap gap-2">
          {["prescriptions", "notes", "history"].map((tab) => (
            <Button key={tab} variant={activeTab === tab ? "primary" : "secondary"} onClick={() => setActiveTab(tab)}>{tab}</Button>
          ))}
        </div>
      </div>
      {activeTab === "prescriptions" && (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card title="Prescription Editor"><PrescriptionEditor form={form} setForm={setForm} appointments={appointments} onSubmit={savePrescription} isSaving={isSaving} /></Card>
          <Card title="Prescription Library">
            <AdminTable
              columns={[
                { key: "patientId", header: "Patient", render: (row) => row.patientId?.name },
                { key: "diagnosis", header: "Diagnosis" },
                { key: "createdAt", header: "Date", render: (row) => new Date(row.createdAt).toLocaleDateString() },
                { key: "actions", header: "PDF", render: (row) => <Button variant="secondary" onClick={() => downloadRx(row._id)}><Download size={16} /></Button> },
              ]}
              data={prescriptions}
            />
          </Card>
        </div>
      )}
      {activeTab === "notes" && (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card title="Medical Note">
            <form className="grid gap-4" onSubmit={saveNote}>
              <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={noteForm.appointmentId} onChange={(e) => setNoteForm({ ...noteForm, appointmentId: e.target.value })}>
                <option value="">Select appointment</option>
                {appointments
                  .filter(
                    (appointment) =>
                      appointment.paymentStatus ===
                      "paid"
                  )
                  .map((appointment) => <option key={appointment._id} value={appointment._id}>{appointment.patientId?.name} - {new Date(appointment.date).toLocaleDateString()}</option>)}
              </select>
              <Input label="Symptoms" placeholder="fever, cough" value={noteForm.symptoms} onChange={(e) => setNoteForm({ ...noteForm, symptoms: e.target.value })} />
              <textarea className="min-h-28 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" placeholder="Clinical notes" value={noteForm.notes} onChange={(e) => setNoteForm({ ...noteForm, notes: e.target.value })} />
              <textarea className="min-h-20 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" placeholder="Recommendations" value={noteForm.recommendations} onChange={(e) => setNoteForm({ ...noteForm, recommendations: e.target.value })} />
              <Button type="submit" isLoading={isSaving}>Save Note</Button>
            </form>
          </Card>
          <Card title="Searchable Notes">
            <AdminTable columns={[{ key: "patientId", header: "Patient", render: (row) => row.patientId?.name }, { key: "symptoms", header: "Symptoms", render: (row) => row.symptoms.join(", ") }, { key: "notes", header: "Notes" }]} data={notes} />
          </Card>
        </div>
      )}
      {activeTab === "history" && (
        <Card title="Consultation Timeline">
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
        </Card>
      )}
      <Card title="Communication Note">
        <div className="flex gap-4 rounded-2xl bg-slate-950 p-5 text-white"><NotebookPen className="text-blue-400" /><p className="text-sm text-slate-300">Appointment issues can be recorded in medical notes today; the API is isolated so this can move to sockets later.</p></div>
      </Card>
    </div>
  );
}

export default DoctorClinicalWorkspace;
