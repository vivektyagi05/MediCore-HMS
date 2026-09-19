import assert from "assert";
import { clampPagination, buildPaginationMeta, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../utils/paginationValidation.js";

// ── Defaults ──────────────────────────────────────────────────────────
{
  const { page, pageSize, skip } = clampPagination(undefined, undefined);
  assert.strictEqual(page, 1);
  assert.strictEqual(pageSize, DEFAULT_PAGE_SIZE);
  assert.strictEqual(skip, 0);
  console.log("PASS: missing page/pageSize default to page 1 / DEFAULT_PAGE_SIZE with skip 0");
}

// ── Explicit valid page ──────────────────────────────────────────────
{
  const { page, pageSize, skip } = clampPagination(3, 10);
  assert.strictEqual(page, 3);
  assert.strictEqual(pageSize, 10);
  assert.strictEqual(skip, 20, "skip should be (page-1)*pageSize");
  console.log("PASS: explicit valid page/pageSize compute the correct skip");
}

// ── Hostile input never crashes and never trusts the client blindly ───
{
  const cases = [
    ["not-a-number", 50],
    [-5, 50],
    [0, 50],
    [Infinity, 50],
    [NaN, 50],
    [1, "abc"],
    [1, -10],
    [1, 0],
    [1, Infinity],
    [1, NaN],
  ];
  for (const [rawPage, rawPageSize] of cases) {
    const { page, pageSize, skip } = clampPagination(rawPage, rawPageSize);
    assert.ok(Number.isFinite(page) && page >= 1, `page must always be a finite integer >= 1 (got ${page} for input ${rawPage})`);
    assert.ok(Number.isFinite(pageSize) && pageSize >= 1, `pageSize must always be a finite integer >= 1 (got ${pageSize} for input ${rawPageSize})`);
    assert.ok(Number.isFinite(skip) && skip >= 0, "skip must always be a finite non-negative integer");
  }
  console.log("PASS: invalid/hostile page & pageSize inputs never crash and always normalize to safe values");
}

// ── Server-defined max page size is enforced ───────────────────────────
{
  const { pageSize } = clampPagination(1, 999999999);
  assert.strictEqual(pageSize, MAX_PAGE_SIZE, "pageSize must be capped at the server-defined maximum, never trusted from the client");
  console.log("PASS: pageSize is capped at the server-defined maximum, not trusted from the client");
}

// ── page is clamped against a known total, not left to overshoot ──────
{
  const { page } = clampPagination(999, 10, { total: 25 });
  assert.strictEqual(page, 3, "requesting a page far beyond the last real page should clamp to the last valid page (25 items / 10 per page = 3 pages)");
  console.log("PASS: page is clamped to the last valid page when total is known");
}

// ── buildPaginationMeta ────────────────────────────────────────────────
{
  const meta = buildPaginationMeta(2, 10, 25);
  assert.deepStrictEqual(meta, { page: 2, pageSize: 10, total: 25, totalPages: 3, hasNext: true, hasPrevious: true });
  console.log("PASS: buildPaginationMeta computes totalPages/hasNext/hasPrevious correctly");
}

// ── buildPaginationMeta on an empty collection never reports 0 pages ──
{
  const meta = buildPaginationMeta(1, 10, 0);
  assert.strictEqual(meta.totalPages, 1, "an empty collection should still report 1 total page, not 0");
  assert.strictEqual(meta.hasNext, false);
  assert.strictEqual(meta.hasPrevious, false);
  console.log("PASS: empty collection produces a valid, non-crashing pagination meta object");
}

console.log("\nAll paginationValidation tests passed.");
