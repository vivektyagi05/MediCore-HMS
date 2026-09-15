import { ClipboardList, ArrowRight } from "lucide-react";
import EmptyState from "../shared/EmptyState";

// PHASE P6 (gap-closure) — Open Clinical Actions. Pure rendering of the
// backend's buildOpenClinicalActions() output: a real action queue (WHAT
// the doctor must do, WHY, WHEN, and WHERE), distinct from the Attention
// panel above (which answers why something matters, not what to do about
// it). Never invents an action — if the backend didn't send one, it isn't
// shown.
const STATUS_STYLE = {
  OVERDUE: "bg-rose-100 text-rose-700",
  DUE_TODAY: "bg-amber-100 text-amber-700",
  UPCOMING: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  // PHASE P10 — a follow-up that's already booked, shown so it doesn't
  // simply vanish from this list between scheduling and completion.
  SCHEDULED: "bg-violet-100 text-violet-700",
};

function OpenClinicalActions({ actions = [], onAction }) {
  if (!actions.length) {
    return <EmptyState title="No open clinical actions" description="Nothing concrete is queued up for this patient right now." />;
  }

  return (
    <div className="space-y-3">
      {actions.map((item) => (
        <div key={item.key} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4">
          <div className="flex items-start gap-3">
            <ClipboardList size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <div>
              <p className="font-black text-slate-950">{item.what}</p>
              <p className="mt-1 text-xs text-slate-500">{item.why}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[item.status] || "bg-slate-100 text-slate-600"}`}>{item.status.replace("_", " ")}</span>
                <span className="text-[11px] font-semibold text-slate-400">{item.when}</span>
              </div>
            </div>
          </div>
          {onAction && (
            <button
              type="button"
              onClick={() => onAction(item)}
              className="flex shrink-0 items-center gap-1 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
            >
              Open <ArrowRight size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default OpenClinicalActions;
