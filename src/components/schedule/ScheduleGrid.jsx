import Button from "../ui/Button";
import Input from "../ui/Input";

const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function ScheduleGrid({ availability, setAvailability }) {
  const getSlots = (day) => availability.find((item) => item.dayOfWeek === day)?.timeSlots || [];
  const setSlots = (day, value) => {
    const timeSlots = value.split(",").map((item) => item.trim()).filter(Boolean);
    const exists = availability.some((item) => item.dayOfWeek === day);
    setAvailability(exists ? availability.map((item) => item.dayOfWeek === day ? { ...item, timeSlots } : item) : [...availability, { dayOfWeek: day, timeSlots }]);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {days.map((day) => (
        <div key={day} className="rounded-2xl bg-white/60 p-4 shadow-lg">
          <p className="mb-3 text-sm font-black capitalize text-slate-950">{day}</p>
          <Input placeholder="09:00, 10:00, 16:30" value={getSlots(day).join(", ")} onChange={(e) => setSlots(day, e.target.value)} />
        </div>
      ))}
      <Button className="md:col-span-2" type="submit">Save Weekly Schedule</Button>
    </div>
  );
}

export default ScheduleGrid;
