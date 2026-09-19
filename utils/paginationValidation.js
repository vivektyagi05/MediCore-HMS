// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-13 hardening — shared pagination input validation.
//
// Every list endpoint that queries a potentially large collection
// (Automation Studio flows, Process Registry, Process Governance
// approval queue / compliance matrix) must clamp page/pageSize
// server-side rather than trusting whatever the client sends — a
// negative page, a zero/NaN/Infinity pageSize, or an absurdly large
// pageSize (e.g. 999999999) must never reach a DB query or an
// in-memory slice unbounded.
//
// Deliberately dependency-free (no model imports, no DB) so it can be
// regression-tested in isolation — same pattern as
// operationsQueuePagination.js (Phase UI-10) and reviewAdminAggregates.js.
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Clamp raw (untrusted, possibly string/NaN/negative/Infinity/missing)
 * page + pageSize query params into safe integers, and derive the Mongo
 * `skip` value for them. `total` is optional — when supplied, `page` is
 * also clamped so it never exceeds the last real page.
 */
export function clampPagination(rawPage, rawPageSize, { defaultPageSize = DEFAULT_PAGE_SIZE, maxPageSize = MAX_PAGE_SIZE, total } = {}) {
  let pageSize = Number.parseInt(rawPageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultPageSize;
  pageSize = Math.min(pageSize, maxPageSize);

  let page = Number.parseInt(rawPage, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  if (Number.isFinite(total)) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(page, totalPages);
  }

  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}

/** Standard pagination meta block for a list response. */
export function buildPaginationMeta(page, pageSize, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}
