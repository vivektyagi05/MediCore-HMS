import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";

import { realtimeApi } from "../../api/realtimeApi";
import { getApiErrorMessage } from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useRealtime } from "../../context/RealtimeContext";

const TYPE_LABELS = {
  appointment: "Appointments",
  payment: "Payments",
  refund: "Refunds",
  prescription: "Prescriptions",
  admin_announcement: "System Alerts",
  chat: "Messages",
  dashboard_sync: "Sync Events",
  report: "Reports",
  insurance: "Insurance",
  workflow_assigned: "Assignments",
  workflow_escalated: "Escalations",
  automation: "Automation",
  reminder: "Reminders",
};

const SEVERITY_STYLES = {
  info: "border-blue-200 bg-blue-50",
  success: "border-emerald-200 bg-emerald-50",
  warning: "border-amber-200 bg-amber-50",
  critical: "border-rose-200 bg-rose-50",
};

function AdminNotifications() {
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const params = { limit: 50 };
      if (unreadOnly) params.unread = "true";
      const response = await realtimeApi.getNotifications(params);
      setNotifications(response.data?.notifications || []);
      setUnreadCount(response.data?.unreadCount || 0);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [unreadOnly, dashboardSyncTick]);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return notifications;
    return notifications.filter((n) => n.type === typeFilter);
  }, [notifications, typeFilter]);

  const grouped = useMemo(() => {
    return filtered.reduce((acc, notification) => {
      const key = notification.type;
      if (!acc[key]) acc[key] = [];
      acc[key].push(notification);
      return acc;
    }, {});
  }, [filtered]);

  const markRead = async (id) => {
    try {
      await realtimeApi.markNotificationRead(id);
      await loadNotifications();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Notification Center</h1>
          <p className="text-sm text-slate-500">
            Appointments, payments, refunds, reviews, and system alerts in one operational feed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
            {unreadCount} unread
          </span>
          <Button variant="secondary" onClick={loadNotifications}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All categories</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            Unread only
          </label>
        </div>

        {loading ? (
          <Loader label="Loading notifications" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No notifications"
            description="Platform events (new bookings, payments, refunds, reviews) will appear here in real time."
          />
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([type, items]) => (
              <div key={type}>
                <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <Bell size={14} /> {TYPE_LABELS[type] || type}
                </p>
                <div className="space-y-2">
                  {items.map((notification) => (
                    <div
                      key={notification._id}
                      className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
                        SEVERITY_STYLES[notification.severity] || "border-slate-200 bg-white/60"
                      } ${notification.readAt ? "opacity-60" : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{notification.title}</p>
                        <p className="text-sm text-slate-600">{notification.message}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {new Date(notification.createdAt).toLocaleString()}
                        </p>
                      </div>
                      {!notification.readAt && (
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => markRead(notification._id)}
                        >
                          <CheckCheck size={14} /> Mark read
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default AdminNotifications;
