/**
 * PatientHomeWidgets
 * ------------------------------------------------------------------
 * Pure, presentational building blocks for the Patient Home (Digital
 * Health Workspace) dashboard. Every widget here is fed real data that
 * PatientDashboard.jsx already fetched from existing, reused APIs —
 * nothing in this file calls an API, invents a model, or fabricates
 * sample data. If a dataset is empty, widgets render a genuine empty
 * state rather than placeholder content.
 */
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bell,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileHeart,
  FileText,
  History,
  Receipt,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  UserRoundPlus,
  Users,
  WalletCards,
} from "lucide-react";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import EmptyState from "../../shared/EmptyState";
import InsuranceCard from "../../insurance/InsuranceCard";
import AppointmentStatusTracker from "../AppointmentStatusTracker";

/* ------------------------------------------------------------------ */
/* Small shared helpers                                               */
/* ------------------------------------------------------------------ */

export function formatDate(value, opts) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...opts,
  });
}

export function formatMoney(amount, currency = "INR") {
  const value = Number(amount || 0);
  if (currency === "INR") return `₹${value.toLocaleString("en-IN")}`;
  return `${currency} ${value.toLocaleString()}`;
}

const TIMELINE_ICON = {
  appointment: CalendarDays,
  prescription: FileHeart,
  report: FileText,
  payment: CreditCard,
};

const NOTIFICATION_ICON = {
  appointment: CalendarDays,
  payment: CreditCard,
  refund: WalletCards,
  prescription: FileHeart,
  admin_announcement: Bell,
  chat: Bell,
  dashboard_sync: Activity,
};

const SEVERITY_STYLE = {
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-red-200 bg-red-50 text-red-700",
};

const NOTIFICATION_LINK = {
  appointment: "/patient/appointments",
  payment: "/patient/payments",
  refund: "/patient/payments",
  prescription: "/patient/records",
  chat: "/patient/appointments",
};

/* ------------------------------------------------------------------ */
/* Stat tile — today's summary strip                                   */
/* ------------------------------------------------------------------ */

export function StatTile({ icon: Icon, label, value, to, tone = "blue" }) {
  const toneClass = {
    blue: "bg-blue-600 shadow-blue-600/25",
    amber: "bg-amber-500 shadow-amber-500/25",
    emerald: "bg-emerald-600 shadow-emerald-600/25",
    red: "bg-red-600 shadow-red-600/25",
    slate: "bg-slate-900 shadow-slate-900/20",
  }[tone];

  const content = (
    <Card className={to ? "cursor-pointer" : ""}>
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-lg ${toneClass}`}>
        <Icon size={22} />
      </div>
      <p className="mt-5 text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-black capitalize text-slate-950">{value}</p>
    </Card>
  );

  if (!to) return content;
  return (
    <Link to={to} className="block">
      {content}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Quick actions                                                       */
/* ------------------------------------------------------------------ */

export function QuickActionsPanel() {
  return (
    <Card title="Quick Actions">
      <div className="grid gap-3 sm:grid-cols-2">
        <Button to="/patient/doctors" className="justify-start">
          <Stethoscope size={16} /> Find & Book a Doctor
        </Button>
        <Button to="/patient/appointments" variant="secondary" className="justify-start">
          <CalendarDays size={16} /> My Appointments
        </Button>
        <Button to="/patient/records" variant="secondary" className="justify-start">
          <FileText size={16} /> Health Records
        </Button>
        <Button to="/patient/family" variant="secondary" className="justify-start">
          <UserRoundPlus size={16} /> Manage Family
        </Button>
        <Button to="/patient/insurance" variant="secondary" className="justify-start">
          <ShieldCheck size={16} /> Insurance
        </Button>
        <Button to="/patient/ai" variant="secondary" className="justify-start">
          <Sparkles size={16} /> AI Health Assistant
        </Button>
      </div>


    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Upcoming appointment + follow-up                                    */
/* ------------------------------------------------------------------ */

export function UpcomingAppointmentCard({ appointment, onPayNow, onReview, followUp }) {
  return (
    <Card title="Upcoming Appointment">
      {appointment ? (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <p className="font-black text-slate-950">
                Dr. {appointment.doctorId?.userId?.name || "Doctor"}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {appointment.doctorId?.specialization}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {formatDate(appointment.date)} • {appointment.timeSlot}
                {appointment.consultationMode && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-600">
                    {appointment.consultationMode.replace("_", " ")}
                  </span>
                )}
              </p>
            </div>
            {appointment.doctorId?.fees != null && (
              <div className="rounded-xl bg-white/60 px-4 py-2 text-right">
                <p className="text-xs font-bold text-slate-500">Consultation fee</p>
                <p className="font-black text-slate-950">{formatMoney(appointment.doctorId.fees)}</p>
              </div>
            )}
          </div>

          <AppointmentStatusTracker
            appointment={appointment}
            onPayNow={onPayNow}
            onReview={onReview}
          />
        </div>
      ) : (
        <EmptyState
          title="No upcoming appointments"
          description="When you book a consultation, it will show up here with live status tracking."
        />
      )}

      {followUp && (
        <div className="mt-4 flex flex-col justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <CalendarClock size={18} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="text-sm font-black text-violet-800">Follow-up recommended</p>
              <p className="mt-1 text-xs font-semibold text-violet-700">
                Dr. {followUp.doctorId?.userId?.name || "Doctor"} suggested a follow-up on{" "}
                {formatDate(followUp.followUpDate)} ({followUp.diagnosis}).
              </p>
            </div>
          </div>
          {followUp.doctorId?._id && (
            <Button to={`/patient/appointments/book?doctorId=${followUp.doctorId._id}`}>
              Book follow-up
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Health timeline (condensed — full view lives on /patient/journey)   */
/* ------------------------------------------------------------------ */

export function HealthTimelineWidget({ timeline }) {
  const recent = (timeline || []).slice(0, 6);
  return (
    <Card
      title="Health Timeline"
      action={
        <Link to="/patient/journey" className="text-xs font-black text-blue-600 hover:underline">
          View full timeline
        </Link>
      }
    >
      {recent.length ? (
        <div className="space-y-3">
          {recent.map((item, index) => {
            const Icon = TIMELINE_ICON[item.type] || Activity;
            return (
              <div key={`${item.type}-${index}`} className="flex items-start gap-3 rounded-2xl bg-white/60 p-3 shadow-sm">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-black capitalize text-slate-950">{item.title}</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {item.type} • {formatDate(item.date)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No health activity yet" description="Appointments, reports, and prescriptions will appear here as they happen." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Family health                                                       */
/* ------------------------------------------------------------------ */

export function FamilyHealthWidget({ familyMembers }) {
  return (
    <Card
      title="Family Health"
      action={
        <Link to="/patient/family" className="text-xs font-black text-blue-600 hover:underline">
          Manage family
        </Link>
      }
    >
      {familyMembers?.length ? (
        <div className="space-y-3">
          {familyMembers.slice(0, 4).map((member) => (
            <div key={member._id} className="flex items-center justify-between rounded-2xl bg-white/60 p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
                  <Users size={16} />
                </div>
                <div>
                  <p className="font-black text-slate-950">{member.name}</p>
                  <p className="text-xs font-semibold text-slate-500 capitalize">
                    {member.relation} • {member.age} yrs{member.bloodGroup ? ` • ${member.bloodGroup}` : ""}
                  </p>
                </div>
              </div>
              <Button to="/patient/doctors" variant="secondary" className="!px-3 !py-1.5 text-xs">
                Book for them
              </Button>
            </div>
          ))}
          {familyMembers.length > 4 && (
            <p className="text-center text-xs font-bold text-slate-500">
              +{familyMembers.length - 4} more dependents
            </p>
          )}
        </div>
      ) : (
        <EmptyState
          title="No family members added"
          description="Add a dependent to book appointments and store their records on their behalf."
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Health insights (computed client-side from real appointment/report  */
/* data already loaded — no fabricated analysis)                       */
/* ------------------------------------------------------------------ */

export function HealthInsightsWidget({ insights }) {
  const tiles = [
    { label: "Appointments this year", value: insights.appointmentsThisYear, icon: CalendarDays },
    { label: "Completed consultations", value: insights.completedConsultations, icon: CheckCircle2 },
    { label: "Upcoming visits", value: insights.upcomingVisits, icon: CalendarClock },
    { label: "Reports uploaded", value: insights.reportsUploaded, icon: FileText },
    { label: "Most visited specialty", value: insights.mostVisitedSpecialty || "—", icon: Stethoscope },
    { label: "Most consulted doctor", value: insights.mostConsultedDoctor || "—", icon: Star },
  ];

  return (
    <Card title="Health Insights">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl bg-white/60 p-4 shadow-sm">
            <tile.icon size={18} className="text-blue-600" />
            <p className="mt-3 truncate text-lg font-black capitalize text-slate-950">{tile.value}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">{tile.label}</p>
          </div>
        ))}
      </div>
      {insights.avgFrequencyLabel && (
        <p className="mt-4 text-xs font-semibold text-slate-500">
          Average consultation frequency: <span className="font-black text-slate-800">{insights.avgFrequencyLabel}</span>
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Payments, invoices, wallet, refunds                                 */
/* ------------------------------------------------------------------ */

export function PaymentsSnapshotWidget({ payablePayments, recentPayments, invoiceCount, wallet, refundRequests }) {
  return (
    <Card
      title="Payments"
      action={
        <Link to="/patient/payments" className="text-xs font-black text-blue-600 hover:underline">
          View all payments
        </Link>
      }
    >
      {payablePayments.length > 0 && (
        <div className="mb-4 space-y-2">
          {payablePayments.slice(0, 3).map((appointment) => (
            <div key={appointment._id} className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 p-3">
              <div>
                <p className="text-sm font-black text-amber-800">
                  Dr. {appointment.doctorId?.userId?.name || "Doctor"} • {formatDate(appointment.date)}
                </p>
                <p className="text-xs font-semibold text-amber-700">Payment pending</p>
              </div>
              <Button to={`/patient/payments/${appointment._id}`} className="!px-3 !py-1.5 text-xs">
                Pay Now
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <WalletCards size={18} className="text-blue-600" />
          <p className="mt-2 text-lg font-black text-slate-950">
            {wallet ? formatMoney(wallet.balance, wallet.currency) : "—"}
          </p>
          <Link to="/patient/wallet" className="text-xs font-bold text-slate-500 hover:text-blue-600">
            Wallet balance
          </Link>
        </div>
        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <Receipt size={18} className="text-blue-600" />
          <p className="mt-2 text-lg font-black text-slate-950">{invoiceCount}</p>
          <Link to="/patient/invoices" className="text-xs font-bold text-slate-500 hover:text-blue-600">
            Invoices
          </Link>
        </div>
        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <ClipboardList size={18} className="text-blue-600" />
          <p className="mt-2 text-lg font-black text-slate-950">{refundRequests.length}</p>
          <p className="text-xs font-bold text-slate-500">Refund requests</p>
        </div>
      </div>

      {recentPayments.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Recent payments</p>
          {recentPayments.slice(0, 3).map((payment) => (
            <div key={payment._id} className="flex items-center justify-between rounded-xl bg-white/50 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-700">
                Dr. {payment.doctorId?.userId?.name || "Doctor"}
              </span>
              <span className="font-black text-slate-950">{formatMoney(payment.totalAmount, payment.currency)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Digital health record snapshot                                      */
/* ------------------------------------------------------------------ */

export function RecordsSnapshotWidget({ reportsCount, categoryBreakdown, prescriptionsCount }) {
  return (
    <Card
      title="Digital Health Record"
      action={
        <Link to="/patient/records" className="text-xs font-black text-blue-600 hover:underline">
          Open records
        </Link>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <FileText size={18} className="text-blue-600" />
          <p className="mt-2 text-lg font-black text-slate-950">{reportsCount}</p>
          <p className="text-xs font-bold text-slate-500">Reports on file</p>
        </div>
        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <FileHeart size={18} className="text-blue-600" />
          <p className="mt-2 text-lg font-black text-slate-950">{prescriptionsCount}</p>
          <p className="text-xs font-bold text-slate-500">Prescriptions</p>
        </div>
      </div>
      {categoryBreakdown.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {categoryBreakdown.map(([category, count]) => (
            <span key={category} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold capitalize text-slate-700">
              {category} · {count}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Insurance snapshot                                                   */
/* ------------------------------------------------------------------ */

export function InsuranceSnapshotWidget({ policies }) {
  return (
    <Card
      title="Insurance Status"
      action={
        <Link to="/patient/insurance" className="text-xs font-black text-blue-600 hover:underline">
          Manage insurance
        </Link>
      }
    >
      {policies.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {policies.slice(0, 2).map((policy) => (
            <InsuranceCard key={policy._id} policy={policy} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No insurance on file"
          description="Add a policy so it's ready before your next consultation."
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Unified notification center (real-time, backed by NotificationDelivery)*/
/* ------------------------------------------------------------------ */

export function NotificationCenterWidget({ notifications, unreadCount, onMarkRead, expanded, onToggleExpand }) {
  const visible = expanded ? notifications : notifications.slice(0, 5);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {unreadCount > 0 ? <BellRing size={18} className="text-blue-600" /> : <Bell size={18} className="text-slate-400" />}
          Notifications
          {unreadCount > 0 && (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-black text-white">{unreadCount}</span>
          )}
        </span>
      }
    >
      {visible.length ? (
        <div className="space-y-2">
          {visible.map((item) => {
            const Icon = NOTIFICATION_ICON[item.type] || Bell;
            const isUnread = !item.readAt;
            const link = NOTIFICATION_LINK[item.type];
            return (
              <div
                key={item._id}
                className={`flex items-start gap-3 rounded-2xl border p-3 ${SEVERITY_STYLE[item.severity] || SEVERITY_STYLE.info} ${isUnread ? "" : "opacity-70"}`}
              >
                <Icon size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black">{item.title}</p>
                  <p className="mt-0.5 text-xs font-semibold">{item.message}</p>
                  <div className="mt-2 flex items-center gap-3">
                    {link && (
                      <Link to={link} className="text-xs font-black underline underline-offset-2">
                        View
                      </Link>
                    )}
                    {isUnread && (
                      <button
                        type="button"
                        onClick={() => onMarkRead(item._id)}
                        className="text-xs font-black underline underline-offset-2"
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {notifications.length > 5 && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="w-full rounded-xl bg-white/60 py-2 text-xs font-black text-slate-600 hover:text-blue-600"
            >
              {expanded ? "Show less" : `Show all ${notifications.length}`}
            </button>
          )}
        </div>
      ) : (
        <EmptyState title="You're all caught up" description="New appointment, payment, and prescription updates will appear here instantly." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Profile completion                                                   */
/* ------------------------------------------------------------------ */

export function ProfileCompletionWidget({ percentage, missing }) {
  return (
    <Card title="Health Completion Score">
      <div className="flex items-center gap-4">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <svg className="absolute inset-0 h-20 w-20 -rotate-90">
            <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" fill="none" className="text-slate-200" />
            <circle
              cx="40"
              cy="40"
              r="34"
              stroke="currentColor"
              strokeWidth="6"
              fill="none"
              strokeDasharray={`${2 * Math.PI * 34}`}
              strokeDashoffset={`${2 * Math.PI * 34 * (1 - percentage / 100)}`}
              strokeLinecap="round"
              className="text-blue-600 transition-all"
            />
          </svg>
          <span className="text-lg font-black text-slate-950">{percentage}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-slate-950">Profile completeness</p>
          {missing.length ? (
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Missing: {missing.join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-emerald-600">Your health profile is complete.</p>
          )}
          <Link to="/patient/profile" className="mt-2 inline-block text-xs font-black text-blue-600 hover:underline">
            Complete profile →
          </Link>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Discovery — recently viewed (localStorage snapshot) + bookmarks      */
/* ------------------------------------------------------------------ */

export function DiscoveryWidget({ recentlyViewed, savedDoctors }) {
  if (!recentlyViewed.length && !savedDoctors.length) return null;
  return (
    <Card title="Continue Exploring">
      {savedDoctors.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
            <Star size={13} /> Bookmarked doctors
          </p>
          <div className="flex flex-wrap gap-2">
            {savedDoctors.slice(0, 4).map((saved) => (
              <Link
                key={saved._id}
                to={`/doctors/${saved.doctorId?._id}`}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-blue-100 hover:text-blue-700"
              >
                Dr. {saved.doctorId?.userId?.name || "Doctor"}
              </Link>
            ))}
          </div>
        </div>
      )}
      {recentlyViewed.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
            <History size={13} /> Recently viewed
          </p>
          <div className="flex flex-wrap gap-2">
            {recentlyViewed.slice(0, 4).map((doctor) => (
              <Link
                key={doctor.id}
                to={`/doctors/${doctor.id}`}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-blue-100 hover:text-blue-700"
              >
                Dr. {doctor.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Alerts strip — real, derived-from-data alerts only                  */
/* ------------------------------------------------------------------ */

export function HealthAlertsStrip({ alerts }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((alert, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
        >
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{alert.message}</span>
          {alert.to && (
            <Link to={alert.to} className="shrink-0 font-black underline underline-offset-2">
              {alert.actionLabel || "Resolve"}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
