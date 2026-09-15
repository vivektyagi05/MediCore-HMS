// Small, dependency-free SVG graph renderer for the Process Orchestrator
// and Integration Hub pages — same posture as FinanceCharts.jsx (no
// charting/graph library in package.json, and this is simple enough not to
// justify adding one). Layout is a deterministic layered DAG: nodes with no
// incoming dependency start at column 0, every other node sits one column
// to the right of its deepest prerequisite. Edges are drawn as straight
// lines between column centers.

function computeLayers(nodes, edges) {
  const nodeIds = nodes.map((n) => n.id);
  const incoming = {};
  nodeIds.forEach((id) => (incoming[id] = []));
  edges.forEach((e) => {
    if (incoming[e.to]) incoming[e.to].push(e.from);
  });

  const depth = {};
  const visiting = new Set();
  function depthOf(id) {
    if (depth[id] !== undefined) return depth[id];
    if (visiting.has(id)) return 0; // guard against any unexpected cycle
    visiting.add(id);
    const deps = incoming[id] || [];
    const d = deps.length ? 1 + Math.max(...deps.map((dep) => depthOf(dep))) : 0;
    visiting.delete(id);
    depth[id] = d;
    return d;
  }
  nodeIds.forEach(depthOf);

  const maxDepth = Math.max(0, ...Object.values(depth));
  const columns = Array.from({ length: maxDepth + 1 }, () => []);
  nodes.forEach((n) => columns[depth[n.id]].push(n));
  return columns;
}

function toneForStatus(status) {
  if (status === "at_risk" || status === "critical") return "#e11d48";
  if (status === "degraded" || status === "high") return "#f59e0b";
  if (status === "healthy") return "#10b981";
  return "#64748b";
}

function DependencyGraphSvg({ nodes = [], edges = [], onNodeClick, selectedId, height = 420 }) {
  if (!nodes.length) {
    return <p className="text-sm font-semibold text-slate-400">No graph data yet.</p>;
  }

  const columns = computeLayers(nodes, edges);
  const colWidth = 220;
  const rowHeight = 64;
  const width = Math.max(columns.length * colWidth, 320);
  const svgHeight = Math.max(...columns.map((c) => c.length), 1) * rowHeight + 40;

  const positions = {};
  columns.forEach((col, colIndex) => {
    col.forEach((node, rowIndex) => {
      positions[node.id] = { x: colIndex * colWidth + colWidth / 2, y: rowIndex * rowHeight + 40 };
    });
  });

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${svgHeight}`} width="100%" height={Math.min(svgHeight, height)} className="min-w-[320px]">
        {edges.map((edge) => {
          const from = positions[edge.from];
          const to = positions[edge.to];
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x + 70}
              y1={from.y}
              x2={to.x - 70}
              y2={to.y}
              stroke="#cbd5e1"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
          </marker>
        </defs>
        {nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const isSelected = selectedId === node.id;
          const tone = toneForStatus(node.status || node.health?.status);
          return (
            <g
              key={node.id}
              transform={`translate(${pos.x - 70}, ${pos.y - 18})`}
              className={onNodeClick ? "cursor-pointer" : ""}
              onClick={onNodeClick ? () => onNodeClick(node) : undefined}
            >
              <rect
                width={140}
                height={36}
                rx={10}
                fill={isSelected ? "#1d4ed8" : "#ffffff"}
                stroke={isSelected ? "#1d4ed8" : "#e2e8f0"}
                strokeWidth={1.5}
              />
              <circle cx={14} cy={18} r={4} fill={tone} />
              <text x={24} y={22} fontSize={10} fontWeight={700} fill={isSelected ? "#ffffff" : "#0f172a"}>
                {(node.label || node.id).slice(0, 16)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default DependencyGraphSvg;
