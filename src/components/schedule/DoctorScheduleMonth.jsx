import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle, PlaneTakeoff } from "lucide-react";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import ErrorState from "../shared/ErrorState";

const toInputDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Real Month view (Phase DOC-07 final pass). The backend range endpoint is
// bounded to 31 days (MAX_RANGE_DAYS) as a deliberate Large-Data-Protection
// guard, so a calendar month (which can span parts of 6 leading/trailing
// weeks, ~35-42 grid cells) is fetched as exactly the real days-in-month
// (<=31) — the leading/trailing days from adjacent months are rendered as
// simple blank grid cells, never fetched or fabricated.
function DoctorScheduleMonth({ onOpenDay }) {
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [daysByDate, setDaysByDate] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const monthStart = useMemo(() => new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1), [monthAnchor]);
  const monthEnd = useMemo(() => new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0), [monthAnchor]);

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await doctorWorkflowApi.getScheduleRange(toInputDate(monthStart), toInputDate(monthEnd));
      const map = {};
      (res.data.days || []).forEach((d) => {
        map[d.date] = d;
      });
      setDaysByDate(map);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [monthAnchor]);

  const shiftMonth = (offset) => {
    const d = new Date(monthAnchor);
    d.setMonth(d.getMonth() + offset);
    d.setDate(1);
    setMonthAnchor(d);
  };

  // Leading blank cells so day-of-week columns line up (Monday-first grid).
  const leadingBlanks = (monthStart.getDay() + 6) % 7;
  const totalCells = monthEnd.getDate();

  const monthSummary = useMemo(() => {
    const values = Object.values(daysByDate);
    const workingDays = values.filter((d) => d.isWorkingDay);
    const totalBooked = workingDays.reduce((sum, d) => sum + d.capacity.booked, 0);
    const totalCapacity = workingDays.reduce((sum, d) => sum + d.capacity.totalSlots, 0);
    const leaveDays = values.filter((d) => d.unavailableReason === "on_leave").length;
    const conflictDays = values.filter((d) => (d.conflicts?.doubleBookedSlots?.length || 0) + (d.conflicts?.outsideCurrentHours?.length || 0) > 0).length;
    return { totalBooked, totalCapacity, leaveDays, conflictDays };
  }, [daysByDate]);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={16} />
            </Button>
            <div>
              <p className="text-sm font-black text-slate-950">{monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
              <button
                type="button"
                className="text-xs font-bold text-royal-600 hover:underline"
                onClick={() => {
                  const d = new Date();
                  d.setDate(1);
                  setMonthAnchor(d);
                }}
              >
                Jump to this month
              </button>
            </div>
            <Button variant="secondary" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && <Loader label="Loading month" />}
      {!isLoading && error && <ErrorState description={error} onRetry={load} />}

      {!isLoading && !error && Object.keys(daysByDate).length > 0 && (
        <>
          <Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-400">Consultations planned</p>
                <p className="mt-1 font-black text-slate-950">
                  {monthSummary.totalBooked} / {monthSummary.totalCapacity}
                </p>
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-400">Leave days</p>
                <p className="mt-1 flex items-center gap-1 font-black text-amber-700">
                  <PlaneTakeoff size={14} /> {monthSummary.leaveDays}
                </p>
              </div>
              {monthSummary.conflictDays > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-red-500">Days with conflicts</p>
                  <p className="mt-1 flex items-center gap-1 font-black text-red-700">
                    <AlertTriangle size={14} /> {monthSummary.conflictDays}
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="!p-3 sm:!p-6">
            <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-black uppercase tracking-wide text-slate-400 sm:gap-2 sm:text-[11px]">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                <div key={label}>
                  <span className="sm:hidden">{label.slice(0, 1)}</span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1 sm:gap-2">
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: totalCells }).map((_, i) => {
                const dateObj = new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1);
                const dateKey = toInputDate(dateObj);
                const d = daysByDate[dateKey];
                const conflictCount = (d?.conflicts?.doubleBookedSlots?.length || 0) + (d?.conflicts?.outsideCurrentHours?.length || 0);
                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => onOpenDay?.(dateKey)}
                    className={`flex min-h-[46px] flex-col justify-between rounded-lg border p-1 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:min-h-[64px] sm:rounded-xl sm:p-2 ${
                      d?.isToday ? "border-royal-400 bg-royal-50" : "border-slate-200 bg-white/60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-700 sm:text-xs">{i + 1}</span>
                      {conflictCount > 0 && <AlertTriangle size={11} className="text-red-500 sm:hidden" />}
                      {conflictCount > 0 && <AlertTriangle size={12} className="hidden text-red-500 sm:block" />}
                      {d?.unavailableReason === "on_leave" && <PlaneTakeoff size={11} className="text-amber-600" />}
                    </div>
                    {d?.isWorkingDay && !d.unavailableReason ? (
                      <span
                        className={`rounded px-1 py-0.5 text-center text-[8px] font-black sm:text-[10px] ${
                          d.capacity.utilizationPercent >= 80
                            ? "bg-red-100 text-red-700"
                            : d.capacity.utilizationPercent >= 40
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {d.capacity.booked}/{d.capacity.totalSlots}
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold text-slate-300 sm:text-[10px]">—</span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default DoctorScheduleMonth;
