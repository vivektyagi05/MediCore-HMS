import { Bell } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useRealtime } from "../../context/RealtimeContext";
import EmptyState from "../shared/EmptyState";

function LiveNotificationCenter() {
  const { notifications, unreadCount, markNotificationRead } = useRealtime();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className="relative rounded-xl bg-white/70 p-3 text-slate-900 shadow-lg transition hover:-translate-y-0.5 hover:bg-white"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Open live notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-black text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="absolute right-0 top-14 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/70 bg-white/85 shadow-2xl backdrop-blur-xl"
          >
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="font-black text-slate-950">Live notifications</p>
              <p className="text-xs font-semibold text-slate-500">Reconnect-safe delivery</p>
            </div>
            <div className="max-h-96 overflow-y-auto p-3">
              {notifications.length ? (
                <div className="space-y-2">
                  {notifications.map((notification) => (
                    <button
                      key={notification._id}
                      className={`w-full rounded-xl p-3 text-left shadow-sm transition hover:bg-white ${notification.readAt ? "bg-slate-50/70" : "bg-blue-50/80"}`}
                      onClick={() => !notification.readAt && markNotificationRead(notification._id)}
                    >
                      <p className="text-sm font-black text-slate-950">{notification.title}</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{notification.message}</p>
                      <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState title="No notifications" description="Live appointment, payment, and chat updates will appear here." />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LiveNotificationCenter;
