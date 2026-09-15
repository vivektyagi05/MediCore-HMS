import { useId, useRef } from "react";

const LENGTH = 6;

/**
 * Six accessible digit boxes behaving as one logical field.
 * - numeric-only input, paste support (splits a pasted 6-digit code
 *   across all boxes), backspace/arrow-key navigation, auto-focus-advance.
 * - `value` is always the parent's source of truth (a string of 0-6 digits).
 */
function OtpInput({ value, onChange, error, disabled, label }) {
  const groupId = useId();
  const inputsRef = useRef([]);
  const digits = value.padEnd(LENGTH, " ").split("").map((c) => (c === " " ? "" : c));

  const commit = (nextDigits) => {
    onChange(nextDigits.join("").replace(/\s/g, ""));
  };

  const focusIndex = (index) => {
    const el = inputsRef.current[index];
    if (el) el.focus();
  };

  const handleChange = (index, rawValue) => {
    const digit = rawValue.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    commit(next);
    if (digit && index < LENGTH - 1) focusIndex(index + 1);
  };

  const handleKeyDown = (index, event) => {
    if (event.key === "Backspace") {
      if (digits[index]) {
        const next = [...digits];
        next[index] = "";
        commit(next);
        return;
      }
      if (index > 0) {
        event.preventDefault();
        focusIndex(index - 1);
        const next = [...digits];
        next[index - 1] = "";
        commit(next);
      }
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusIndex(index - 1);
    }
    if (event.key === "ArrowRight" && index < LENGTH - 1) {
      event.preventDefault();
      focusIndex(index + 1);
    }
  };

  const handlePaste = (event) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    event.preventDefault();
    const next = pasted.padEnd(LENGTH, " ").split("").map((c) => (c === " " ? "" : c));
    commit(next);
    focusIndex(Math.min(pasted.length, LENGTH - 1));
  };

  return (
    <div role="group" aria-labelledby={`${groupId}-label`} aria-describedby={error ? `${groupId}-error` : undefined}>
      <span id={`${groupId}-label`} className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
      </span>
      <div className="flex gap-2 sm:gap-3">
        {Array.from({ length: LENGTH }).map((_, index) => (
          <input
            key={index}
            ref={(el) => { inputsRef.current[index] = el; }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            pattern="\d*"
            maxLength={1}
            value={digits[index]}
            disabled={disabled}
            aria-label={`Digit ${index + 1} of ${LENGTH}`}
            aria-invalid={Boolean(error) || undefined}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            className={`h-12 w-10 rounded-control border text-center text-lg font-bold text-slate-950 shadow-sm outline-none transition duration-150 focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-50 sm:h-14 sm:w-12 ${error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/10" : "border-slate-300 focus:border-royal-600 focus:ring-royal-600/10"}`}
          />
        ))}
      </div>
      {error && (
        <span id={`${groupId}-error`} role="alert" aria-live="assertive" className="mt-2 block text-xs font-medium text-rose-600">
          {error}
        </span>
      )}
    </div>
  );
}

export default OtpInput;
