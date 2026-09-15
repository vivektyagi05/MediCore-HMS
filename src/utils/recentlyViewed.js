export const RECENTLY_VIEWED_KEY = "medicore_recently_viewed_doctors";
const MAX_ENTRIES = 6;

/** Record a doctor the visitor just viewed. Stores a small real snapshot
 *  (name, specialization, fee, rating) captured at view time — nothing
 *  fabricated, nothing fetched again later. */
export function recordDoctorView(doctor) {
  try {
    const existing = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || "[]");
    const snapshot = {
      id: doctor.id,
      name: doctor.name,
      specialization: doctor.specialization,
      fees: doctor.fees,
      rating: doctor.rating,
      profilePhoto: doctor.profilePhoto || null,
      city: doctor.city || "",
      viewedAt: Date.now(),
    };
    const next = [snapshot, ...existing.filter((d) => d.id !== doctor.id)].slice(0, MAX_ENTRIES);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, etc.) — silently skip, non-critical
  }
}

export function getRecentlyViewed() {
  try {
    return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || "[]");
  } catch {
    return [];
  }
}
