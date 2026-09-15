import { Circle } from "lucide-react";
import { useRealtime } from "../../context/RealtimeContext";
import EmptyState from "../shared/EmptyState";

function OnlineUsers() {
  const { onlineUsers } = useRealtime();

  if (!onlineUsers.length) {
    return <EmptyState title="No active users" description="Online staff and patient sessions will appear as they connect." />;
  }

  return (
    <div className="space-y-3">
      {onlineUsers.map((user) => (
        <div key={user.userId} className="flex items-center justify-between rounded-2xl bg-white/60 p-4 shadow-lg">
          <div>
            <p className="font-black text-slate-950">User {user.userId.slice(-6)}</p>
            <p className="mt-1 text-sm font-semibold text-slate-500">{user.activeConnections} active connection(s)</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
            <Circle size={10} fill="currentColor" /> Online
          </span>
        </div>
      ))}
    </div>
  );
}

export default OnlineUsers;
