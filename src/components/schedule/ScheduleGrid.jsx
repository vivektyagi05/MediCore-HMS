import Button from "../ui/Button";
import Input from "../ui/Input";

const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

const previewSlots = (day) => {
  if (!day?.startTime || !day?.endTime || !day?.slotDurationMinutes) return [];
  const duration = Number(day.slotDurationMinutes) || 30;
  const buffer = Number(day.bufferMinutes) || 0;
  const step = duration + buffer;
  const start = toMinutes(day.startTime);
  const end = toMinutes(day.endTime);
  if (!(step > 0) || start === null || end === null || end <= start) return [];
  const breaks = day.breaks || [];
  const slots = [];
  for (let cursor = start; cursor + duration <= end; cursor += step) {
    const slotEnd = cursor + duration;
    const inBreak = breaks.some((b) => {
      const bs = toMinutes(b.start);
      const be = toMinutes(b.end);
      return bs !== null && be !== null && cursor < be && slotEnd > bs;
    });
    if (inBreak) continue;
    const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    slots.push(`${fmt(cursor)}-${fmt(slotEnd)}`);
  }
  return slots;
};

function ScheduleGrid({ availability, setAvailability }) {
  const getDay = (dayOfWeek) => availability.find((item) => item.dayOfWeek === dayOfWeek);

  const updateDay = (dayOfWeek, patch) => {
    const existing = getDay(dayOfWeek);
    const merged = { dayOfWeek, timeSlots: existing?.timeSlots || [], ...existing, ...patch };
    const exists = availability.some((item) => item.dayOfWeek === dayOfWeek);
    setAvailability(
      exists
        ? availability.map((item) => (item.dayOfWeek === dayOfWeek ? merged : item))
        : [...availability, merged],
    );
  };

  const toggleDay = (dayOfWeek, enabled) => {
    if (!enabled) {
      setAvailability(availability.filter((item) => item.dayOfWeek !== dayOfWeek));
      return;
    }
    updateDay(dayOfWeek, {
      startTime: "09:00",
      endTime: "17:00",
      slotDurationMinutes: 30,
      bufferMinutes: 5,
      breaks: [{ start: "13:00", end: "14:00" }],
      maxPatientsPerSlot: 1,
      emergencySlotsPerDay: 0,
    });
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-slate-500">
        Set working hours once — the system automatically generates every bookable time slot, respecting
        your buffer time and breaks. You never need to type individual time slots.
      </p>
      {days.map((day) => {
        const config = getDay(day);
        const enabled = Boolean(config);
        const slots = previewSlots(config);
        return (
          <div key={day} className="rounded-2xl bg-white/60 p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <p className="text-sm font-black capitalize text-slate-950">{day}</p>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => toggleDay(day, e.target.checked)}
                />
                Working day
              </label>
            </div>

            {enabled && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Input
                  label="Start time"
                  type="time"
                  value={config.startTime || ""}
                  onChange={(e) => updateDay(day, { startTime: e.target.value })}
                />
                <Input
                  label="End time"
                  type="time"
                  value={config.endTime || ""}
                  onChange={(e) => updateDay(day, { endTime: e.target.value })}
                />
                <Input
                  label="Appointment duration (min)"
                  type="number"
                  min={5}
                  max={240}
                  value={config.slotDurationMinutes || 30}
                  onChange={(e) => updateDay(day, { slotDurationMinutes: Number(e.target.value) })}
                />
                <Input
                  label="Buffer between appointments (min)"
                  type="number"
                  min={0}
                  max={120}
                  value={config.bufferMinutes || 0}
                  onChange={(e) => updateDay(day, { bufferMinutes: Number(e.target.value) })}
                />
                <Input
                  label="Break start"
                  type="time"
                  value={config.breaks?.[0]?.start || ""}
                  onChange={(e) =>
                    updateDay(day, { breaks: [{ ...(config.breaks?.[0] || {}), start: e.target.value }] })
                  }
                />
                <Input
                  label="Break end"
                  type="time"
                  value={config.breaks?.[0]?.end || ""}
                  onChange={(e) =>
                    updateDay(day, { breaks: [{ ...(config.breaks?.[0] || {}), end: e.target.value }] })
                  }
                />
                <Input
                  label="Emergency slots per day"
                  type="number"
                  min={0}
                  max={20}
                  value={config.emergencySlotsPerDay || 0}
                  onChange={(e) => updateDay(day, { emergencySlotsPerDay: Number(e.target.value) })}
                />

                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-bold uppercase text-slate-500">
                    Preview — {slots.length} slot{slots.length === 1 ? "" : "s"} will be generated
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot) => (
                      <span key={slot} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {slot}
                      </span>
                    ))}
                    {slots.length === 0 && (
                      <span className="text-xs text-red-500">
                        No slots yet — check that end time is after start time and duration/buffer fit the window.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <Button className="mt-2" type="submit">
        Save Weekly Schedule
      </Button>
    </div>
  );
}

export default ScheduleGrid;
