import {
  Activity,
  AlertTriangle,
  Bot,
  CreditCard,
  HeartPulse,
  Radio,
  ShieldAlert,
  Siren,
  Stethoscope,
  UsersRound,
  Wallet,
  CalendarClock,
  Bell,
  Cpu,
} from "lucide-react";

const currency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="font-black text-slate-950">{value}</span>
    </div>
  );
}

function MiniBarList({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.slice(-10).map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 truncate text-slate-500">{row.label}</span>
          <div className="h-2 flex-1 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right font-bold text-slate-700">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export const WIDGET_RENDER_CONFIG = {
  revenue: {
    icon: Wallet,
    renderBody: (data) => (
      <div>
        <StatRow label="Today" value={currency(data.revenue?.today)} />
        <StatRow label="This week" value={currency(data.revenue?.week)} />
        <StatRow label="This month" value={currency(data.revenue?.month)} />
        {data.revenuePerDay?.length > 0 && (
          <div className="mt-3">
            <MiniBarList rows={data.revenuePerDay.map((r) => ({ label: r._id.slice(5), value: r.total }))} />
          </div>
        )}
      </div>
    ),
    exportRows: (data) => data.revenuePerDay?.map((r) => ({ date: r._id, total: r.total })) || [],
  },
  appointments: {
    icon: CalendarClock,
    renderBody: (data) => (
      <div>
        <StatRow label="Today" value={data.appointments?.today ?? 0} />
        <StatRow label="Pending" value={data.appointments?.pending ?? 0} />
        <StatRow label="Completed today" value={data.appointments?.completedToday ?? 0} />
        <StatRow label="Cancellation rate" value={`${data.cancellationRate ?? 0}%`} />
      </div>
    ),
    renderDrillDown: (data) => (
      <div className="space-y-1">
        {Object.entries(data.appointments?.statusBreakdown || {}).map(([status, count]) => (
          <StatRow key={status} label={status} value={count} />
        ))}
      </div>
    ),
    exportRows: (data) => data.appointmentsPerDay?.map((r) => ({ date: r._id, count: r.count })) || [],
  },
  doctors: {
    icon: Stethoscope,
    renderBody: (data) => (
      <div>
        <StatRow label="Total" value={data.doctors?.total ?? 0} />
        <StatRow label="Active" value={data.doctors?.active ?? 0} />
        <StatRow label="Online now" value={data.doctors?.online ?? 0} />
      </div>
    ),
    renderDrillDown: (data) => (
      <div>
        <p className="mb-2 text-xs font-black uppercase text-slate-500">Top specialties</p>
        {(data.topSpecialties || []).map((s) => (
          <StatRow key={s._id} label={s._id || "Unspecified"} value={s.count} />
        ))}
        <p className="mb-2 mt-4 text-xs font-black uppercase text-slate-500">Top doctors by consultations</p>
        {(data.topDoctors || []).map((d) => (
          <StatRow key={d._id} label={d.name || "Unknown"} value={d.consultations} />
        ))}
      </div>
    ),
  },
  patients: {
    icon: UsersRound,
    renderBody: (data) => (
      <div>
        <StatRow label="Total" value={data.patients?.total ?? 0} />
        <StatRow label="Active now" value={data.patients?.active ?? 0} />
        <StatRow label="Repeat patients" value={data.repeatPatients ?? 0} />
      </div>
    ),
  },
  insurance: {
    icon: ShieldAlert,
    renderBody: (data) => <StatRow label="Expiring within 14 days" value={data.expiringWithin14Days ?? 0} />,
    renderDrillDown: (data) => (
      <div className="space-y-2">
        {(data.items || []).map((item) => (
          <div key={item._id} className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="font-bold text-slate-900">{item.provider} · {item.policyNumber}</p>
            <p className="text-xs text-slate-500">Valid till {new Date(item.validTill).toLocaleDateString()} · {item.claimStatus}</p>
          </div>
        ))}
      </div>
    ),
    exportRows: (data) => data.items?.map((i) => ({ provider: i.provider, policyNumber: i.policyNumber, validTill: i.validTill, claimStatus: i.claimStatus })) || [],
  },
  refunds: {
    icon: CreditCard,
    renderBody: (data) => (
      <div>
        <StatRow label="Pending" value={data.refunds?.pendingCount ?? 0} />
        <StatRow label="Pending amount" value={currency(data.refunds?.pendingAmount)} />
      </div>
    ),
    renderDrillDown: (data) => (
      <div className="space-y-2">
        {(data.items || []).map((item) => (
          <div key={item._id} className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="font-bold text-slate-900">{currency(item.amount)} · {item.status}</p>
            <p className="text-xs text-slate-500">{item.reason}</p>
          </div>
        ))}
      </div>
    ),
    exportRows: (data) => data.items?.map((i) => ({ amount: i.amount, status: i.status, reason: i.reason, createdAt: i.createdAt })) || [],
  },
  notifications: {
    icon: Bell,
    renderBody: (data) => (
      <div>
        <StatRow label="Last 15 min" value={data.last15Min ?? 0} />
        <StatRow label="Unread critical" value={data.unreadCritical ?? 0} />
      </div>
    ),
    renderDrillDown: (data) => (
      <div className="space-y-2">
        {(data.items || []).map((item) => (
          <div key={item._id} className="flex items-center justify-between rounded-xl border border-slate-200 p-2 text-xs">
            <span className="font-bold text-slate-800">{item.title}</span>
            <span className="text-slate-400">{item.severity}</span>
          </div>
        ))}
      </div>
    ),
  },
  ai: {
    icon: Bot,
    renderBody: (data) => (
      <div>
        <StatRow label="Requests today" value={data.aiRequestsToday ?? 0} />
        <StatRow label="Drafts today" value={data.aiActivityToday ?? 0} />
        <StatRow label="Discard rate" value={`${data.discardRate ?? 0}%`} />
      </div>
    ),
  },
  automation: {
    icon: Cpu,
    renderBody: (data) => (
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-400">{data.model}</p>
        {(data.jobs || []).slice(0, 4).map((job) => (
          <StatRow key={job.jobName} label={job.jobName.replace("automation:", "")} value={job.status} />
        ))}
      </div>
    ),
    renderDrillDown: (data) => (
      <div className="space-y-2">
        {(data.jobs || []).map((job) => (
          <div key={job.jobName} className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="font-bold text-slate-900">{job.jobName}</p>
            <p className="text-xs text-slate-500">
              {job.status} · {job.startedAt ? new Date(job.startedAt).toLocaleString() : "never run"}
              {job.durationMs != null && ` · ${job.durationMs}ms`}
            </p>
            {job.error && <p className="mt-1 text-xs text-rose-600">{job.error}</p>}
          </div>
        ))}
      </div>
    ),
  },
  platformHealth: {
    icon: HeartPulse,
    renderBody: (data) => (
      <div>
        <StatRow label="Overall score" value={`${data.overallHealth?.score ?? 0}/100`} />
        <StatRow label="Status" value={data.overallHealth?.status ?? "unknown"} />
      </div>
    ),
    renderDrillDown: (data) => (
      <div className="space-y-1">
        {(data.overallHealth?.breakdown || []).map((line) => (
          <p key={line} className="text-xs text-slate-600">{line}</p>
        ))}
      </div>
    ),
  },
  systemStatus: {
    icon: Radio,
    renderBody: (data) => (
      <div>
        <StatRow label="Database" value={data.database?.state ?? "unknown"} />
        <StatRow label="Realtime clients" value={data.realtime?.connectedClients ?? 0} />
        <StatRow label="Storage" value={data.storage?.healthy ? "Writable" : "Unavailable"} />
      </div>
    ),
  },
  criticalAlerts: {
    icon: AlertTriangle,
    renderBody: (data) => (
      <div>
        <StatRow label="Critical" value={data.counts?.critical ?? 0} />
        <StatRow label="High" value={data.counts?.high ?? 0} />
      </div>
    ),
    renderDrillDown: (data) => (
      <div className="space-y-2">
        {(data.alerts || []).map((alert) => (
          <div key={alert.key} className="rounded-xl border border-slate-200 p-2 text-xs">
            <span className="font-bold text-slate-800">{alert.title}</span> — {alert.count}
          </div>
        ))}
      </div>
    ),
  },
  emergency: {
    icon: Siren,
    renderBody: (data) => (
      <div>
        <StatRow label="Emergency today" value={data.emergencyToday ?? 0} />
        <StatRow label="Critical reports pending" value={data.criticalReportsPending ?? 0} />
      </div>
    ),
  },
  liveSessions: {
    icon: Activity,
    renderBody: (data) => (
      <div>
        <StatRow label="Doctors online" value={data.presence?.doctorsOnline ?? 0} />
        <StatRow label="Patients online" value={data.presence?.patientsOnline ?? 0} />
        <StatRow label="Live consultations" value={data.liveConsultations ?? 0} />
      </div>
    ),
    renderDrillDown: (data) => (
      <div className="space-y-1">
        {(data.items || []).map((s) => (
          <StatRow key={s._id} label={s.role} value={new Date(s.lastActiveAt).toLocaleTimeString()} />
        ))}
      </div>
    ),
  },
};
