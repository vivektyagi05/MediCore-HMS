// LoadingSkeleton primitive (kept as default export `Skeleton` — the one
// existing call site, AdminDashboard.jsx, already imports it by that name;
// renaming the export isn't worth a churn-only edit to that file).
function Skeleton({ rows = 3 }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="skeleton-shimmer h-4 rounded-control"
          style={{ width: `${92 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

export default Skeleton;
