import assert from "assert";
import { paginateQueueItems } from "../services/operationsQueuePagination.js";

const items = Array.from({ length: 125 }, (_, i) => ({ id: `op-${i}` }));

// ── Defaults ──────────────────────────────────────────────────────────
{
  const { pageItems, pagination } = paginateQueueItems(items, undefined, undefined);
  assert.strictEqual(pageItems.length, 50, "default page size should be 50");
  assert.deepStrictEqual(pagination, { page: 1, pageSize: 50, total: 125, totalPages: 3 });
  assert.strictEqual(pageItems[0].id, "op-0");
  console.log("PASS: default page/pageSize returns page 1 of 50 with correct totals");
}

// ── Explicit page ─────────────────────────────────────────────────────
{
  const { pageItems, pagination } = paginateQueueItems(items, 2, 50);
  assert.strictEqual(pageItems.length, 50);
  assert.strictEqual(pageItems[0].id, "op-50");
  assert.strictEqual(pagination.page, 2);
  console.log("PASS: page 2 starts at the correct offset");
}

// ── Last (partial) page ──────────────────────────────────────────────
{
  const { pageItems, pagination } = paginateQueueItems(items, 3, 50);
  assert.strictEqual(pageItems.length, 25, "last page should contain the remainder, not pad or crash");
  assert.strictEqual(pagination.totalPages, 3);
  console.log("PASS: partial final page returns exactly the remainder");
}

// ── Page beyond range clamps instead of returning empty/erroring ──────
{
  const { pageItems, pagination } = paginateQueueItems(items, 99, 50);
  assert.strictEqual(pagination.page, 3, "out-of-range page should clamp to the last valid page");
  assert.strictEqual(pageItems.length, 25);
  console.log("PASS: out-of-range page clamps to last valid page instead of erroring or going blank");
}

// ── Invalid / hostile input never crashes and never trusts the client blindly ──
{
  const cases = [
    [items, 0, 50],
    [items, -5, 50],
    [items, "not-a-number", 50],
    [items, 1, -10],
    [items, 1, "abc"],
    [items, 1, 0],
  ];
  for (const [list, page, pageSize] of cases) {
    const { pageItems, pagination } = paginateQueueItems(list, page, pageSize);
    assert.ok(pagination.page >= 1, "page must never be < 1");
    assert.ok(pagination.pageSize >= 1, "pageSize must never be < 1");
    assert.ok(pageItems.length <= pagination.pageSize);
  }
  console.log("PASS: invalid/hostile page & pageSize inputs never crash and always normalize to safe values");
}

// ── Server-defined max page size is enforced (Rule #16: pagination has a maximum) ──
{
  const { pagination } = paginateQueueItems(items, 1, 100000);
  assert.strictEqual(pagination.pageSize, 200, "pageSize must be capped at the server-defined maximum");
  console.log("PASS: pageSize is capped at the server-defined maximum (200), not trusted from the client");
}

// ── Empty list never errors ──────────────────────────────────────────
{
  const { pageItems, pagination } = paginateQueueItems([], 1, 50);
  assert.strictEqual(pageItems.length, 0);
  assert.strictEqual(pagination.totalPages, 1, "an empty list should still report 1 total page, not 0");
  console.log("PASS: empty item list produces a valid, non-crashing pagination object");
}

console.log("\nAll operationsQueuePagination tests passed.");
