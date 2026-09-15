import { Search, Sparkles } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { getApiErrorMessage } from "../../api/axios";
import { aiAssistApi } from "../../api/aiAssistApi";
import { useToast } from "../../context/ToastContext";

const RESULT_LABEL = {
  appointments: (row) => `${row.patientId?.name || "Patient"} — ${new Date(row.date).toLocaleDateString()} (${row.status})`,
  refunds: (row) => `${row.requestedBy?.name || "User"} — status: ${row.status}`,
  doctors: (row) => `Dr. ${row.userId?.name || "Doctor"} — rating ${row.rating || "n/a"}`,
};

// Try examples like: "my appointments this month", "patients waiting for approval",
// "refunds pending today", "doctors with the highest ratings".
function SmartSearchBar() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const toast = useToast();

  const runSearch = async (e) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setIsLoading(true);
    try {
      const res = await aiAssistApi.naturalLanguageSearch(query);
      setResult(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const labelFor = result?.resultType ? RESULT_LABEL[result.resultType] : null;

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-lg">
      <div className="flex items-center gap-2 text-sm font-black text-blue-700">
        <Sparkles size={16} /> Smart Search
      </div>
      <form onSubmit={runSearch} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder='Try "refunds pending today" or "doctors with the highest ratings"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" isLoading={isLoading}>
          <Search size={14} /> Search
        </Button>
      </form>

      {result && !result.matched && (
        <p className="mt-3 text-sm text-slate-500">
          No natural-language match — try a more specific phrase, or use the standard search/filter fields above.
        </p>
      )}

      {result?.matched && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-black uppercase tracking-wide text-blue-600">{result.label}</p>
          <ul className="space-y-1 text-sm text-slate-700">
            {result.results.slice(0, 8).map((row) => (
              <li key={row._id} className="rounded-lg bg-white/70 px-3 py-2">
                {labelFor ? labelFor(row) : JSON.stringify(row)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SmartSearchBar;
