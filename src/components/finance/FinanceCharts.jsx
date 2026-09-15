// Small, dependency-free SVG charts for the Patient Financial Ecosystem.
// The project has no charting library installed (recharts/chart.js/etc are
// not in package.json), and these visuals are simple enough not to justify
// adding one — a handful of bars/lines/donut segments rendered as plain SVG.

function MiniBarChart({ data = [], valueKey = "totalAmount", labelKey = "month", height = 160, formatValue, barClassName = "fill-blue-500" }) {
  if (!data.length) {
    return <p className="text-sm font-semibold text-slate-400">No data yet for this period.</p>;
  }

  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  const barWidth = 100 / data.length;

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-40 w-full overflow-visible" role="img" aria-label={`${labelKey} chart`}>
        {data.map((entry, index) => {
          const value = Number(entry[valueKey]) || 0;
          const barHeight = (value / max) * (height - 24);
          const x = index * barWidth + barWidth * 0.15;
          const width = barWidth * 0.7;
          const displayValue = formatValue ? formatValue(value) : value;
          return (
            <g key={entry[labelKey] || index}>
              <rect
                x={x}
                y={height - 24 - barHeight}
                width={width}
                height={Math.max(barHeight, 1)}
                rx={2}
                className={barClassName}
              >
                <title>{`${entry[labelKey]}: ${displayValue}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between gap-1">
        {data.map((entry, index) => (
          <div key={entry[labelKey] || index} className="flex-1 text-center">
            <p className="truncate text-[10px] font-bold text-slate-400">{entry[labelKey]}</p>
            <p className="truncate text-[11px] font-black text-slate-700">
              {formatValue ? formatValue(entry[valueKey]) : entry[valueKey]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniDonut({ segments = [], size = 140, thickness = 16 }) {
  const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
  if (!total) {
    return <p className="text-sm font-semibold text-slate-400">No data yet.</p>;
  }

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  const segmentsWithOffset = segments.reduce((acc, segment) => {
    const fraction = (Number(segment.value) || 0) / total;
    const dash = fraction * circumference;
    const previousOffset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    return [...acc, { ...segment, dash, offset: previousOffset }];
  }, []);

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={thickness} />
        {segmentsWithOffset.map((segment) => (
          <circle
            key={segment.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={segment.color || "#2563eb"}
            strokeWidth={thickness}
            strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
            strokeDashoffset={-segment.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="space-y-2">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color || "#2563eb" }} />
            {segment.label}
            <span className="text-slate-400">{Math.round(((Number(segment.value) || 0) / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniLineChart({ data = [], creditKey = "credit", debitKey = "debit", labelKey = "month", height = 160 }) {
  if (!data.length) {
    return <p className="text-sm font-semibold text-slate-400">No transactions yet for this period.</p>;
  }

  const max = Math.max(...data.map((d) => Math.max(Number(d[creditKey]) || 0, Number(d[debitKey]) || 0)), 1);
  const stepX = 100 / Math.max(data.length - 1, 1);

  const toPoints = (key) =>
    data
      .map((entry, index) => {
        const x = index * stepX;
        const y = height - 24 - ((Number(entry[key]) || 0) / max) * (height - 24);
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-40 w-full overflow-visible">
        <polyline points={toPoints(creditKey)} fill="none" stroke="#059669" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <polyline points={toPoints(debitKey)} fill="none" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex justify-between gap-1">
        {data.map((entry, index) => (
          <p key={entry[labelKey] || index} className="flex-1 truncate text-center text-[10px] font-bold text-slate-400">
            {entry[labelKey]}
          </p>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs font-bold text-slate-600">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Credits</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-600" /> Debits</span>
      </div>
    </div>
  );
}

export { MiniBarChart, MiniDonut, MiniLineChart };
