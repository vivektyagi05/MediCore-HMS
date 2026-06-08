import { Star } from "lucide-react";

function RatingStars({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} type="button" onClick={() => onChange?.(star)} className={star <= value ? "text-amber-500" : "text-slate-300"}>
          <Star size={22} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}

export default RatingStars;
