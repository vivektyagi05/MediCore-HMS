import { AlertTriangle, Plus, Star, Trash2 } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";

const emptyMedicine = () => ({ name: "", dosage: "", frequency: "", duration: "", instructions: "" });

// `medicineTemplates` / `favouriteMedicines` / `safetyWarnings` are optional —
// omitting them keeps this component working exactly as before for any other
// caller. Nothing here fabricates a warning: warnings only ever come from
// the parent's real backend safety-check response.
function PrescriptionEditor({
  form,
  setForm,
  appointments,
  onSubmit,
  isSaving,
  medicineTemplates = [],
  favouriteMedicines = [],
  safetyWarnings = [],
  onAddFavourite,
}) {
  const updateMedicine = (index, key, value) => {
    setForm((current) => ({
      ...current,
      medicines: current.medicines.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  };

  const applyTemplate = (templateId) => {
    const template = medicineTemplates.find((item) => item._id === templateId);
    if (!template) return;
    setForm((current) => ({ ...current, medicines: template.medicines.map((m) => ({ ...m })) }));
  };

  const applyFavourite = (favouriteId) => {
    const favourite = favouriteMedicines.find((item) => item._id === favouriteId);
    if (!favourite) return;
    setForm((current) => ({
      ...current,
      medicines: [
        ...current.medicines.filter((m) => m.name.trim()),
        { name: favourite.name, dosage: favourite.dosage, frequency: favourite.frequency, duration: favourite.duration, instructions: favourite.instructions },
      ],
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

      {(medicineTemplates.length > 0 || favouriteMedicines.length > 0) && (
        <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-2">
          {medicineTemplates.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Apply Medicine Template</span>
              <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Choose a template…</option>
                {medicineTemplates.map((template) => (
                  <option key={template._id} value={template._id}>{template.name} ({template.medicines.length} medicines)</option>
                ))}
              </select>
            </label>
          )}
          {favouriteMedicines.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Add Favourite Medicine</span>
              <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value="" onChange={(e) => applyFavourite(e.target.value)}>
                <option value="">Choose a favourite…</option>
                {favouriteMedicines.map((favourite) => (
                  <option key={favourite._id} value={favourite._id}>★ {favourite.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-slate-700">Medicines</p>
          <Button type="button" variant="secondary" onClick={() => setForm({ ...form, medicines: [...form.medicines, emptyMedicine()] })}>
            <Plus size={16} /> Add
          </Button>
        </div>
        {form.medicines.map((medicine, index) => (
          <div key={index} className="grid gap-3 rounded-2xl bg-white/60 p-4 shadow-lg md:grid-cols-6">
            <Input placeholder="Medicine" value={medicine.name} onChange={(e) => updateMedicine(index, "name", e.target.value)} />
            <Input placeholder="Dosage (e.g. 500mg)" value={medicine.dosage} onChange={(e) => updateMedicine(index, "dosage", e.target.value)} />
            <Input placeholder="Frequency" value={medicine.frequency} onChange={(e) => updateMedicine(index, "frequency", e.target.value)} />
            <Input placeholder="Duration (e.g. 5 days)" value={medicine.duration} onChange={(e) => updateMedicine(index, "duration", e.target.value)} />
            <div className="flex gap-2">
              {onAddFavourite && (
                <Button type="button" variant="secondary" title="Save as favourite" onClick={() => medicine.name.trim() && onAddFavourite(medicine)}>
                  <Star size={16} />
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => setForm({ ...form, medicines: form.medicines.filter((_, i) => i !== index) })}><Trash2 size={16} /></Button>
            </div>
          </div>
        ))}
      </div>

      {safetyWarnings.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-black text-amber-800"><AlertTriangle size={16} /> Clinical safety warnings — review before saving</p>
          <ul className="space-y-1 text-sm text-amber-800">
            {safetyWarnings.map((warning, index) => (
              <li key={index}>• {warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      <Input label="Follow-up date" type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
      <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-700">Notes</span><textarea className="min-h-24 w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <Button type="submit" isLoading={isSaving}>Save Prescription</Button>
    </form>
  );
}

export default PrescriptionEditor;
