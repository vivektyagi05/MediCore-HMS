import { AlertTriangle, ShieldAlert, Info, Bell } from "lucide-react";
import EmptyState from "../shared/EmptyState";

// PHASE P6 — Clinical Attention. Purely a rendering layer over the
// backend's real computeDoctorPatientAttentionItems() output (already
// wired into getPatientClinicalProfile) — never invents an item and never
// re-derives severity client-side. `action` is a route hint the backend
// already resolves against real tabs; onAction just switches tabs, it
// never fabricates a destination.
const SEVERITY_STYLE = {
  critical: { icon: ShieldAlert, className: "border-rose-200 bg-rose-50 text-rose-800" },
  action_required: { icon: Bell, className: "border-rose-200 bg-rose-50 text-rose-800" },
  warning: { icon: AlertTriangle, className: "border-amber-200 bg-amber-50 text-amber-800" },
  info: { icon: Info, className: "border-slate-200 bg-slate-50 text-slate-700" },
};

function ClinicalAttentionPanel({ items = [], onAction }) {
  if (!items.length) {
    return <EmptyState title="Nothing needs attention" description="No open clinical attention items for this patient right now." />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const style = SEVERITY_STYLE[item.severity] || SEVERITY_STYLE.info;
        const Icon = style.icon;
        return (
          <div key={item.key} className={`flex items-start gap-3 rounded-2xl border p-4 ${style.className}`}>
            <Icon size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-black">{item.what}</p>
              <p className="mt-1 text-sm opacity-90">{item.why}</p>
            </div>
            {onAction && item.action && (
              <button
                type="button"
                onClick={() => onAction(item.action)}
                className="shrink-0 rounded-full bg-white/70 px-3 py-1 text-xs font-bold underline decoration-current underline-offset-2 hover:bg-white"
              >
                View
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ClinicalAttentionPanel;
