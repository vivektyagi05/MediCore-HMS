import { memo } from "react";
import EmptyState from "../shared/EmptyState";

function AdminTable({ columns, data, rowKey = "_id", isLoading = false }) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="skeleton-shimmer h-14 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!data.length) {
    return <EmptyState title="No records found" description="Try adjusting filters or create a new record." />;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/60">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-white/60 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-3 font-black">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white/30">
          {data.map((row) => (
            <tr key={row[rowKey]} className="transition hover:bg-white/60">
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
