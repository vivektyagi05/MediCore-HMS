import { Sparkles, RefreshCw, Check, ShieldAlert } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";

// Renders whatever shape the AI draft content is: a string, a { bullets },
// checklist-style object, or plain key/value object. Falls back to JSON so
// nothing is ever silently dropped.
function DraftContent({ content }) {
  if (typeof content === "string") {
    return <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{content}</p>;
  }
  if (Array.isArray(content)) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {content.map((item, i) => (
          <li key={i}>{typeof item === "string" ? item : item.label || JSON.stringify(item)}</li>
        ))}
      </ul>
    );
  }
  if (content && typeof content === "object") {
    return (
      <div className="space-y-3 text-sm text-slate-700">
        {Object.entries(content).map(([key, value]) => (
          <div key={key}>
            <p className="text-xs font-black uppercase tracking-wide text-blue-600">{key.replace(/([A-Z])/g, " $1")}</p>
            {Array.isArray(value) ? (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {value.map((item, i) => (
                  <li key={i}>{typeof item === "string" ? item : JSON.stringify(item)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 leading-6">{String(value)}</p>
            )}
          </div>
        ))}
      </div>
    );
  }
  return null;
}

/**
 * Contextual "AI Assist" panel. `onGenerate` must return the aiAssistApi
 * response shape: { content, disclaimer, draftId, generatedBy }.
 * Pass `onApprove` to show an Approve button that persists the draft as
 * reviewed (used for doctor-facing content that may become part of a record).
 */
function AIDraftPanel({ title = "AI Assist", actionLabel = "Generate", onGenerate, onApprove, onInsert, insertLabel = "Insert into form", compact = false }) {
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const toast = useToast();

  const generate = async () => {
    setIsLoading(true);
    try {
      const response = await onGenerate();
      setResult(response.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const approve = async () => {
    if (!onApprove || !result?.draftId) return;
    setIsApproving(true);
    try {
      await onApprove(result.draftId);
      toast.success("AI draft approved");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <div className={`rounded-2xl border border-blue-200 bg-blue-50/50 p-4 ${compact ? "" : "shadow-lg"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-black text-blue-700">
          <Sparkles size={16} /> {title}
        </div>
        <Button variant="secondary" isLoading={isLoading} onClick={generate}>
          <RefreshCw size={14} /> {result ? "Regenerate" : actionLabel}
        </Button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl bg-white/70 p-3">
            <DraftContent content={result.content} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1 text-xs font-semibold text-slate-500">
              <ShieldAlert size={13} /> {result.disclaimer}
            </p>
            <div className="flex gap-2">
              {onInsert && (
                <Button variant="secondary" onClick={() => onInsert(result.content)}>
                  {insertLabel}
                </Button>
              )}
              {onApprove && result.draftId && (
                <Button isLoading={isApproving} onClick={approve}>
                  <Check size={14} /> Approve
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AIDraftPanel;
