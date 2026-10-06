import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import Card from "../../components/ui/Card";
import ConversationPanel from "../../components/realtime/ConversationPanel";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

// Legacy entry point (/chat/:userId, still linked from appointment cards).
// Doctors and patients are sent to their Communication Hub — the same engine,
// with the conversation list around it. super_admin keeps the standalone
// support conversation view.
function ChatWorkspace() {
  const { userId } = useParams();
  const { user } = useAuth();
  const { connectionStatus } = useRealtime();
  const { t } = useI18n();

  if (user?.role === "doctor") return <Navigate to={`/doctor/communication/${userId}`} replace />;
  if (user?.role === "patient") return <Navigate to={`/patient/communication/${userId}`} replace />;

  return (
    <div className="space-y-6">
      <Link to="/admin/dashboard" className="inline-flex items-center gap-2 text-sm font-black text-blue-600">
        <ArrowLeft size={17} /> Back
      </Link>
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">{t("ui.realtimeChat")}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{t("ui.careConversation")}</h1>
      </div>
      <Card>
        <div className="border-b border-slate-200 p-4">
          <p className="text-sm font-black capitalize text-slate-950">Connection: {connectionStatus}</p>
        </div>
        <ConversationPanel userId={userId} height="60vh" typingLabel={t("ui.careTeamTyping")} />
      </Card>
    </div>
  );
}

export default ChatWorkspace;
