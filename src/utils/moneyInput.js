// One strict parser for every money field (recharge, withdrawal, refund, wallet contribution).
// Why: `Number(raw)` accepts "1e3", turns "" into 0 and "abc" into NaN, and `type="number"` happily lets users type
// "1.999" or "-5". Money has at most 2 decimals; anything else is rejected with a reason (never silently rounded).
export const parseMoney = (raw, { min = 0, max = Infinity, label = "Amount", allowEmpty = false, currency = "₹" } = {}) => {
  const text = String(raw ?? "").trim();
  const fmt = (n) => `${currency}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  if (text === "") return allowEmpty ? { value: null, error: "" } : { value: null, error: `Enter ${label.toLowerCase()}` };
  if (/^\d+\.\d{3,}$/.test(text)) return { value: null, error: "Use at most 2 decimal places" };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { value: null, error: `${label} must be a plain positive number` };
  const value = Number(text);
  if (value < min) return { value: null, error: `${label} must be at least ${fmt(min)}` };
  if (value > max) return { value: null, error: `${label} cannot be more than ${fmt(max)}` };
  return { value, error: "" };
};
