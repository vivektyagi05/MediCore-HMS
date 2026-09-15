import { CheckCircle2, Circle, Loader2, AlertTriangle } from "lucide-react";

const STATUS_CONFIG = {
  done: CheckCircle2,
  current: Loader2,
  pending: Circle,
  error: AlertTriangle,
};

export default function FinancialWorkflow({ steps = [], current, status = "processing" }) {
  return (
    <ol aria-label="Financial workflow" className="space-y-3">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? (status === "error" ? "error" : "current") : "pending";
        const Icon = STATUS_CONFIG[state];
        return (
          <li key={step.key || step.label} className="flex items-center gap-3">
            <Icon size={18} className={state === "current" ? "animate-spin" : ""} aria-hidden="true" />
            <span className={state === "done" ? "font-bold" : "font-semibold"}>{step.label}</span>
            <span className="sr-only">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}
