/**
 * DoctorHomeWidgets
 * ------------------------------------------------------------------
 * Pure, presentational building blocks for the Doctor Command Center
 * (Phase DOC-07 final pass — dashboard re-architecture). Every widget
 * here is fed real data DoctorDashboard.jsx already fetched from
 * existing, reused APIs (appointmentApi, doctorApi, doctorWorkflowApi,
 * commandCenterApi) — nothing in this file calls an API, computes a
 * capacity/availability number itself, or fabricates sample content. An
 * empty dataset always renders a genuine empty state, never a filler
 * value. This mirrors the established PatientHomeWidgets.jsx pattern so
 * the two dashboards share one visual language.
 */
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileClock,
  Gauge,
  Home,
  MapPin,
  Sparkles,
  Star,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  Video,
  XCircle,
} from "lucide-react";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import EmptyState from "../../shared/EmptyState";
import { MiniBarChart } from "../../finance/FinanceCharts";
import { consultationModeLabel, appointmentStatusLabel } from "../../../utils/appointmentStatusDisplay.js";

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatMoney(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
}

/* ------------------------------------------------------------------ */
/* A. HERO — Today's Clinic                                           */
/* ------------------------------------------------------------------ */
export function DoctorHero({
  firstName,
  clinicOpenToday,
  todayCount,
  completedCount,
  lastSyncedAt,
  onRefresh,
  primaryAction,
  todayCapacity,
  todayCapacityError,
  onRetryTodayCapacity,
  currentConsultationId,
  nextConsultationId,
}) {
  return (
    <Card className="!bg-slate-950 !p-6 text-white">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
            {firstName ? `Good ${dayPart()}, Dr. ${firstName}` : "Good day"}
          </h1>
          <p className="mt-2 text-sm font-semibold text-slate-300">Here's what needs your attention today.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {clinicOpenToday !== null && (
              <span className={`rounded-xl px-3 py-1.5 text-xs font-black ${clinicOpenToday ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
                {clinicOpenToday ? "Clinic open today" : "Clinic closed today"}
              </span>
            )}
            <span className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-slate-200">
              {completedCount}/{todayCount} consultations done today
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          {primaryAction}
          <button onClick={onRefresh} className="text-xs font-bold text-slate-400 hover:text-white">
            Refresh{lastSyncedAt ? ` · Synced ${lastSyncedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
          </button>
        </div>
      </div>
      <TodayTimetable
        todayCapacity={todayCapacity}
        todayCapacityError={todayCapacityError}
        onRetry={onRetryTodayCapacity}
        currentConsultationId={currentConsultationId}
        nextConsultationId={nextConsultationId}
      />
    </Card>
  );
}

function dayPart() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

/* ------------------------------------------------------------------ */
/* A2. TODAY'S TIMETABLE — compact clinical schedule inside the Hero   */
/* ------------------------------------------------------------------ */
// Reuses the real, already-fetched todayCapacity (buildDayCapacity via
// GET /doctor/schedule/day) — no second appointment fetch, no frontend-
// computed capacity number. currentConsultationId/nextConsultationId are
// passed straight through from DoctorDashboard's existing
// currentConsultation/nextConsultation derivation so this never runs a
// second, competing current/next calculation.
const TIMETABLE_COMPLETED_STATUSES = ["completed", "review_eligible", "consultation_completed"];

// Collapses runs of consecutive "available" / "break" slots into one
// summarized row so a full day of open slots doesn't turn the compact
// hero timetable into a 30-row list. Booked slots are never grouped —
// every real appointment always gets its own row.
function groupTimelineForDisplay(timeline) {
  const groups = [];
  for (const slot of timeline) {
    const prev = groups[groups.length - 1];
    if (prev && prev.status === slot.status && (slot.status === "available" || slot.status === "break")) {
      prev.endTime = slot.endTime;
      prev.count += 1;
    } else {
      groups.push({ ...slot, count: 1 });
    }
  }
  return groups;
}

function ConsultationModeIcon({ mode }) {
  if (mode === "online") return <Video size={12} />;
  if (mode === "in_person") return <MapPin size={12} />;
  if (mode === "home_visit") return <Home size={12} />;
  return null;
}

export function TodayTimetable({ todayCapacity, todayCapacityError, onRetry, currentConsultationId, nextConsultationId }) {
  if (todayCapacityError) {
    return (
      <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
        <p className="text-sm font-black text-red-200">Couldn't load today's timetable</p>
        <p className="mt-1 text-xs font-semibold text-red-200/70">{todayCapacityError}</p>
        <button onClick={onRetry} className="mt-2 text-xs font-black text-red-100 underline underline-offset-2 hover:text-white">
          Retry
        </button>
      </div>
    );
  }

  if (!todayCapacity) {
    return (
      <div className="mt-5 space-y-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (!todayCapacity.isWorkingDay) {
    const copy = {
      not_a_working_day: { title: "Not a working day", detail: "You have no working hours configured for today." },
      blocked_date: { title: "Schedule blocked today", detail: "Today is marked as blocked on your schedule." },
      on_leave: { title: "On leave today", detail: "You're on approved leave today — no consultation slots apply." },
    }[todayCapacity.unavailableReason] || { title: "No slots today", detail: "No consultation slots are configured for today." };
    return (
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-black text-slate-100">{copy.title}</p>
        <p className="mt-1 text-xs font-semibold text-slate-400">{copy.detail}</p>
      </div>
    );
  }

  const timeline = todayCapacity.timeline || [];
  const groups = groupTimelineForDisplay(timeline);
  const hasBooked = groups.some((g) => g.status === "booked");

  if (!hasBooked) {
    const available = todayCapacity.capacity?.available ?? 0;
    return (
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-black text-slate-100">No patients booked yet today</p>
        <p className="mt-1 text-xs font-semibold text-slate-400">
          {available > 0
            ? `${available} open slot${available === 1 ? "" : "s"} between ${todayCapacity.startTime}–${todayCapacity.endTime}.`
            : "No open slots remain today."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Today's Timetable</p>
        {todayCapacity.nextFreeSlotToday && (
          <p className="text-[11px] font-bold text-slate-400">Next open: {todayCapacity.nextFreeSlotToday}</p>
        )}
      </div>
      <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {groups.map((g, idx) => {
          if (g.status === "available") {
            return (
              <div key={`available-${idx}`} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-400">
                <span className="w-24 shrink-0 tabular-nums">{g.startTime}–{g.endTime}</span>
                <span>{g.count} open slot{g.count === 1 ? "" : "s"}</span>
              </div>
            );
          }
          if (g.status === "break") {
            return (
              <div key={`break-${idx}`} className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-3 py-2 text-xs font-semibold text-slate-500">
                <span className="w-24 shrink-0 tabular-nums">{g.startTime}–{g.endTime}</span>
                <span>Break</span>
              </div>
            );
          }

          // status === "booked"
          const appt = g.appointment;
          if (!appt) return null;
          const isCompleted = TIMETABLE_COMPLETED_STATUSES.includes(appt.status);
          const isCancelled = appt.status === "cancelled";
          const isCurrent = Boolean(currentConsultationId) && appt.appointmentId === currentConsultationId;
          const isNext = !isCurrent && Boolean(nextConsultationId) && appt.appointmentId === nextConsultationId;

          return (
            <Button
              key={`booked-${idx}-${appt.appointmentId}`}
              variant="secondary"
              to="/doctor/schedule"
              className={`!w-full !justify-start !gap-3 !border-0 !py-2 !shadow-none ${
                isCurrent ? "!bg-royal-600" : isNext ? "!bg-white/10 !ring-1 !ring-white/20" : "!bg-white/[0.06] hover:!bg-white/10"
              }`}
            >
              <span className="w-24 shrink-0 text-left font-black tabular-nums text-slate-200">{g.startTime}–{g.endTime}</span>
              <span className={`min-w-0 flex-1 truncate text-left font-bold ${isCancelled ? "text-slate-500 line-through" : "text-white"}`}>
                {appt.patientName}
              </span>
              {appt.consultationMode && (
                <span className="hidden shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-300 sm:flex">
                  <ConsultationModeIcon mode={appt.consultationMode} /> {consultationModeLabel(appt.consultationMode)}
                </span>
              )}
              {g.isConflict && (
                <span className="shrink-0 rounded bg-red-500/80 px-1.5 py-0.5 text-[10px] font-black text-white">+{g.overflowCount}</span>
              )}
              {isCurrent ? (
                <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-black text-royal-700">NOW</span>
              ) : isNext ? (
                <span className="shrink-0 rounded bg-emerald-400/90 px-1.5 py-0.5 text-[10px] font-black text-slate-950">NEXT</span>
              ) : isCompleted ? (
                <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
              ) : (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">{appointmentStatusLabel(appt.status)}</span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* B. TODAY AT A GLANCE                                                */
/* ------------------------------------------------------------------ */
export function TodayGlanceStrip({ todayCount, completedCount, remainingCount, availableSlots, pendingApprovalsCount, onOpenApprovals }) {
  const tiles = [
    { label: "Today's appointments", value: todayCount, to: "#todays-clinic" },
    { label: "Completed", value: completedCount, to: "#todays-clinic" },
    { label: "Remaining", value: remainingCount, to: "#todays-clinic" },
    { label: "Available slots", value: availableSlots ?? "—", to: "#capacity" },
    { label: "Pending approvals", value: pendingApprovalsCount, onClick: onOpenApprovals },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <a
          key={tile.label}
          href={tile.to || "#"}
          onClick={tile.onClick}
          className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-2xl font-black text-slate-950">{tile.value}</p>
          <p className="mt-1 text-xs font-bold text-slate-500">{tile.label}</p>
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* C. CURRENT / NEXT CONSULTATION                                      */
/* ------------------------------------------------------------------ */
export function CurrentNextConsultation({ current, next, onEndConsultation, updatingId }) {
  const appt = current || next;
  if (!appt) {
    return (
      <Card title={current ? "Current Consultation" : "Next Consultation"}>
        <EmptyState title="No consultations scheduled right now" description="Your next confirmed appointment will show up here." action={<Button variant="secondary" to="/doctor/schedule">View Schedule</Button>} />
      </Card>
    );
  }
  const isCurrent = Boolean(current);
  return (
    <Card title={isCurrent ? "Current Consultation" : "Next Consultation"}>
      <div className={`flex flex-col justify-between gap-4 rounded-2xl p-5 lg:flex-row lg:items-center ${isCurrent ? "bg-slate-950 text-white" : "bg-royal-50"}`}>
        <div>
          <p className={`font-black ${isCurrent ? "text-white" : "text-slate-950"}`}>{appt.patientId?.name || "Patient"}</p>
          <p className={`mt-1 text-sm font-semibold ${isCurrent ? "text-slate-300" : "text-slate-600"}`}>
            {formatDate(appt.date)} · {appt.timeSlot}
            {appt.consultationMode === "online" ? (
              <span className="ml-2 inline-flex items-center gap-1"><Video size={13} /> Online</span>
            ) : appt.consultationMode === "in_person" ? (
              <span className="ml-2 inline-flex items-center gap-1"><MapPin size={13} /> In-person</span>
            ) : appt.consultationMode === "home_visit" ? (
              <span className="ml-2 inline-flex items-center gap-1"><Home size={13} /> Home visit</span>
            ) : null}
          </p>
          {isCurrent && <p className="mt-1 text-xs font-black uppercase tracking-wide text-emerald-300">In progress</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={isCurrent ? "secondary" : "primary"} to={`/doctor/clinical?patientId=${appt.patientId?._id}&tab=history`}>
            Open Clinical Workspace
          </Button>
          {isCurrent && (
            <Button isLoading={updatingId === appt._id} onClick={() => onEndConsultation(appt._id)}>
              End Consultation
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* D. TODAY'S SCHEDULE PREVIEW                                        */
/* ------------------------------------------------------------------ */
export function SchedulePreview({ appointments, currentId }) {
  return (
    <Card id="todays-clinic" title="Today's Schedule" action={<Button variant="secondary" to="/doctor/schedule">Open Full Schedule <ChevronRight size={14} /></Button>}>
      {appointments.length ? (
        <div className="space-y-2">
          {appointments.map((a) => {
            const isCurrent = a._id === currentId;
            const isCompleted = ["completed", "review_eligible", "consultation_completed"].includes(a.status);
            const isCancelled = a.status === "cancelled";
            return (
              <Button
                key={a._id}
                variant="secondary"
                to={`/doctor/clinical?patientId=${a.patientId?._id}&tab=history`}
                className={`!w-full !justify-start !gap-3 ${isCurrent ? "!border-royal-400 !bg-royal-50" : isCancelled ? "!opacity-50" : ""}`}
              >
                <span className="w-16 shrink-0 text-xs font-black text-slate-500">{a.timeSlot}</span>
                <span className={`truncate font-bold ${isCancelled ? "line-through text-slate-400" : "text-slate-900"}`}>{a.patientId?.name || "Patient"}</span>
                {isCompleted && <CheckCircle2 size={14} className="ml-auto shrink-0 text-emerald-500" />}
                {isCurrent && <span className="ml-auto shrink-0 rounded bg-royal-600 px-1.5 py-0.5 text-[10px] font-black text-white">NOW</span>}
              </Button>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No patients scheduled today" description="Your timeline will fill in as appointments are booked and approved." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* E. CAPACITY / WORKLOAD                                              */
/* ------------------------------------------------------------------ */
export function CapacityPanel({ capacity }) {
  if (!capacity) {
    return (
      <Card id="capacity" title="Today's Capacity">
        <EmptyState title="Capacity unavailable" description="Could not load today's real capacity from the schedule engine." />
      </Card>
    );
  }
  if (!capacity.isWorkingDay) {
    return (
      <Card id="capacity" title="Today's Capacity">
        <EmptyState title="Not a working day" description="Your schedule isn't configured for today, so there are no consultation slots." />
      </Card>
    );
  }
  const { booked, totalSlots, available, utilizationPercent } = capacity.capacity;
  const conflictCount = (capacity.conflicts?.doubleBookedSlots?.length || 0) + (capacity.conflicts?.outsideCurrentHours?.length || 0);
  return (
    <Card id="capacity" title="Today's Capacity" action={<Button variant="secondary" to="/doctor/schedule">Open Schedule <ChevronRight size={14} /></Button>}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-2xl font-black text-slate-950">
            {booked} / {totalSlots} <span className="text-sm font-bold text-slate-500">consultations booked</span>
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {utilizationPercent ?? 0}% utilized · {available} slot{available === 1 ? "" : "s"} available
          </p>
        </div>
        {capacity.nextFreeSlotToday && (
          <div className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">
            Next available: {capacity.nextFreeSlotToday}
          </div>
        )}
        {conflictCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">
            <AlertTriangle size={14} /> {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
      <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
        <div
          className={`h-2 rounded-full ${utilizationPercent >= 80 ? "bg-red-500" : utilizationPercent >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${utilizationPercent || 0}%` }}
        />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* F. ATTENTION CENTER                                                 */
/* ------------------------------------------------------------------ */
const ATTENTION_TONE_CLASSES = {
  danger: "border-red-200 bg-red-50",
  warning: "border-amber-200 bg-amber-50",
  info: "border-slate-200 bg-white/60",
};

function AttentionRow({ tone = "info", title, detail, actionLabel, to, onAction, isLoading }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 ${ATTENTION_TONE_CLASSES[tone]}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-slate-950">{title}</p>
        {detail && <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{detail}</p>}
      </div>
      {actionLabel && to && (
        <Button variant={tone === "danger" ? "danger" : "secondary"} to={to} size="sm">
          {actionLabel}
        </Button>
      )}
      {actionLabel && !to && (
        <Button variant={tone === "danger" ? "danger" : "secondary"} size="sm" isLoading={isLoading} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function AttentionTier({ label, tone, items }) {
  if (!items.length) return null;
  const headingClass = tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-slate-500";
  return (
    <div className="space-y-2">
      <p className={`text-[11px] font-black uppercase tracking-wide ${headingClass}`}>{label}</p>
      <div className="space-y-2">
        {items.map(({ key, ...item }) => (
          <AttentionRow key={key} {...item} />
        ))}
      </div>
    </div>
  );
}

export function AttentionCenter({ urgentItems, needsActionItems, informationItems }) {
  const hasAny = urgentItems.length || needsActionItems.length || informationItems.length;
  return (
    <Card title="Attention Center">
      {hasAny ? (
        <div className="space-y-4">
          <AttentionTier label="Urgent" tone="danger" items={urgentItems} />
          <AttentionTier label="Needs Action" tone="warning" items={needsActionItems} />
          <AttentionTier label="Information" tone="info" items={informationItems} />
        </div>
      ) : (
        <EmptyState title="You're all caught up" description="Nothing urgent, no pending approvals, and no follow-ups overdue right now." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* G. FOLLOW-UP WORK QUEUE                                             */
/* ------------------------------------------------------------------ */
// PHASE P10 — "scheduled"/"completed"/"cancelled_needs_action" added
// alongside the original three so the queue covers the full continuity
// loop (Overdue -> Due Today -> Upcoming -> Scheduled -> Recently
// Completed), plus the one case that needs the doctor back: a scheduled
// follow-up whose appointment got cancelled.
const BUCKET_LABEL = {
  cancelled_needs_action: "Cancelled — Needs Action",
  overdue: "Overdue",
  due_today: "Due Today",
  upcoming: "Upcoming",
  scheduled: "Scheduled",
  completed: "Recently Completed",
};
const BUCKET_TONE = {
  cancelled_needs_action: "text-red-600",
  overdue: "text-red-600",
  due_today: "text-amber-600",
  upcoming: "text-slate-500",
  scheduled: "text-violet-600",
  completed: "text-emerald-600",
};
const BUCKET_ORDER = ["cancelled_needs_action", "overdue", "due_today", "upcoming", "scheduled", "completed"];

export function FollowUpQueue({ followUpsDue, onSchedule, onOpenAppointment, truncated }) {
  return (
    <Card title="Follow-up Work Queue">
      {followUpsDue.length ? (
        <div className="space-y-4">
          {BUCKET_ORDER.map((bucket) => {
            const items = followUpsDue.filter((f) => f.bucket === bucket);
            if (!items.length) return null;
            // Already-scheduled/completed items have a real appointment to
            // open rather than a recommendation still needing one; a
            // cancelled one needs the same "Schedule" action as an
            // unscheduled recommendation (it IS one again).
            const needsScheduling = bucket !== "scheduled" && bucket !== "completed";
            return (
              <div key={bucket}>
                <p className={`mb-1.5 text-[11px] font-black uppercase tracking-wide ${BUCKET_TONE[bucket]}`}>{BUCKET_LABEL[bucket]}</p>
                <div className="space-y-2">
                  {items.slice(0, 5).map((f) => (
                    <div key={f.prescriptionId} className="flex items-center gap-2 rounded-2xl bg-white/60 p-1">
                      <Button
                        variant="secondary"
                        to={`/doctor/clinical?patientId=${f.patientId}&tab=history`}
                        className="!flex-1 !justify-start !border-0 !shadow-none"
                      >
                        <span className="truncate">{f.patientName}</span>
                        <span className="ml-2 shrink-0 text-xs text-slate-400">
                          {formatDate(f.followUpDate)}
                          {f.appointmentTimeSlot ? ` · ${f.appointmentTimeSlot}` : ""}
                        </span>
                      </Button>
                      {needsScheduling ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            onSchedule({ patientId: f.patientId, patientName: f.patientName, prescriptionId: f.prescriptionId, diagnosis: f.diagnosis })
                          }
                        >
                          Schedule
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => onOpenAppointment?.(f)}>
                          Open Appointment
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No follow-ups due" description="Patients with an upcoming or overdue follow-up will appear here." />
      )}
      {/* PHASE P10 (scale audit) — communicates the boundary rather than
          silently truncating: when the bounded scheduled/completed query
          drops real items, this says so and points at the full,
          already-paginated Appointments list instead. */}
      {truncated && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          Showing the most relevant scheduled/completed follow-ups only.{" "}
          <Button variant="secondary" size="sm" to="/doctor/appointments" className="!inline !p-0 !text-xs !underline">
            View all in Appointments
          </Button>
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* H. CLINICAL WORK COMPLETION                                         */
/* ------------------------------------------------------------------ */
export function ClinicalWorkCompletion({ incompleteConsultations, pendingPrescriptions, pendingReportsCount, overdueFollowUpsCount }) {
  const items = [
    { label: "Consultations in progress", value: incompleteConsultations, to: "/doctor/clinical", icon: Stethoscope },
    { label: "Missing prescriptions", value: pendingPrescriptions, to: "/doctor/clinical", icon: FileClock },
    { label: "Reports awaiting review", value: pendingReportsCount, to: "/doctor/documents", icon: ClipboardList },
    { label: "Follow-ups overdue", value: overdueFollowUpsCount, to: "#followup-queue", icon: CalendarClock },
  ];
  const hasAnyWork = items.some((i) => (i.value || 0) > 0);
  return (
    <Card title="Clinical Work Completion">
      {hasAnyWork ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {items
            .filter((i) => (i.value || 0) > 0)
            .map((i) => (
              <a key={i.label} href={i.to} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 p-3.5 transition hover:-translate-y-0.5 hover:shadow-md">
                <i.icon size={18} className="shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-lg font-black text-slate-950">{i.value}</p>
                  <p className="truncate text-xs font-bold text-slate-500">{i.label}</p>
                </div>
              </a>
            ))}
        </div>
      ) : (
        <EmptyState title="No incomplete clinical work" description="Unsigned consultations, missing prescriptions, and pending reports will show up here." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* J. REPUTATION / PRACTICE SIGNAL                                     */
/* ------------------------------------------------------------------ */
export function ReputationSnapshot({ reviewIntelligence }) {
  if (!reviewIntelligence) {
    return (
      <Card title="Patient Signal">
        <EmptyState title="No review data yet" description="Ratings and reviews will appear here once patients start leaving them." />
      </Card>
    );
  }
  const mostRecent = reviewIntelligence.reviews?.[0];
  const trend = reviewIntelligence.ratingTrendDirection;

const trendDirection = trend
    ? trend.delta > 0
      ? "up"
      : trend.delta < 0
        ? "down"
        : "flat"
    : null;
  return (
    <Card title="Patient Signal" action={<Button variant="secondary" to="/doctor/reviews">View Reviews <ChevronRight size={14} /></Button>}>
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-2xl font-black text-slate-950">
            <Star size={18} className="fill-amber-400 text-amber-400" /> {Number(reviewIntelligence.averageRating || 0).toFixed(1)}
          </p>
          {trendDirection && trendDirection !== "flat" && (
            <p className={`mt-1 flex items-center gap-1 text-xs font-bold ${trendDirection === "up" ? "text-emerald-600" : "text-red-600"}`}>
              {trendDirection === "up" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              Trending {trendDirection} · {trend.delta > 0 ? "+" : ""}{trend.delta}
            </p>
          )}
        </div>
        {reviewIntelligence.unrepliedCount > 0 && (
          <div className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black text-amber-700">
            {reviewIntelligence.unrepliedCount} awaiting reply
          </div>
        )}
      </div>
      {mostRecent && (
        <div className="mt-3 rounded-2xl bg-white/60 p-3.5">
          <p className="text-xs font-bold text-slate-500">Recent review · {mostRecent.patientId?.name || "Patient"}</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-700">{mostRecent.comment || "No comment left."}</p>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* K. EARNINGS / PRACTICE SNAPSHOT                                     */
/* ------------------------------------------------------------------ */
export function EarningsSnapshot({ earnings }) {
  if (!earnings) {
    return (
      <Card title="Earnings">
        <EmptyState title="No earnings data yet" description="Your practice earnings will appear here once payments are recorded." />
      </Card>
    );
  }
  return (
    <Card title="Earnings" action={<Button variant="secondary" to="/doctor/earnings">View Earnings <ChevronRight size={14} /></Button>}>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Today</p>
          <p className="mt-1 text-lg font-black text-slate-950">{formatMoney(earnings.todayEarnings)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">This Week</p>
          <p className="mt-1 text-lg font-black text-slate-950">{formatMoney(earnings.weeklyEarnings)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">This Month</p>
          <p className="mt-1 text-lg font-black text-slate-950">{formatMoney(earnings.monthlyEarnings)}</p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* M. TRENDS & INTELLIGENCE                                            */
/* ------------------------------------------------------------------ */
// Every series here already existed on the backend before this panel —
// analytics.revenueTrend / analytics.cancellationTrend (buildDoctorAnalyticsIntelligence,
// workflowController.js) and reviewIntelligence.monthlyTrend
// (buildDoctorReviewIntelligence, doctorReviewController.js) were computed
// and shipped to the dashboard already, just never rendered. No new trend
// calculation was written for this panel — it reuses the same 6-month
// bucketing every other page in the app already reads, via the shared,
// dependency-free MiniBarChart (finance/FinanceCharts.jsx) rather than a
// new charting engine.
function TrendMiniChart({ title, periodLabel, to, unavailable, empty, emptyDescription, children, forecastNote }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black text-slate-950">{title}</p>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{periodLabel}</p>
        </div>
        {to && (
          <Button variant="secondary" size="sm" to={to}>
            View <ChevronRight size={12} />
          </Button>
        )}
      </div>
      <div className="mt-3">
        {unavailable ? (
          <p className="text-sm font-semibold text-slate-400">Trend data unavailable right now.</p>
        ) : empty ? (
          <p className="text-sm font-semibold text-slate-400">{emptyDescription}</p>
        ) : (
          children
        )}
      </div>
      {forecastNote && <p className="mt-2 text-[11px] font-bold text-slate-400">{forecastNote}</p>}
    </div>
  );
}

export function TrendsIntelligencePanel({ analytics, reviewIntelligence }) {
  const revenueTrend = analytics?.revenueTrend || [];
  const cancellationTrend = analytics?.cancellationTrend || [];
  const ratingTrend = reviewIntelligence?.monthlyTrend || [];

  const hasRevenueData = revenueTrend.some((m) => m.revenue > 0);
  const hasCancellationData = cancellationTrend.some((m) => m.cancelled > 0);
  const hasRatingData = ratingTrend.some((m) => m.count > 0);

  // Forecast is an explicit projection off the same revenueTrend series —
  // only shown once there's at least one real revenue month to project
  // from, and always labeled as a forecast, never presented as fact.
  const showForecast = analytics && hasRevenueData && analytics.revenueForecast != null;

  return (
    <Card title="Trends &amp; Intelligence">
      <div className="grid gap-4 lg:grid-cols-3">
        <TrendMiniChart
          title="Revenue Trend"
          periodLabel="Last 6 months"
          to="/doctor/earnings"
          unavailable={!analytics}
          empty={analytics && !hasRevenueData}
          emptyDescription="No recorded revenue yet in this window."
          forecastNote={
            showForecast
              ? `Forecast next month: ${formatMoney(analytics.revenueForecast)} (${analytics.growthForecast >= 0 ? "+" : ""}${analytics.growthForecast}%) — a projection, not a guarantee`
              : null
          }
        >
          <MiniBarChart data={revenueTrend} valueKey="revenue" labelKey="month" formatValue={formatMoney} />
        </TrendMiniChart>

        <TrendMiniChart
          title="Cancellation Trend"
          periodLabel="Last 6 months"
          to="/doctor/schedule"
          unavailable={!analytics}
          empty={analytics && !hasCancellationData}
          emptyDescription="No cancellations in this window."
        >
          <MiniBarChart data={cancellationTrend} valueKey="cancelled" labelKey="month" barClassName="fill-amber-500" />
        </TrendMiniChart>

        <TrendMiniChart
          title="Rating Trend"
          periodLabel="Last 6 months"
          to="/doctor/reviews"
          unavailable={!reviewIntelligence}
          empty={reviewIntelligence && !hasRatingData}
          emptyDescription="No reviews yet in this window."
        >
          <MiniBarChart
            data={ratingTrend}
            valueKey="avgRating"
            labelKey="label"
            formatValue={(v) => Number(v || 0).toFixed(1)}
            barClassName="fill-emerald-500"
          />
        </TrendMiniChart>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* I. QUICK ACTIONS                                                    */
/* ------------------------------------------------------------------ */
export function QuickActionsPanel({ items }) {
  return (
    <Card title="Quick Actions">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Button key={item.path} variant="secondary" to={item.path}>
            <item.icon size={14} className="mr-1.5" /> {item.name}
          </Button>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pending Approvals (kept as its own compact widget — real actions)   */
/* ------------------------------------------------------------------ */
export function PendingApprovalsQueue({ appointments, onApprove, onReject, updatingId }) {
  return (
    <Card id="pending-approvals" title="Pending Approval Requests">
      {appointments.length ? (
        <div className="space-y-2">
          {appointments.slice(0, 8).map((a) => (
            <div key={a._id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/60 p-3.5 shadow-sm">
              <div className="min-w-0">
                <p className="truncate font-black text-slate-950">{a.patientId?.name || "Patient"}</p>
                <p className="text-xs font-semibold text-slate-500">{formatDate(a.date)} · {a.timeSlot}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" isLoading={updatingId === a._id} onClick={() => onApprove(a)}>
                  <CheckCircle2 size={14} />
                </Button>
                <Button size="sm" variant="secondary" isLoading={updatingId === a._id} onClick={() => onReject(a)}>
                  <XCircle size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No pending requests" description="New booking requests will appear here for approval." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* L. AI                                                                */
/* ------------------------------------------------------------------ */
export function AIAssistCallout({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs font-semibold text-blue-700">
      <Sparkles size={14} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-black uppercase tracking-wide text-blue-500">AI suggestion — not a system fact</p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}
