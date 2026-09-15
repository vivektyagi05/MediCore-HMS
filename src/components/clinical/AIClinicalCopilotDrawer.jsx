import { useState } from "react";
import { Sparkles, X, Send, ShieldAlert, FileText, RefreshCw, ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";

const QUICK_QUESTIONS = [
  { key: "what_changed", label: "What changed?" },
  { key: "summary", label: "Summarize history" },
  { key: "medications", label: "Medication changes?" },
  { key: "current_medicines", label: "Current medicines?" },
  { key: "pending_actions", label: "Pending actions?" },
  { key: "reports", label: "Recent reports?" },
  { key: "follow_up", label: "Follow-up status?" },
  { key: "previous_visit", label: "Previous visit?" },
];

// PHASE P6 — AI Clinical Copilot. A side sheet, not a dominant panel (§15
// of the brief): appears only when opened, never replaces the consultation
// workspace. AI is optional intelligence here — a failed request shows a
// retry, never blocks anything else in the workspace (§16/§35).
function AIClinicalCopilotDrawer({ isOpen, onClose, patientId, patientName }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const navigate = useNavigate();

  if (!isOpen) return null;

  const ask = async (text) => {
    const q = (text ?? question).trim();
    if (!q || !patientId) return;
    setMessages((prev) => [...prev, { role: "question", text: q }]);
    setQuestion("");
    setLastQuestion(q);
    setIsLoading(true);
    setError("");
    try {
      const res = await aiAssistApi.getClinicalCopilotAnswer(patientId, q);
      setMessages((prev) => [...prev, { role: "answer", text: res.data.answer, evidence: res.data.evidence || [] }]);
    } catch (err) {
      // §16 — AI failure never blocks the workspace; the drawer just shows
      // a retry and the rest of the Clinical Workspace keeps working.
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-navy-950/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-2 text-sm font-black text-blue-700">
            <Sparkles size={16} /> AI Clinical Copilot
          </div>
          <Button variant="tertiary" size="icon" onClick={onClose} aria-label="Close AI Copilot">
            <X size={18} />
          </Button>
        </div>

        <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500">
          Patient: {patientName || "\u2014"} &middot; Context Loaded &check;
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => ask(q.label)}
              disabled={isLoading}
              className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && !isLoading && (
            <p className="text-sm text-slate-400">Ask a quick question above, or type your own below.</p>
          )}
          {messages.map((m, i) =>
            m.role === "question" ? (
              <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-slate-950 px-4 py-2 text-sm text-white">
                {m.text}
              </div>
            ) : (
              <div key={i} className="max-w-[90%] space-y-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-slate-800">
                <p className="leading-6">{m.text}</p>
                {/* Evidence is actionable (§14): type + date + description,
                    plus an Open action when a real route exists — never
                    just a bare "Prescription" tag. */}
                {m.evidence?.length > 0 && (
                  <div className="space-y-1.5 border-t border-blue-100 pt-2">
                    {m.evidence.map((e, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-blue-800">
                        <span className="flex items-center gap-1.5 font-semibold">
                          <FileText size={11} className="shrink-0" />
                          {e.description || e.type}
                          {e.date && <span className="text-blue-400">· {new Date(e.date).toLocaleDateString()}</span>}
                        </span>
                        {e.route && (
                          <button type="button" onClick={() => navigate(e.route)} className="flex shrink-0 items-center gap-0.5 font-bold text-blue-600 hover:text-blue-800">
                            Open <ArrowUpRight size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {error && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-600">
              <span className="flex items-center gap-1"><ShieldAlert size={13} /> {error}</span>
              <button type="button" onClick={() => ask(lastQuestion)} className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-rose-700 hover:bg-rose-100">
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-2 border-t border-slate-200 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <Input placeholder="Ask about this patient..." value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Button type="submit" isLoading={isLoading} disabled={!question.trim()}>
            <Send size={14} />
          </Button>
        </form>
      </div>
    </div>
  );
}

export default AIClinicalCopilotDrawer;
