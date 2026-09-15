// Phase UI-10 — pagination for the Unified Operations Queue.
//
// buildUnifiedQueue() (operationsAdminController.js) computes counts and
// byDepartment over the FULL filtered set of operations — those are
// legitimate aggregate stats, not the list itself, and must not be
// affected by pagination. Only the `items` array returned to the client
// needs to be capped and sliced, so a platform with thousands of open
// operations never ships an unbounded payload or renders an unbounded
// React list (Phase UI-10 Rule #17).
//
// Deliberately dependency-free (no model imports, no DB) so it can be
// regression-tested in isolation, same pattern as reviewAdminAggregates.js
// and commandCenterHelpers.js.

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function paginateQueueItems(items, rawPage, rawPageSize) {
  let pageSize = Number.parseInt(rawPageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  pageSize = Math.min(pageSize, MAX_PAGE_SIZE);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  let page = Number.parseInt(rawPage, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  page = Math.min(page, totalPages);

  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    pageItems,
    pagination: { page, pageSize, total, totalPages },
  };
}
