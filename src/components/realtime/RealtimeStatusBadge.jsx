import { Wifi, WifiOff } from "lucide-react";
import { useRealtime } from "../../context/RealtimeContext";

const styles = {
  online: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  connecting: "bg-amber-50 text-amber-700 ring-amber-200",
  offline: "bg-slate-100 text-slate-600 ring-slate-200",
  error: "bg-red-50 text-red-700 ring-red-200",
};

function RealtimeStatusBadge() {
  const { connectionStatus } = useRealtime();
  const isOnline = connectionStatus === "online";

  return (
    <span className={`hidden items-center gap-2 rounded-xl px-3 py-2 text-xs font-black capitalize ring-1 sm:inline-flex ${styles[connectionStatus] || styles.offline}`}>
      {isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}
      {connectionStatus}
    </span>
  );
}

export default RealtimeStatusBadge;
