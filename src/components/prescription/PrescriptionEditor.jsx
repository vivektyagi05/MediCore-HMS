import { Plus, Trash2 } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";

function PrescriptionEditor({ form, setForm, appointments, onSubmit, isSaving }) {
  const updateMedicine = (index, key, value) => {
    setForm((current) => ({
      ...current,
      medicines: current.medicines.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  };

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">Appointment</span>
        <select className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.appointmentId} onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}>
          <option value="">Select appointment</option>
          {appointments.map((appointment) => (
            <option key={appointment._id} value={appointment._id}>{appointment.patientId?.name} - {new Date(appointment.date).toLocaleDateString()} {appointment.timeSlot}</option>
          ))}
        </select>
      </label>
      <Input label="Diagnosis" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-slate-700">Medicines</p>
          <Button type="button" variant="secondary" onClick={() => setForm({ ...form, medicines: [...form.medicines, { name: "", dosage: "", frequency: "", duration: "", instructions: "" }] })}>
            <Plus size={16} /> Add
          </Button>
        </div>
        {form.medicines.map((medicine, index) => (
          <div key={index} className="grid gap-3 rounded-2xl bg-white/60 p-4 shadow-lg md:grid-cols-5">
            <Input placeholder="Medicine" value={medicine.name} onChange={(e) => updateMedicine(index, "name", e.target.value)} />
            <Input placeholder="Dosage" value={medicine.dosage} onChange={(e) => updateMedicine(index, "dosage", e.target.value)} />
            <Input placeholder="Frequency" value={medicine.frequency} onChange={(e) => updateMedicine(index, "frequency", e.target.value)} />
            <Input placeholder="Duration" value={medicine.duration} onChange={(e) => updateMedicine(index, "duration", e.target.value)} />
            <Button type="button" variant="secondary" onClick={() => setForm({ ...form, medicines: form.medicines.filter((_, i) => i !== index) })}><Trash2 size={16} /></Button>
          </div>
        ))}
      </div>
      <Input label="Follow-up date" type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
      <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-700">Notes</span><textarea className="min-h-24 w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <Button type="submit" isLoading={isSaving}>Save Prescription</Button>
    </form>
  );
}

export default PrescriptionEditor;
