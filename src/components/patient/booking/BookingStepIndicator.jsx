import { Check } from "lucide-react";

/**
 * Horizontal progress indicator for the appointment booking wizard.
 * `steps` is an array of short labels; `currentIndex` is 0-based.
 */
function BookingStepIndicator({ steps, currentIndex }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {steps.map((label, index) => {
          const isDone = index < currentIndex;
          const isCurrent = index === currentIndex;
          return (
            <div key={label} className="flex flex-shrink-0 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition ${
                    isDone
                      ? "bg-blue-600 text-white"
                      : isCurrent
                        ? "bg-blue-600/10 text-blue-700 ring-2 ring-blue-600"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {isDone ? <Check size={14} /> : index + 1}
                </span>
                <span
                  className={`w-20 text-center text-[11px] font-bold leading-tight ${
                    isCurrent ? "text-slate-950" : "text-slate-400"
                  }`}
                >
                  {label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <span
                  className={`mx-1 mb-4 h-0.5 w-6 flex-shrink-0 rounded-full ${
                    isDone ? "bg-blue-600" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BookingStepIndicator;
