import { Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { realtimeApi } from "../../api/realtimeApi";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Loader from "../ui/Loader";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { SOCKET_EVENTS } from "../../socket/socketEvents";
import TypingIndicator from "./TypingIndicator";

// ─────────────────────────────────────────────────────────────────────────
// PHASE DOC-03B — single source of truth for the chat UI. Previously the
// only place a doctor/patient could actually converse was the standalone
// /chat/:userId page (ChatWorkspace.jsx). Per the brief's rule #17 ("never
// create a second chat engine"), this is that exact same logic (same REST
// call, same socket events, same room join/leave, same read-receipt
// wiring) lifted into a reusable component — not a rebuild — so the
// Patient Relationship Center's Communication tab can embed a genuinely
// live conversation without navigating away and without a duplicate
// implementation. ChatWorkspace now renders this component too.
// ─────────────────────────────────────────────────────────────────────────
function ConversationPanel({ userId, height = "60vh", typingLabel = "Typing" }) {
  const { user } = useAuth();
  const { socket, connectionStatus } = useRealtime();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = useRef(null);
  const scrollRef = useRef(null);

  const conversationKey = useMemo(
    () => [user?._id, userId].filter(Boolean).sort().join(":"),
    [user?._id, userId],
  );

  useEffect(() => {
    let cancelled = false;
    const loadConversation = async () => {
      setIsLoading(true);
      try {
        const response = await realtimeApi.getConversation(userId, { limit: 50 });
        if (!cancelled) setMessages(response.data.messages || []);
      } catch (error) {
        if (!cancelled) toast.error(getApiErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    if (userId) loadConversation();
    return () => {
      cancelled = true;
    };
  }, [toast, userId]);

  useEffect(() => {
    if (!socket || !conversationKey) return undefined;

    socket.emit("room:join", { room: `chat:${conversationKey}` });

    const onMessage = (message) => {
      if (message.conversationKey === conversationKey) {
        setMessages((current) => [...current.filter((item) => item._id !== message._id), message]);
      }
    };
    const onTypingStart = (payload) => {
      if (payload.senderId === userId) setIsTyping(true);
    };
    const onTypingStop = (payload) => {
      if (payload.senderId === userId) setIsTyping(false);
    };
    const onRead = (payload) => {
      if (payload.conversationKey !== conversationKey) return;
      const readIds = new Set((payload.messageIds || []).map(String));
      setMessages((current) =>
        current.map((message) => (readIds.has(String(message._id)) ? { ...message, readAt: payload.readAt } : message)),
      );
    };

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
    socket.on(SOCKET_EVENTS.TYPING_START, onTypingStart);
    socket.on(SOCKET_EVENTS.TYPING_STOP, onTypingStop);
    socket.on(SOCKET_EVENTS.CHAT_READ, onRead);

    return () => {
      socket.emit("room:leave", { room: `chat:${conversationKey}` });
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
      socket.off(SOCKET_EVENTS.TYPING_START, onTypingStart);
      socket.off(SOCKET_EVENTS.TYPING_STOP, onTypingStop);
      socket.off(SOCKET_EVENTS.CHAT_READ, onRead);
    };
  }, [conversationKey, socket, userId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const notifyTyping = () => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.TYPING_START, { recipientId: userId });
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      socket.emit(SOCKET_EVENTS.TYPING_STOP, { recipientId: userId });
    }, 900);
  };

  const sendMessage = () => {
    if (!body.trim() || !socket) return;
    socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, { recipientId: userId, body }, (ack) => {
      if (!ack?.success) {
        toast.error(ack?.message || "Message failed to send");
        return;
      }
      setBody("");
      socket.emit(SOCKET_EVENTS.TYPING_STOP, { recipientId: userId });
    });
  };

  if (isLoading) return <Loader label="Loading conversation..." />;

  return (
    <div className="flex flex-col rounded-2xl bg-white/50 shadow-inner" style={{ height }}>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No messages yet. Start the conversation below.</p>
        )}
        {messages.map((message) => {
          const mine = (message.senderId?._id || message.senderId) === user?._id;
          return (
            <div key={message._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-lg ${mine ? "bg-blue-600 text-white" : "bg-white text-slate-950"}`}>
                <p className="text-sm font-semibold leading-6">{message.body}</p>
                <p className={`mt-2 text-[11px] font-bold ${mine ? "text-blue-100" : "text-slate-400"}`}>
                  {new Date(message.createdAt).toLocaleTimeString()}
                  {mine && (message.readAt ? " · Read" : " · Sent")}
                </p>
              </div>
            </div>
          );
        })}
        <TypingIndicator isTyping={isTyping} label={typingLabel} />
      </div>
      <div className="border-t border-slate-200 p-4">
        <div className="flex gap-3">
          <Input
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              notifyTyping();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") sendMessage();
            }}
            placeholder="Write a secure message..."
          />
          <Button className="h-12 w-12 px-0" onClick={sendMessage} disabled={!body.trim() || connectionStatus !== "online"}>
            <Send size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConversationPanel;
