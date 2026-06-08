import { BrainCircuit } from "lucide-react";

const severityClass = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};

function AIInsightCard({ insight }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-xl backdrop-blur-lg">
      <div className="flex items-start justify-between gap-4">
        <BrainCircuit className="text-blue-600" size={24} />
        <span className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${severityClass[insight.severity] || severityClass.low}`}>
          {insight.severity}
        </span>
      </div>
      <p className="mt-4 text-lg font-black text-slate-950">{insight.title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{insight.summary}</p>
      {insight.recommendation && (
        <p className="mt-4 rounded-xl bg-blue-600/10 p-3 text-sm font-bold leading-6 text-blue-700">{insight.recommendation}</p>
      )}
      <p className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
        Confidence {Math.round((insight.confidence || 0) * 100)}%
      </p>
    </div>
  );
}

export default AIInsightCard;
