// P23 canonical monetary arithmetic: public/API values remain INR rupees for
// backward compatibility, but every operation is performed in integer paise.
export const toPaise = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid monetary value");
  return Math.round((number + Number.EPSILON) * 100);
};

export const fromPaise = (paise) => {
  const number = Number(paise);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid paise value");
  return Number((number / 100).toFixed(2));
};

export const addMoney = (...values) => fromPaise(values.reduce((sum, value) => sum + toPaise(value), 0));
export const subtractMoney = (a, b) => fromPaise(toPaise(a) - toPaise(b));
export const multiplyMoney = (amount, factor) => fromPaise(Math.round(toPaise(amount) * Number(factor)));
export const percentOf = (amount, percent) => multiplyMoney(amount, Number(percent) / 100);

export const calculateBill = ({ subtotal, discount = 0, taxRate = 0 }) => {
  const subtotalPaise = toPaise(subtotal);
  const discountPaise = Math.min(Math.max(toPaise(discount), 0), subtotalPaise);
  const taxablePaise = subtotalPaise - discountPaise;
  const taxPaise = Math.round(taxablePaise * (Number(taxRate) / 100));
  const totalPaise = taxablePaise + taxPaise;
  return {
    subtotal: fromPaise(subtotalPaise),
    discount: fromPaise(discountPaise),
    taxableSubtotal: fromPaise(taxablePaise),
    tax: fromPaise(taxPaise),
    total: fromPaise(totalPaise),
  };
};

// ONE canonical doctor/platform allocation. Integer-paise arithmetic, and the
// two parts always sum exactly to the gross (the doctor share is the remainder,
// never an independently rounded product). The fee percentage is configurable
// (PLATFORM_FEE_PERCENT, default 10 = the previously hard-coded split).
export const platformFeePercent = (source = process.env) => {
  const parsed = Number(source.PLATFORM_FEE_PERCENT);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 10;
};

export const allocatePayout = (grossAmount, feePercent = platformFeePercent()) => {
  const platformFee = percentOf(grossAmount, feePercent);
  return {
    grossAmount: fromPaise(toPaise(grossAmount)),
    platformFee,
    doctorAmount: subtractMoney(grossAmount, platformFee),
  };
};
