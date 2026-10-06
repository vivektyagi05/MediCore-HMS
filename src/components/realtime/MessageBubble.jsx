import { AlertTriangle, FileText, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { realtimeApi } from "../../api/realtimeApi";
import { statusLabel } from "../../utils/chatMessageState";

const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Images are fetched through the authenticated API as a Blob and shown from an
// object URL — there is no public/permanent URL for PHI, and the storage key
// is never sent to the browser. The object URL is revoked on unmount.
function AttachmentView({ message, mine }) {
  const { attachment } = message;
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const confirmed = Boolean(message._id);

  useEffect(() => {
    if (!confirmed || attachment.kind !== "image") return undefined;
    let cancelled = false;
    let url = null;
    realtimeApi.downloadAttachment(message._id)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment.kind, confirmed, message._id]);

  const openDocument = async () => {
    setOpening(true);
    try {
      const blob = await realtimeApi.downloadAttachment(message._id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };

  if (attachment.kind === "image") {
    if (objectUrl) return <img src={objectUrl} alt={attachment.fileName} className="mb-2 max-h-64 rounded-xl object-contain" />;
    return (
      <div className={`mb-2 flex h-24 w-48 items-center justify-center rounded-xl text-xs font-bold ${mine ? "bg-blue-500/40" : "bg-slate-100"}`}>
        {failed ? "Image unavailable" : <Loader2 size={16} className="animate-spin" aria-label="Loading image" />}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={openDocument}
      disabled={!confirmed || opening}
      className={`mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold ${mine ? "bg-blue-500/40" : "bg-slate-100"}`}
    >
      <FileText size={20} />
      <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
      <span className="text-[11px] opacity-70">{failed ? "Unavailable" : formatSize(attachment.size)}</span>
    </button>
  );
}

// Message text is rendered as TEXT by React (escaped) — never as HTML.
function MessageBubble({ message, mine, onRetry, onDiscard }) {
  const failed = message.status === "failed";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-lg ${mine ? "bg-blue-600 text-white" : "bg-white text-slate-950"} ${failed ? "ring-2 ring-rose-400" : ""}`}>
        {message.attachment && <AttachmentView message={message} mine={mine} />}
        {message.body && <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-6">{message.body}</p>}
        <p className={`mt-2 flex flex-wrap items-center gap-x-2 text-[11px] font-bold ${mine ? "text-blue-100" : "text-slate-400"}`}>
          <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {mine && !failed && <span data-testid="message-status">{statusLabel(message.status)}</span>}
        </p>
        {failed && (
          <div className="mt-2 flex items-center gap-2 text-xs font-bold text-rose-100">
            <AlertTriangle size={14} />
            <span className="flex-1">{message.error?.message || "Failed to send"}</span>
            {message.error?.retryable !== false && (
              <button type="button" onClick={() => onRetry(message.clientMessageId)} className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2 py-1">
                <RotateCcw size={12} /> Retry
              </button>
            )}
            <button type="button" onClick={() => onDiscard(message.clientMessageId)} aria-label="Discard message" className="rounded-lg bg-white/20 p-1">
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
