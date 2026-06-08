import { CalendarPlus, Star } from "lucide-react";
import Button from "../ui/Button";

function DoctorRecommendationCard({ recommendation, onSuggestSlots }) {
  const { doctor, matchPercentage, reasons } = recommendation;

  return (
    <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-xl backdrop-blur-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-black text-slate-950">Dr. {doctor.userId?.name || "Doctor"}</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">{doctor.specialization}</p>
        </div>
        <span className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-black text-white">{matchPercentage}%</span>
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm font-bold text-amber-600">
        <Star size={16} fill="currentColor" /> {doctor.rating || 0}/5
      </div>
      <div className="mt-4 space-y-2">
        {reasons.map((reason) => (
          <p key={reason} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{reason}</p>
        ))}
      </div>
      <Button className="mt-5 w-full" variant="secondary" onClick={() => onSuggestSlots(doctor._id)}>
        <CalendarPlus size={17} /> Smart Slots
      </Button>
    </div>
  );
}

export default DoctorRecommendationCard;
