import EmptyState from "../shared/EmptyState";

// PHASE P6 — Signature "Since Last Visit" feature. Pure rendering of the
// backend's real clinicalComparisonService output — if the backend says a
// comparison isn't available (fewer than 2 real visits), this shows that
// honestly instead of inventing rows.
const STATUS_STYLE = {
  NEW: "text-emerald-700",
  CHANGED: "text-amber-700",
  OVERDUE: "text-rose-700",
  UNCHANGED: "text-slate-500",
  UNAVAILABLE: "text-slate-400",
};

function SinceLastVisitPanel({ comparison }) {
  if (!comparison?.available) {
    return <EmptyState title="Comparison unavailable" description={comparison?.reason || "Not enough visit history to compute a comparison."} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-slate-500">
        {new Date(comparison.previousVisitDate).toLocaleDateString()} &rarr; {new Date(comparison.currentVisitDate).toLocaleDateString()}
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Area</th>
              <th className="px-3 py-2 text-left">Previous</th>
              <th className="px-3 py-2 text-left">Current</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {comparison.rows.map((row) => (
              <tr key={row.label}>
                <td className="px-3 py-2 font-bold text-slate-900">{row.label}</td>
                <td className="px-3 py-2 text-slate-600">{row.previous}</td>
                <td className={`px-3 py-2 font-semibold ${STATUS_STYLE[row.status] || "text-slate-700"}`}>{row.current}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Medication Reconciliation — same engine's medicationReconciliation output
// (shared with the "Medication" row above, no second diff implementation).
function MedicationReconciliation({ reconciliation }) {
  if (!reconciliation) {
    return <EmptyState title="No comparison yet" description="Medication reconciliation appears once a second prescription exists for this patient." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Medicine</th>
            <th className="px-3 py-2 text-left">Previous</th>
            <th className="px-3 py-2 text-left">Current</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {reconciliation.rows.map((row) => (
            <tr key={row.name}>
              <td className="px-3 py-2 font-bold text-slate-900">{row.name}</td>
              <td className="px-3 py-2 text-slate-500">{row.previous || "\u2014"}</td>
              <td className="px-3 py-2 text-slate-700">{row.current || "\u2014"}</td>
              <td className={`px-3 py-2 font-semibold ${STATUS_STYLE[row.status] || "text-slate-700"}`}>{row.status.replace("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { MedicationReconciliation };
export default SinceLastVisitPanel;
