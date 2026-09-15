import { AlertTriangle, HeartPulse, Pill, ShieldCheck, Users, CalendarClock, FileText } from "lucide-react";

// Sticky patient-context header for the Clinical Workspace. Everything here
// comes straight from getPatientClinicalProfile — no field is computed or
// guessed here; an empty array/null just renders as "None on file".
//
// PHASE P6 (gap-closure §4): identity/allergy/vitals/medicines/reports/last
// visit are the CRITICAL clinical row and stay visually dominant (white
// text, full opacity, allergy gets its own alert banner when present).
// Insurance/family/billing are administrative — demoted to a smaller,
// muted footer row so they never compete for attention with clinical
// facts, per the brief's explicit requirement.
function PatientSnapshot({ profile }) {
  if (!profile) return null;
  const { patient, allergies, chronicConditions, currentMedications, vitals, insurance, outstandingBills, family, reports, lastVisit } = profile;

  const age = patient?.dateOfBirth ? new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear() : null;
  const outstandingTotal = (outstandingBills || []).reduce((sum, bill) => sum + (bill.amount || 0), 0);
  const recentReportsCount = (reports || []).length;

  return (
    <div className="sticky top-2 z-10 rounded-2xl bg-slate-950 p-5 text-white shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-300">Patient Context</p>
          <h2 className="mt-1 text-xl font-black">{patient?.name}</h2>
          <p className="text-sm text-slate-300">
            {patient?.gender || "Gender N/A"}{age ? ` · ${age} yrs` : ""}{patient?.bloodGroup ? ` · ${patient.bloodGroup}` : ""}
          </p>
        </div>
      </div>

      {/* Critical allergy alert — never buried in a generic pill (§ Patient
          Context of the brief: "must not be buried"). Non-color severity:
          the AlertTriangle icon + explicit "ALERT" text carry the meaning,
          not just the amber background. */}
      {allergies?.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-500/15 p-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-amber-200">Allergy Alert</p>
            <p className="text-sm font-bold text-amber-100">{allergies.join(", ")}</p>
          </div>
        </div>
      )}

      {/* CRITICAL clinical row — full-opacity white text, always first. */}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
          <Pill size={16} className="text-slate-200" />
          <span>{currentMedications?.length ? `${currentMedications.length} current medication(s)` : "No current medications on file"}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
          <HeartPulse size={16} className="text-slate-200" />
          <span>{chronicConditions?.length ? chronicConditions.join(", ") : "No chronic conditions on file"}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
          <FileText size={16} className="text-slate-200" />
          <span>{recentReportsCount ? `${recentReportsCount} report(s) on file` : "No reports on file"}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
          <CalendarClock size={16} className="text-slate-200" />
          <span>{lastVisit ? `Last visit ${new Date(lastVisit).toLocaleDateString()}` : "No prior visit on file"}</span>
        </div>
      </div>

      {vitals && (Object.values(vitals).some(Boolean)) && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
          {vitals.heightCm && <span>Height: {vitals.heightCm}cm</span>}
          {vitals.weightKg && <span>Weight: {vitals.weightKg}kg</span>}
          {(vitals.bloodPressureSystolic && vitals.bloodPressureDiastolic) && (
            <span>BP: {vitals.bloodPressureSystolic}/{vitals.bloodPressureDiastolic}</span>
          )}
          {vitals.restingHeartRate && <span>HR: {vitals.restingHeartRate} bpm</span>}
        </div>
      )}

      {/* Administrative — deliberately muted/smaller and visually separated
          (a top border + reduced opacity) so it never competes with the
          clinical row above. */}
      {(insurance?.length > 0 || family?.length > 0 || outstandingTotal > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3 text-xs text-slate-400">
          {insurance?.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1">
              <ShieldCheck size={12} /> {insurance.length} insurance polic{insurance.length > 1 ? "ies" : "y"}
            </span>
          )}
          {family?.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1">
              <Users size={12} /> {family.length} family member(s)
            </span>
          )}
          {outstandingTotal > 0 && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-rose-300">Outstanding: ₹{outstandingTotal}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default PatientSnapshot;
