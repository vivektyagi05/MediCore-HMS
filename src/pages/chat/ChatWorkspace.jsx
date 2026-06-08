import { ArrowLeft, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { realtimeApi } from "../../api/realtimeApi";
import TypingIndicator from "../../components/realtime/TypingIndicator";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { SOCKET_EVENTS } from "../../socket/socketEvents";

function ChatWorkspace() {
  const { userId } = useParams();
  const { user } = useAuth();
  const { socket, connectionStatus } = useRealtime();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = useRef(null);

  const conversationKey = useMemo(
    () => [user?._id, userId].filter(Boolean).sort().join(":"),
    [user?._id, userId],
  );

  useEffect(() => {
    const loadConversation = async () => {
      setIsLoading(true);
      try {
        const response = await realtimeApi.getConversation(userId, { limit: 50 });
        setMessages(response.data.messages || []);
      } catch (error) {
        toast.error(getApiErrorMessage(error));
      } finally {
        setIsLoading(false);
      }
    };

    loadConversation();
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

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
    socket.on(SOCKET_EVENTS.TYPING_START, onTypingStart);
    socket.on(SOCKET_EVENTS.TYPING_STOP, onTypingStop);

    return () => {
      socket.emit("room:leave", { room: `chat:${conversationKey}` });
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
      socket.off(SOCKET_EVENTS.TYPING_START, onTypingStart);
      socket.off(SOCKET_EVENTS.TYPING_STOP, onTypingStop);
    };
  }, [conversationKey, socket, userId]);

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
        toast.error(ack?.message || "Message could not be sent");
        return;
      }
      setBody("");
      socket.emit(SOCKET_EVENTS.TYPING_STOP, { recipientId: userId });
    });
  };

  if (isLoading) return <Loader label="Loading conversation" />;

  return (
    <div className="space-y-6">
      <Link to={user?.role === "doctor" ? "/doctor/dashboard" : "/patient/dashboard"} className="inline-flex items-center gap-2 text-sm font-black text-blue-600">
        <ArrowLeft size={17} /> Back
      </Link>

      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Realtime Chat</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Care conversation</h1>
      </div>

      <Card>
        <div className="flex h-[60vh] flex-col rounded-2xl bg-white/50 shadow-inner">
          <div className="border-b border-slate-200 p-4">
            <p className="text-sm font-black capitalize text-slate-950">Connection: {connectionStatus}</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => {
              const mine = (message.senderId?._id || message.senderId) === user?._id;
              return (
                <div key={message._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-lg ${mine ? "bg-blue-600 text-white" : "bg-white text-slate-950"}`}>
                    <p className="text-sm font-semibold leading-6">{message.body}</p>
                    <p className={`mt-2 text-[11px] font-bold ${mine ? "text-blue-100" : "text-slate-400"}`}>
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              );
            })}
            <TypingIndicator isTyping={isTyping} label="Care team typing" />
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
      </Card>
    </div>
  );
}

export default ChatWorkspace;
