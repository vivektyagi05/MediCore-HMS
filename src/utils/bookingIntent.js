const BOOKING_PATH = "/patient/appointments/book";
const BOOKING_KEYS = ["doctorId", "consultationMode", "date", "timeSlot"];

export const isSafeInternalPath = (value) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || /^(?:javascript|data|vbscript):/i.test(value)) return false;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
};

export const buildBookingReturnPath = ({ doctorId, consultationMode, date, timeSlot } = {}) => {
  if (!doctorId) return BOOKING_PATH;
  const params = new URLSearchParams({ doctorId: String(doctorId) });
  if (consultationMode) params.set("consultationMode", String(consultationMode));
  if (date) params.set("date", String(date));
  if (timeSlot) params.set("timeSlot", String(timeSlot));
  return `${BOOKING_PATH}?${params.toString()}`;
};

export const isBookingIntent = (value) => {
  if (!isSafeInternalPath(value)) return false;
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname === BOOKING_PATH && Boolean(url.searchParams.get("doctorId"));
  } catch {
    return false;
  }
};

export const sanitizeBookingIntent = (value) => {
  if (!isBookingIntent(value)) return null;
  const url = new URL(value, window.location.origin);
  const params = new URLSearchParams();
  const doctorId = url.searchParams.get("doctorId");
  if (!doctorId) return null;
  params.set("doctorId", doctorId);
  BOOKING_KEYS.slice(1).forEach((key) => {
    const item = url.searchParams.get(key);
    if (item) params.set(key, item);
  });
  return `${BOOKING_PATH}?${params.toString()}`;
};

export const getSafeRedirectTarget = (value) => {
  if (!isSafeInternalPath(value)) return null;
  return isBookingIntent(value) ? sanitizeBookingIntent(value) : value;
};

export const BOOKING_RETURN_PATH = BOOKING_PATH;
