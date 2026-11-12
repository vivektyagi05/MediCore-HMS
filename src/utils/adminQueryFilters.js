/**
 * Read only the filter keys owned by an admin list page from its URL state.
 * Unknown context parameters (for example patientId) remain in the URL/API
 * request but do not leak into the page's controlled filter form.
 */
export function readAdminFilterState(searchParams, keys) {
  return Object.fromEntries(keys.map((key) => [key, searchParams.get(key) || ""]));
}
