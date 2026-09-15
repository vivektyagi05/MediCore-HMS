import { Award, Calendar, FileText, NotebookPen, Pill, Star } from "lucide-react";
import EmptyState from "../shared/EmptyState";

const ICONS = {
  appointment: Calendar,
  prescription: Pill,
  note: NotebookPen,
  report: FileText,
  certificate: Award,
  review: Star,
};

const LABELS = {
  appointment: (item) => `${item.appointmentType === "follow_up" ? "Follow-up appointment" : "Appointment"} · ${item.status?.replace(/_/g, " ")}`,
  prescription: () => "Prescription issued",
  note: () => "Clinical note added",
  report: (item) => `Report uploaded${item.category ? ` · ${item.category}` : ""}`,
  certificate: (item) => `Certificate issued${item.type ? ` · ${item.type.replace("_", " ")}` : ""}`,
  review: (item) => `Patient left a ${item.rating}-star review${item.hasReply ? " (replied)" : " (awaiting reply)"}`,
};

// Pure rendering of the already-merged, already-sorted timeline array the
// backend returns — this component never re-fetches or re-derives anything.
function ClinicalTimeline({ timeline = [] }) {
  if (!timeline.length) {
    return <EmptyState title="No timeline events yet" description="Appointments, prescriptions, notes, reports, and certificates for this patient will appear here as they happen." />;
  }

  return (
    <div className="space-y-3">
      {timeline.map((item, index) => {
        const Icon = ICONS[item.kind] || FileText;
        return (
          <div key={`${item.kind}-${item.id}-${index}`} className="flex items-start gap-4 rounded-2xl bg-white/60 p-4 shadow-lg">
            <div className="rounded-xl bg-slate-950 p-3 text-white"><Icon size={16} /></div>
            <div>
              <p className="font-black text-slate-950">{LABELS[item.kind]?.(item) || item.kind}</p>
              <p className="mt-1 text-xs text-slate-500">{item.date ? new Date(item.date).toLocaleString() : "Date not recorded"}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ClinicalTimeline;
