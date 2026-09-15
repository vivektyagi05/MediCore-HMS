import { memo } from "react";
import EmptyState from "../shared/EmptyState";

// Shared DataTable primitive (kept as default export `AdminTable` — its
// existing name across every admin page consumer; renaming the export
// isn't worth a churn-only edit to every import site). Styling only was
// touched here: solid clinical surfaces and tokenized radius/border
// instead of the glassmorphism panel it used to be. Column contract,
// loading/empty behavior, and row rendering are unchanged.
function AdminTable({
  columns,
  data,
  rowKey = "_id",
  isLoading = false,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  // Optional, opt-in only (every existing consumer omits this and is
  // visually unaffected) — added for Smart Inbox deep-link highlighting
  // (Phase DOC-02). Ref is attached to the highlighted row so the caller
  // can scrollIntoView it.
  highlightRowId,
  highlightedRowRef,
}) {
  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading table">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="skeleton-shimmer h-14 rounded-card" />
        ))}
      </div>
    );
  }

  if (!data.length) {
    return (
      <EmptyState
        title={emptyTitle || "No records found"}
        description={emptyDescription || "Try adjusting filters or create a new record."}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-3 font-bold">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {data.map((row) => (
            <tr
              key={row[rowKey]}
              ref={highlightRowId && row[rowKey] === highlightRowId ? highlightedRowRef : null}
              className={`transition duration-150 hover:bg-slate-50 ${highlightRowId && row[rowKey] === highlightRowId ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : ""}`}
            >
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-4 font-semibold text-slate-700">
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(AdminTable);
