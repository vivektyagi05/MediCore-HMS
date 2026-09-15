import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PlaneTakeoff,
  Video,
  Building2,
  Phone,
  ArrowRight,
} from "lucide-react";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import ErrorState from "../shared/ErrorState";

const toDateInputValue = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const formatDisplayDate = (value) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// Slot status -> StatusBadge tone. One place this mapping lives, so the
// Today timeline and any future consumer of the same day-capacity payload
// never render the same status two different colors.
const STATUS_TONE = {
  booked: "info",
  available: "success",
  break: "neutral",
  blocked: "danger",
  leave: "warning",
  past: "neutral",
  unavailable: "neutral",
};

const STATUS_LABEL = {
  booked: "Booked",
  available: "Available",
  break: "Break",
  blocked: "Blocked",
  leave: "On leave",
  past: "Past",
  unavailable: "Unavailable",
};

// Left-rail marker color per status — deliberately a small, separate map
// from STATUS_TONE (which drives the text/pill) so the timeline's vertical
// spine can use flat dot colors instead of pill background tints.
const RAIL_DOT_CLASS = {
  booked: "bg-royal-600 ring-royal-100",
  available: "bg-emerald-500 ring-emerald-100",
  break: "bg-slate-300 ring-slate-100",
  blocked: "bg-rose-500 ring-rose-100",
  leave: "bg-amber-500 ring-amber-100",
  past: "bg-slate-200 ring-slate-100",
  unavailable: "bg-slate-200 ring-slate-100",
};

const CONSULTATION_ICON = {
  video_call: Video,
  in_person: Building2,
  phone_call: Phone,
};

const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};

// Real Schedule & Capacity Intelligence for a single day (Phase DOC-07).
// Everything rendered here comes directly from GET /doctor/schedule/day —
// the same buildDayCapacity engine the patient-facing "next available"
// search and the booking flow's slot list are built on, so this view can
// never show the doctor something different from what a patient actually
// sees.
// Phase DOC-07 final pass: initialDate lets Week/Month view's "Open day"
// action jump this same Today view straight to the clicked date, instead of
// building a second single-day view inside Week/Month.
function DoctorScheduleToday({ initialDate } = {}) {
  const [dateValue, setDateValue] = useState(() => initialDate || toDateInputValue(new Date()));
  const [day, setDay] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // Real wall-clock tick, used only to place a "now" marker on today's
  // timeline and to pick out the next upcoming slot — never to invent a
  // slot state the backend didn't compute.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (initialDate) setDateValue(initialDate);
  }, [initialDate]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const load = async (targetDate) => {
    setIsLoading(true);
    setError("");
    try {
      const res = await doctorWorkflowApi.getScheduleDay(targetDate);
      setDay(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(dateValue);
  }, [dateValue]);

  const shiftDay = (offset) => {
    const d = new Date(`${dateValue}T00:00:00`);
    d.setDate(d.getDate() + offset);
    setDateValue(toDateInputValue(d));
  };

  const isToday = dateValue === toDateInputValue(new Date());
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : null;

  const conflictCount = useMemo(() => {
    if (!day) return 0;
    return (day.conflicts?.doubleBookedSlots?.length || 0) + (day.conflicts?.outsideCurrentHours?.length || 0);
  }, [day]);

  // Which real timeline slot is "now" and which is "next" — both derived
  // purely from the real slot start/end times already in day.timeline plus
  // the real current time. No status is invented; this only decides which
  // already-real slot gets extra visual emphasis.
  const { currentSlotKey, nextSlotKey } = useMemo(() => {
    if (!day || !isToday || nowMinutes == null) return { currentSlotKey: null, nextSlotKey: null };
    let current = null;
    let next = null;
    for (const slot of day.timeline) {
      const start = toMinutes(slot.startTime);
      const end = toMinutes(slot.endTime);
      if (start == null || end == null) continue;
      if (nowMinutes >= start && nowMinutes < end) current = slot.slot;
      if (next == null && start >= nowMinutes && slot.status === "booked") next = slot.slot;
    }
    return { currentSlotKey: current, nextSlotKey: next };
  }, [day, isToday, nowMinutes]);

  const nextAppointment = useMemo(() => {
    if (!nextSlotKey || !day) return null;
    return day.timeline.find((s) => s.slot === nextSlotKey) || null;
  }, [day, nextSlotKey]);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" onClick={() => shiftDay(-1)} aria-label="Previous day">
              <ChevronLeft size={16} />
            </Button>
            <div>
              <p className="text-base font-bold text-slate-950">{formatDisplayDate(dateValue)}</p>
              <button
                type="button"
                className="text-xs font-semibold text-royal-600 hover:underline"
                onClick={() => setDateValue(toDateInputValue(new Date()))}
              >
                {isToday ? "Today" : "Jump to today"}
              </button>
            </div>
            <Button variant="secondary" size="icon" onClick={() => shiftDay(1)} aria-label="Next day">
              <ChevronRight size={16} />
            </Button>
          </div>
          <input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="rounded-control border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-royal-600"
          />
        </div>
      </Card>

      {isLoading && <Loader label="Loading schedule" />}

      {!isLoading && error && <ErrorState description={error} onRetry={() => load(dateValue)} />}

      {!isLoading && !error && day && (
        <>
          {day.unavailableReason ? (
            <Card>
              <div className="flex items-center gap-3 text-slate-700">
                {day.unavailableReason === "on_leave" ? <PlaneTakeoff className="text-amber-600" /> : <CalendarOff className="text-slate-500" />}
                <div>
                  <p className="font-bold text-slate-950">
                    {day.unavailableReason === "not_a_working_day" && "Not a configured working day"}
                    {day.unavailableReason === "blocked_date" && "This date is blocked on your calendar"}
                    {day.unavailableReason === "on_leave" && "You are on approved leave this day"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {day.unavailableReason === "not_a_working_day"
                      ? "Configure this day in the Configure tab if you'd like to see patients."
                      : "No slots are bookable while this is in effect."}
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {/* CAPACITY SNAPSHOT */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Total slots today" value={day.capacity.totalSlots} icon={Clock3} />
                <MetricCard
                  label="Booked"
                  value={day.capacity.booked}
                  caption={day.capacity.totalSlots ? `${day.capacity.utilizationPercent}% utilization` : "No slots configured"}
                  tone="premium"
                />
                <MetricCard label="Available now" value={day.capacity.available} tone="success" />
                <MetricCard
                  label={isToday ? "Next appointment" : "Next free slot"}
                  value={isToday ? nextAppointment?.appointment?.patientName || (day.nextFreeSlotToday ? "Open slot" : "None left") : day.nextFreeSlotToday || "None left"}
                  caption={isToday && nextAppointment ? nextAppointment.slot : undefined}
                  tone={isToday ? (nextAppointment ? "info" : day.nextFreeSlotToday ? "success" : "danger") : day.nextFreeSlotToday ? "success" : "danger"}
                />
              </div>

              {/* CAPACITY UTILIZATION BAR — a single segmented bar built only
                  from the real capacity counts above, so the day's shape is
                  readable at a glance before scanning the full timeline. */}
              {day.capacity.totalSlots > 0 && (
                <Card className="!p-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>Day shape</span>
                    <span>{day.capacity.totalSlots} slots</span>
                  </div>
                  <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    {day.capacity.booked > 0 && (
                      <div className="h-full bg-royal-600" style={{ width: `${(day.capacity.booked / day.capacity.totalSlots) * 100}%` }} title={`${day.capacity.booked} booked`} />
                    )}
                    {day.capacity.break > 0 && (
                      <div className="h-full bg-slate-300" style={{ width: `${(day.capacity.break / day.capacity.totalSlots) * 100}%` }} title={`${day.capacity.break} break`} />
                    )}
                    {day.capacity.available > 0 && (
                      <div className="h-full bg-emerald-500" style={{ width: `${(day.capacity.available / day.capacity.totalSlots) * 100}%` }} title={`${day.capacity.available} available`} />
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs font-semibold text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-royal-600" /> Booked</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" /> Break</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Available</span>
                  </div>
                </Card>
              )}

              {conflictCount > 0 && (
                <Card>
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-rose-100 text-rose-600">
                      <AlertTriangle size={18} />
                    </span>
                    <div className="space-y-1 text-sm">
                      <p className="font-bold text-slate-950">
                        {conflictCount} scheduling conflict{conflictCount === 1 ? "" : "s"} on this day
                      </p>
                      {day.conflicts.doubleBookedSlots.map((slot) => (
                        <p key={slot} className="text-slate-600">
                          <strong>{slot}</strong> has more than one active appointment booked — resolve by
                          rescheduling or cancelling one of them from Appointments.
                        </p>
                      ))}
                      {day.conflicts.outsideCurrentHours.map((item) => (
                        <p key={item.appointmentId} className="text-slate-600">
                          <strong>{item.patientName}</strong>&apos;s appointment at {item.timeSlot} no longer
                          falls within your current working hours — your schedule config changed after this
                          was booked.
                        </p>
                      ))}
                    </div>
                  </div>
                </Card>
              )}

              {/* TIMELINE — the visual centerpiece. A connected vertical rail
                  instead of a flat list, so working hours, breaks, bookings
                  and the current moment read as one continuous day rather
                  than a table of rows. */}
              <Card title="Timeline">
                {day.timeline.length === 0 ? (
                  <p className="text-sm text-slate-500">No slots generated for this day.</p>
                ) : (
                  <ol className="relative ml-3 space-y-0 border-l-2 border-slate-100">
                    {day.timeline.map((slot) => {
                      const isCurrent = slot.slot === currentSlotKey;
                      const isNext = slot.slot === nextSlotKey;
                      const ModeIcon = slot.appointment?.consultationMode
                        ? CONSULTATION_ICON[slot.appointment.consultationMode]
                        : null;

                      return (
                        <li key={slot.slot} className="relative pb-4 pl-6 last:pb-0">
                          <span
                            className={`absolute -left-[9px] top-1.5 h-4 w-4 rounded-full ring-4 ${RAIL_DOT_CLASS[slot.status] || RAIL_DOT_CLASS.available} ${isCurrent ? "scale-125" : ""}`}
                            aria-hidden="true"
                          />
                          <div
                            className={`flex flex-wrap items-center justify-between gap-3 rounded-card border p-3.5 transition ${
                              slot.isConflict
                                ? "border-rose-300 bg-rose-50"
                                : isCurrent
                                  ? "border-royal-300 bg-royal-50 shadow-elevated"
                                  : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                              <span className="w-24 shrink-0 font-bold text-slate-950 sm:w-28">{slot.slot}</span>
                              <StatusBadge tone={STATUS_TONE[slot.status] || "neutral"}>
                                {STATUS_LABEL[slot.status] || slot.status}
                              </StatusBadge>
                              {isCurrent && <StatusBadge tone="premium">Now</StatusBadge>}
                              {isNext && !isCurrent && <StatusBadge tone="info">Next</StatusBadge>}
                              {slot.isConflict && <StatusBadge tone="danger">Double booked</StatusBadge>}
                            </div>
                            {slot.appointment && (
                              <div className="flex min-w-0 items-center gap-2 text-right">
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-900">{slot.appointment.patientName}</p>
                                  <p className="text-xs capitalize text-slate-500">
                                    {slot.appointment.consultationMode?.replace("_", " ") || slot.appointment.status.replace("_", " ")}
                                  </p>
                                </div>
                                {ModeIcon && (
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-royal-100 text-royal-600">
                                    <ModeIcon size={15} />
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>

              {isToday && nextAppointment && (
                <Card className="border-royal-200 bg-royal-50 !p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-control bg-royal-600 text-white">
                        <ArrowRight size={18} />
                      </span>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-royal-700">Coming up next</p>
                        <p className="font-bold text-slate-950">
                          {nextAppointment.appointment.patientName} · {nextAppointment.slot}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default DoctorScheduleToday;
