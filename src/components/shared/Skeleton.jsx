function Skeleton({ rows = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="skeleton-shimmer h-4 rounded-xl"
          style={{ width: `${92 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

export default Skeleton;
