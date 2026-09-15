import { AlertTriangle, Sparkles } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";

const symptomChips = ["fever", "cough", "headache", "chest pain", "skin rash", "joint pain"];

function SymptomChecker({ onAnalyze, isLoading }) {
  const [form, setForm] = useState({
    symptoms: "",
    duration: "",
    severity: "mild",
    disclaimerAccepted: false,
  });

  const addChip = (chip) => {
    setForm((current) => ({
      ...current,
      symptoms: current.symptoms ? `${current.symptoms}, ${chip}` : chip,
    }));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800">
        <AlertTriangle className="mb-2" size={20} />
        HMS AI does not diagnose medical conditions. It only suggests departments and urgency bands.
      </div>

      <div className="flex flex-wrap gap-2">
        {symptomChips.map((chip) => (
          <button
            key={chip}
            className="rounded-xl bg-blue-600/10 px-3 py-2 text-xs font-black text-blue-600 transition hover:bg-blue-600 hover:text-white"
            onClick={() => addChip(chip)}
            type="button"
          >
            {chip}
          </button>
        ))}
      </div>

      <Input
        label="Symptoms"
        placeholder="fever, cough, headache"
        value={form.symptoms}
        onChange={(event) => setForm({ ...form, symptoms: event.target.value })}
      />
      <Input
        label="Duration"
        placeholder="2 days, 1 week..."
        value={form.duration}
        onChange={(event) => setForm({ ...form, duration: event.target.value })}
      />
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">Severity</span>
        <select
          className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm outline-none"
          value={form.severity}
          onChange={(event) => setForm({ ...form, severity: event.target.value })}
        >
          <option value="mild">Mild</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
        </select>
      </label>
      <label className="flex items-start gap-3 rounded-2xl bg-white/60 p-4 text-sm font-bold text-slate-600 shadow-lg">
        <input
          className="mt-1"
          type="checkbox"
          checked={form.disclaimerAccepted}
          onChange={(event) => setForm({ ...form, disclaimerAccepted: event.target.checked })}
        />
        I understand this is suggestion-only and not a diagnosis.
      </label>
      <Button
        className="w-full"
        onClick={() => onAnalyze({ ...form, symptoms: form.symptoms.split(",").map((item) => item.trim()).filter(Boolean) })}
        isLoading={isLoading}
        disabled={!form.symptoms || !form.disclaimerAccepted}
      >
        <Sparkles size={17} /> Analyze Safely
      </Button>
    </div>
  );
}

export default SymptomChecker;
