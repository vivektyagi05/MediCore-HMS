import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { practiceApi } from "../../api/practiceApi";
import Button from "../../components/ui/Button";
import PracticeManagementNav from "../../components/practice/PracticeManagementNav";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import {
  DOCTOR_CONSULTATION_MODES as CONSULTATION_MODES,
  DOCTOR_CONSULTATION_MODE_LABELS as CONSULTATION_MODE_LABELS,
  normalizeDoctorConsultationModes,
} from "../../utils/consultationMode.js";

// Consultation Mode Contract (Appointment Regression Repair): these are the
// exact Doctor-producer values BookAppointment.jsx reads and every other
// consumer (public discovery, DoctorProfile, admin views) already expects
// on Doctor.consultationMode. This page previously offered a single-select
// of "in_person" | "online" | "both" — none of which match Doctor.
// consultationMode's real array-of-these-three-values shape, so a saved
// choice here could never correctly render as selected on reload, and
// saving could write a value ("both", "in_person") no other part of the
// app recognizes as a real mode. See backend/constants/consultationMode.js
// and src/utils/consultationMode.js for the shared frontend contract.

// Practice Settings (Phase D4, Step 5) -- telemedicine (consultation mode),
// emergency availability, and clinic locations, all reading/writing the
// same Doctor fields used by the Professional Identity Center and
// Professional Profile pages.
export default function DoctorPracticeSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [consultationMode, setConsultationMode] = useState([]);
  const [emergencyAvailability, setEmergencyAvailability] = useState(false);
  const [clinics, setClinics] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await practiceApi.getProfessionalProfile();
      // Defensive against legacy data: a doctor stored before this
      // contract existed (or before the normalization migration ran) may
      // still have a value like "both" or "in_person" in this array. Never
      // let an unrecognized value enter editable state -- it isn't
      // selectable/deselectable via the buttons below, so it would
      // otherwise silently survive every future save and keep tripping
      // the backend's validation on this exact field.
      setConsultationMode(normalizeDoctorConsultationModes(res.data.consultationMode));
      setEmergencyAvailability(Boolean(res.data.emergencyAvailability));
      setClinics(res.data.clinics || []);
    } catch (err) {
      setError(err?.response?.data?.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const toggleMode = (mode) => {
    setConsultationMode((current) =>
      current.includes(mode) ? current.filter((m) => m !== mode) : [...current, mode],
    );
  };

  const save = async () => {
    if (consultationMode.length === 0) {
      toast.error("Select at least one consultation mode");
      return;
    }
    setSaving(true);
    try {
      await practiceApi.updatePracticeSettings({ consultationMode, emergencyAvailability, clinics });
      toast.success("Practice settings updated successfully");
    } catch (err) {
      toast.error(err?.response?.data?.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="glass-card h-64 animate-pulse rounded-2xl bg-slate-100" />;
  }

  if (error) {
    return (
      <div className="glass-card flex flex-col items-center justify-center gap-3 rounded-2xl py-16 text-center">
        <p className="text-sm font-semibold text-slate-500">{error}</p>
        <button onClick={load} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-950">Practice Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Telemedicine, emergency availability, and clinic locations</p>
        </div>
        <Button onClick={save} isLoading={saving}><Save size={15} /> Save Changes</Button>
      </div>

      <PracticeManagementNav active="settings" />

      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="font-black text-slate-950">Consultation Mode</h3>
        <div className="flex flex-wrap gap-2">
          {CONSULTATION_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => toggleMode(mode)}
              aria-pressed={consultationMode.includes(mode)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                consultationMode.includes(mode) ? "bg-blue-600 text-white shadow-lg" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {CONSULTATION_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">Select every mode you actually offer — patients can only book a mode selected here.</p>
      </div>

      <div className="glass-card rounded-2xl p-6">
        <label className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-black text-slate-950">Emergency Availability</h3>
            <p className="mt-1 text-sm text-slate-500">Show patients that you accept emergency appointments</p>
          </div>
          <input
            type="checkbox"
            checked={emergencyAvailability}
            onChange={(e) => setEmergencyAvailability(e.target.checked)}
            className="h-6 w-6 accent-blue-600"
          />
        </label>
      </div>

      <div className="glass-card rounded-2xl p-6">
        <h3 className="font-black text-slate-950">Clinic Locations</h3>
        <p className="mt-1 text-sm text-slate-500">
          {clinics.length} clinic location(s) configured. Manage details on the{" "}
          <a href="/doctor/profile/edit" className="font-semibold text-blue-600 hover:text-blue-700">Professional Profile</a> page.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}><Save size={15} /> Save Changes</Button>
      </div>
    </div>
  );
}
