import { ArrowLeft, Lock, MessageSquare, Search, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { realtimeApi } from "../../api/realtimeApi";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import ConversationPanel from "../../components/realtime/ConversationPanel";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { CHAT_UNREAD_EVENT } from "../../utils/chatEvents";
import { SOCKET_EVENTS } from "../../socket/socketEvents";
import { chatErrorInfo } from "../../utils/chatMessageState";

// ─────────────────────────────────────────────────────────────────────────
// ONE Communication Hub for both roles (doctor: /doctor/communication,
// patient: /patient/communication). Only labels/navigation differ; the list,
// the panel and the engine behind them are the same. Every row comes from
// server-side authorized relationship data — there is no way to type an id
// and start a conversation.
// ─────────────────────────────────────────────────────────────────────────
const initials = (name = "") => name.replace(/^dr\.?\s+/i, "").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";

const relativeTime = (value) => {
  if (!value) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const presenceText = (participant) => {
  if (participant.online) return "Online";
  if (participant.lastSeenAt) return `Last seen ${relativeTime(participant.lastSeenAt)}`;
  return "Offline";
};

function StatusPill({ status, canSend }) {
  if (canSend) return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Active</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600" title={status}>
      <Lock size={10} /> Read-only
    </span>
  );
}

function Row({ participant, selected, onSelect, preview, time, unread, status, canSend }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(participant._id)}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${selected ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}
    >
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-black text-blue-700">
        {initials(participant.name)}
        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${participant.online ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-black text-slate-950">{participant.name}</span>
          {time && <span className="shrink-0 text-[11px] font-bold text-slate-400">{time}</span>}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold text-slate-500">{preview || participant.specialization || presenceText(participant)}</span>
          {unread > 0 && <span className="min-w-5 rounded-full bg-blue-600 px-1.5 text-center text-[11px] font-black text-white" aria-label={`${unread} unread`}>{unread}</span>}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <StatusPill status={status} canSend={canSend} />
          <span className="text-[11px] font-bold text-slate-400">{presenceText(participant)}</span>
        </span>
      </span>
    </button>
  );
}

function CommunicationHub() {
  const { user } = useAuth();
  const { socket, connectionStatus } = useRealtime();
  const { userId: selectedId } = useParams();
  const navigate = useNavigate();
  const isDoctor = user?.role === "doctor";
  const basePath = isDoctor ? "/doctor/communication" : "/patient/communication";
  const counterpart = isDoctor ? "patient" : "doctor";

  const [tab, setTab] = useState("conversations");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [list, setList] = useState({ items: [], nextCursor: null, loading: true, loadingMore: false, error: null });
  const [contacts, setContacts] = useState({ items: [], page: 1, hasMore: false, loading: false, loadingMore: false, error: null });
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    const current = ++requestId.current;
    if (!silent) setList((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await realtimeApi.getConversations({ limit: 20, search: debouncedSearch || undefined, unread: unreadOnly ? "true" : undefined });
      if (current === requestId.current) setList({ items: data.items, nextCursor: data.nextCursor, loading: false, loadingMore: false, error: null });
    } catch (error) {
      if (current === requestId.current) setList((s) => ({ ...s, loading: false, error: chatErrorInfo(error).message }));
    }
  }, [debouncedSearch, unreadOnly]);

  const loadMoreConversations = async () => {
    if (!list.nextCursor || list.loadingMore) return;
    setList((s) => ({ ...s, loadingMore: true }));
    try {
      const { data } = await realtimeApi.getConversations({ limit: 20, cursor: list.nextCursor, search: debouncedSearch || undefined, unread: unreadOnly ? "true" : undefined });
      setList((s) => ({
        ...s, loadingMore: false, nextCursor: data.nextCursor,
        items: [...s.items, ...data.items.filter((item) => !s.items.some((existing) => existing.conversationKey === item.conversationKey))],
      }));
    } catch (error) {
      setList((s) => ({ ...s, loadingMore: false, error: chatErrorInfo(error).message }));
    }
  };

  const loadContacts = useCallback(async (page = 1) => {
    setContacts((s) => (page === 1 ? { ...s, loading: true, error: null } : { ...s, loadingMore: true }));
    try {
      const { data } = await realtimeApi.getContacts({ page, limit: 20, search: debouncedSearch || undefined });
      setContacts((s) => ({
        items: page === 1 ? data.items : [...s.items, ...data.items.filter((item) => !s.items.some((e) => e.participant._id === item.participant._id))],
        page: data.page, hasMore: data.hasMore, loading: false, loadingMore: false, error: null,
      }));
    } catch (error) {
      setContacts((s) => ({ ...s, loading: false, loadingMore: false, error: chatErrorInfo(error).message }));
    }
  }, [debouncedSearch]);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { if (tab === "contacts") loadContacts(1); }, [tab, loadContacts]);

  // keep the list converged with server state: new/read messages, reconnects, other tabs
  useEffect(() => {
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => loadConversations({ silent: true }), 400); };
    window.addEventListener(CHAT_UNREAD_EVENT, refresh);
    socket?.on(SOCKET_EVENTS.CHAT_MESSAGE, refresh);
    socket?.on(SOCKET_EVENTS.CHAT_READ, refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CHAT_UNREAD_EVENT, refresh);
      socket?.off(SOCKET_EVENTS.CHAT_MESSAGE, refresh);
      socket?.off(SOCKET_EVENTS.CHAT_READ, refresh);
    };
  }, [loadConversations, socket]);

  const wasOnline = useRef(false);
  useEffect(() => {
    if (connectionStatus === "online") {
      if (wasOnline.current) loadConversations({ silent: true });
      wasOnline.current = true;
    }
  }, [connectionStatus, loadConversations]);

  const select = (id) => navigate(`${basePath}/${id}`);
  const showPanelOnMobile = Boolean(selectedId);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Communication</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{isDoctor ? "Patient conversations" : "Messages with your doctors"}</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-[360px_1fr]">
        <Card className={`${showPanelOnMobile ? "hidden md:block" : ""} p-3`}>
          <div className="relative mb-3">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${counterpart}s`}
              aria-label={`Search ${counterpart}s`}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-blue-400"
            />
          </div>
          <div className="mb-3 flex items-center gap-2" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "conversations"} onClick={() => setTab("conversations")}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-black ${tab === "conversations" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
              <MessageSquare size={13} className="mr-1 inline" /> Conversations
            </button>
            <button type="button" role="tab" aria-selected={tab === "contacts"} onClick={() => setTab("contacts")}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-black ${tab === "contacts" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
              <Users size={13} className="mr-1 inline" /> {isDoctor ? "My patients" : "My doctors"}
            </button>
          </div>

          {tab === "conversations" && (
            <>
              <label className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /> Unread only
              </label>
              {list.loading ? <Loader label="Loading conversations..." /> : list.error ? (
                <div className="space-y-2 p-3 text-center" role="alert">
                  <p className="text-sm font-bold text-rose-700">{list.error}</p>
                  <Button variant="secondary" onClick={() => loadConversations()}>Try again</Button>
                </div>
              ) : list.items.length === 0 ? (
                <p className="p-4 text-center text-sm font-semibold text-slate-500">
                  {debouncedSearch || unreadOnly ? "No conversations match." : `No conversations yet. Open “${isDoctor ? "My patients" : "My doctors"}” to start one.`}
                </p>
              ) : (
                <div className="space-y-1">
                  {list.items.map((item) => (
                    <Row key={item.conversationKey} participant={item.participant} selected={item.participant._id === selectedId} onSelect={select}
                      preview={`${String(item.lastMessage.senderId) === String(user?._id) ? "You: " : ""}${item.lastMessage.preview}`}
                      time={relativeTime(item.lastMessageAt)} unread={item.unreadCount} status={item.communicationStatus} canSend={item.canSend} />
                  ))}
                  {list.nextCursor && <Button variant="secondary" className="w-full" onClick={loadMoreConversations} disabled={list.loadingMore}>{list.loadingMore ? "Loading…" : "Load more"}</Button>}
                </div>
              )}
            </>
          )}

          {tab === "contacts" && (contacts.loading ? <Loader label="Loading..." /> : contacts.error ? (
            <div className="space-y-2 p-3 text-center" role="alert">
              <p className="text-sm font-bold text-rose-700">{contacts.error}</p>
              <Button variant="secondary" onClick={() => loadContacts(1)}>Try again</Button>
            </div>
          ) : contacts.items.length === 0 ? (
            <p className="p-4 text-center text-sm font-semibold text-slate-500">
              {debouncedSearch ? "No matches." : isDoctor ? "Patients appear here once they have an approved appointment with you." : "Doctors appear here once you have an approved appointment."}
            </p>
          ) : (
            <div className="space-y-1">
              {contacts.items.map((item) => (
                <Row key={item.participant._id} participant={item.participant} selected={item.participant._id === selectedId} onSelect={select}
                  preview={item.canSend ? "Message available" : "Read-only history"} status={item.communicationStatus} canSend={item.canSend} unread={0} />
              ))}
              {contacts.hasMore && <Button variant="secondary" className="w-full" onClick={() => loadContacts(contacts.page + 1)} disabled={contacts.loadingMore}>{contacts.loadingMore ? "Loading…" : "Load more"}</Button>}
            </div>
          ))}
        </Card>

        <Card className={`${showPanelOnMobile ? "" : "hidden md:block"} p-0`}>
          {selectedId ? (
            <>
              <div className="border-b border-slate-200 p-3 md:hidden">
                <Link to={basePath} className="inline-flex items-center gap-2 text-sm font-black text-blue-600"><ArrowLeft size={16} /> All conversations</Link>
              </div>
              <ConversationPanel key={selectedId} userId={selectedId} height="68vh" typingLabel={`${counterpart === "doctor" ? "Doctor" : "Patient"} is typing`} />
            </>
          ) : (
            <div className="flex h-[68vh] flex-col items-center justify-center gap-2 p-8 text-center">
              <MessageSquare size={36} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-500">Select a conversation to read or reply.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default CommunicationHub;
