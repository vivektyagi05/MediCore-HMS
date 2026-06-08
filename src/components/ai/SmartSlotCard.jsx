import { Clock3 } from "lucide-react";

function SmartSlotCard({ slot }) {
  return (
    <div className="rounded-2xl bg-slate-950 p-4 text-white shadow-xl">
      <Clock3 className="text-blue-400" size={22} />
      <p className="mt-4 text-lg font-black">{new Date(slot.date).toLocaleDateString()} at {slot.timeSlot}</p>
      <p className="mt-2 text-sm font-semibold text-slate-300">{slot.reason}</p>
      <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-blue-300">AI score {slot.score}</p>
    </div>
  );
}

export default SmartSlotCard;
