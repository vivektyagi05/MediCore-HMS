import { Lock, Paperclip, Send, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useConversation } from "../../hooks/useConversation";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";

// ─────────────────────────────────────────────────────────────────────────
// The single conversation UI shared by the Doctor Communication Hub, the
// Patient Communication Hub, the patient-profile "Communication" tab and the
// legacy /chat/:userId support route. All behaviour lives in useConversation
// (one engine); this component is presentation only.
// ─────────────────────────────────────────────────────────────────────────
const BODY_MAX = 4000;

function ConversationPanel({ userId, height = "60vh", typingLabel = "Typing" }) {
  const { user } = useAuth();
  const toast = useToast();
  const convo = useConversation(userId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);
  const fileInput = useRef(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);

  const { messages, access, loading, error, connectionStatus } = convo;
  const canSend = Boolean(access?.canSend);
  const offline = connectionStatus !== "online";

  // keep pinned to the newest message unless the user scrolled up to read history
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current && !stickToBottom.current && el.scrollHeight > prevHeight.current && convo.loadingOlder === false) {
      el.scrollTop += el.scrollHeight - prevHeight.current; // preserve position after prepending older messages
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = el.scrollHeight;
  }, [messages.length, convo.peerTyping, convo.loadingOlder]);

  const onScroll = (event) => {
    const el = event.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && convo.hasMore && !convo.loadingOlder) convo.loadOlder();
  };

  const submit = () => {
    if (!canSend || !draft.trim()) return;
    stickToBottom.current = true;
    if (convo.send(draft)) setDraft("");
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    stickToBottom.current = true;
    const problem = convo.sendAttachment(file);
    if (problem) toast.error(problem);
  };

  if (loading) return <Loader label="Loading conversation..." />;

  if (error && messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/50 p-8 text-center" style={{ height }} role="alert">
        <p className="text-sm font-bold text-slate-700">{error.message}</p>
        {error.retryable && <Button onClick={convo.reload}>Try again</Button>}
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl bg-white/50 shadow-inner" style={{ height }}>
      {convo.participant && (
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-black text-slate-950">{convo.participant.name}</p>
        </div>
      )}
      {offline && (
        <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800" role="status">
          <WifiOff size={14} /> {connectionStatus === "connecting" ? "Reconnecting…" : "You are offline."} Messages will be sent when the connection returns; unsent ones show Retry.
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
        {convo.loadingOlder && <p className="text-center text-xs font-bold text-slate-400">Loading earlier messages…</p>}
        {convo.hasMore && !convo.loadingOlder && (
          <button type="button" onClick={convo.loadOlder} className="mx-auto block text-xs font-black text-blue-600">Load earlier messages</button>
        )}
        {messages.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No messages yet.{canSend ? " Start the conversation below." : ""}</p>}
        {messages.map((message) => (
          <MessageBubble
            key={message._id || message.clientMessageId}
            message={message}
            mine={String(message.senderId) === String(user?._id)}
            onRetry={convo.retry}
            onDiscard={convo.discard}
          />
        ))}
        <TypingIndicator isTyping={convo.peerTyping} label={typingLabel} />
      </div>
      {!canSend ? (
        <div className="flex items-start gap-3 border-t border-slate-200 bg-slate-50 p-4" role="status">
          <Lock size={18} className="mt-0.5 text-slate-500" />
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-slate-700">Read-only · Communication window expired</p>
            <p className="mt-1 text-sm text-slate-600">{access?.readOnlyMessage || "You can read this conversation, but sending is no longer available."}</p>
          </div>
        </div>
      ) : (
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-end gap-2">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={onFile} data-testid="chat-file-input" />
            <Button variant="secondary" className="h-12 w-12 px-0" onClick={() => fileInput.current?.click()} aria-label="Attach an image or PDF">
              <Paperclip size={18} />
            </Button>
            <textarea
              value={draft}
              maxLength={BODY_MAX}
              rows={1}
              onChange={(event) => { setDraft(event.target.value); convo.notifyTyping(); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
              }}
              onBlur={convo.stopTyping}
              placeholder="Write a secure message…"
              aria-label="Message"
              className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-400"
            />
            <Button className="h-12 w-12 px-0" onClick={submit} disabled={!draft.trim()} aria-label="Send message">
              <Send size={18} />
            </Button>
          </div>
          <p className="mt-1 text-[11px] font-bold text-slate-400">PNG, JPEG or PDF up to 5 MB · Enter to send, Shift+Enter for a new line</p>
        </div>
      )}
    </div>
  );
}

export default ConversationPanel;
