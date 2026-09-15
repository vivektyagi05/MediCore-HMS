import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import ErrorState from "../shared/ErrorState";

const toInputDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Monday-start week containing `date`.
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

const DAY_LABEL = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

// Real Week view (Phase DOC-07 final pass). Every number here comes from
// GET /doctor/schedule/range, which runs buildDayCapacity — the exact same
// engine the Today view and next-available search use — once per day. No
// frontend-computed metric, no decorative calendar cells.
function DoctorScheduleWeek({ onOpenDay }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [days, setDays] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await doctorWorkflowApi.getScheduleRange(toInputDate(weekStart), toInputDate(weekEnd));
      setDays(res.data.days || []);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [weekStart]);

  const shiftWeek = (weeks) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + weeks * 7);
    setWeekStart(d);
  };

  const busiest = useMemo(() => {
    const working = days.filter((d) => d.isWorkingDay && d.capacity.totalSlots > 0);
    if (!working.length) return null;
    return working.reduce((max, d) => (d.capacity.utilizationPercent > (max?.capacity.utilizationPercent ?? -1) ? d : max), null);
  }, [days]);

  const lightest = useMemo(() => {
    const working = days.filter((d) => d.isWorkingDay && d.capacity.totalSlots > 0 && !d.isPastDate);
    if (!working.length) return null;
    return working.reduce((min, d) => (d.capacity.utilizationPercent < (min?.capacity.utilizationPercent ?? 101) ? d : min), null);
  }, [days]);

  const totalConflicts = useMemo(
    () => days.reduce((sum, d) => sum + (d.conflicts?.doubleBookedSlots?.length || 0) + (d.conflicts?.outsideCurrentHours?.length || 0), 0),
    [days],
  );

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => shiftWeek(-1)} aria-label="Previous week">
              <ChevronLeft size={16} />
            </Button>
            <div>
              <p className="text-sm font-black text-slate-950">
                {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
                {weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </p>
              <button type="button" className="text-xs font-bold text-royal-600 hover:underline" onClick={() => setWeekStart(startOfWeek(new Date()))}>
                Jump to this week
              </button>
            </div>
            <Button variant="secondary" onClick={() => shiftWeek(1)} aria-label="Next week">
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && <Loader label="Loading week" />}
      {!isLoading && error && <ErrorState description={error} onRetry={load} />}

      {!isLoading && !error && days.length > 0 && (
        <>
          {(busiest || lightest || totalConflicts > 0) && (
            <Card>
              <div className="grid gap-3 sm:grid-cols-3">
                {busiest && (
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">Busiest day</p>
                    <p className="mt-1 font-black text-slate-950">
                      {new Date(`${busiest.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} ·{" "}
                      {busiest.capacity.utilizationPercent}%
                    </p>
                  </div>
                )}
                {lightest && (
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">Lightest day</p>
                    <p className="mt-1 font-black text-slate-950">
                      {new Date(`${lightest.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} ·{" "}
                      {lightest.capacity.utilizationPercent}%
                    </p>
                  </div>
                )}
                {totalConflicts > 0 && (
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-red-500">Conflicts this week</p>
                    <p className="mt-1 flex items-center gap-1 font-black text-red-700">
                      <AlertTriangle size={14} /> {totalConflicts}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {days.map((d) => {
              const dateObj = new Date(`${d.date}T00:00:00`);
              const conflictCount = (d.conflicts?.doubleBookedSlots?.length || 0) + (d.conflicts?.outsideCurrentHours?.length || 0);
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => onOpenDay?.(d.date)}
                  className={`flex flex-col gap-2 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                    d.isToday ? "border-royal-400 bg-royal-50" : "border-slate-200 bg-white/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">{DAY_LABEL[dateObj.getDay()]}</p>
                    {conflictCount > 0 && <AlertTriangle size={14} className="text-red-500" />}
                  </div>
                  <p className="text-lg font-black text-slate-950">{dateObj.getDate()}</p>
                  {!d.isWorkingDay ? (
                    <p className="text-xs font-semibold text-slate-400">Off</p>
                  ) : d.unavailableReason && d.unavailableReason !== "not_a_working_day" ? (
                    <p className="text-xs font-semibold text-amber-600 capitalize">{d.unavailableReason.replace("_", " ")}</p>
                  ) : (
                    <>
                      <p className="text-xs font-bold text-slate-700">
                        {d.capacity.booked}/{d.capacity.totalSlots} booked
                      </p>
                      <div className="h-1.5 w-full rounded-full bg-slate-100">
                        <div
                          className={`h-1.5 rounded-full ${d.capacity.utilizationPercent >= 80 ? "bg-red-500" : d.capacity.utilizationPercent >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${d.capacity.utilizationPercent || 0}%` }}
                        />
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default DoctorScheduleWeek;
