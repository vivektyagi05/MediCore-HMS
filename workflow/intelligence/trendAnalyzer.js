// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Trend Analyzer (brief Step 9's supporting math, factored out so
// capacityForecast/anomalyDetector/bottleneckAnalyzer share ONE trend
// calculation instead of three copies — the brief's own "no duplicated
// calculations" rule for this module set).
//
// Everything here is pure (no DB access) — a real day-bucketed series in,
// a real linear projection out. Never fabricates points for missing days;
// missing days are explicit zeros, same convention the existing rule
// engine (aiInsights.js/predictiveAnalytics.js) already uses.
// ─────────────────────────────────────────────────────────────────────────

export const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

// Buckets a list of {date} documents into a dense (no gaps) daily count
// series covering [since, now]. Dense so a linear-regression slope isn't
// distorted by silently-skipped zero days.
export function buildDailySeries(docs, dateField, since, until = new Date()) {
  const counts = new Map();
  for (const doc of docs) {
    const raw = typeof dateField === "function" ? dateField(doc) : doc[dateField];
    if (!raw) continue;
    const key = dayKey(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const series = [];
  const cursor = new Date(since);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(until);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    const key = dayKey(cursor);
    series.push({ date: key, count: counts.get(key) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

// Ordinary least-squares slope/intercept over index (0..n-1) vs value.
// Returns r2 too, so callers can be honest about how weak a "trend" is on
// noisy/sparse data rather than presenting a slope as gospel.
export function linearTrend(series) {
  const n = series.length;
  if (n < 2) return { slope: 0, intercept: series[0]?.count || 0, r2: 0 };

  const xs = series.map((_, i) => i);
  const ys = series.map((p) => p.count);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, r2 };
}

// Projects the trend forward `steps` days past the end of the series and
// returns a non-negative integer (counts can't go below zero) — used for
// the 1h/24h/7d/30d capacity windows.
export function projectForward(series, steps) {
  const { slope, intercept } = linearTrend(series);
  const projectedIndex = series.length - 1 + steps;
  return Math.max(0, Math.round(slope * projectedIndex + intercept));
}

// z-score of the latest point against the mean/stddev of the preceding
// window — the one statistic anomalyDetector.js needs, kept here so it
// isn't recomputed per-anomaly-type.
export function latestPointZScore(series) {
  if (series.length < 4) return { zScore: 0, mean: 0, stdDev: 0, latest: series.at(-1)?.count || 0 };
  const history = series.slice(0, -1);
  const latest = series.at(-1).count;
  const mean = history.reduce((a, p) => a + p.count, 0) / history.length;
  const variance = history.reduce((a, p) => a + (p.count - mean) ** 2, 0) / history.length;
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev === 0 ? (latest === mean ? 0 : latest > mean ? 3 : -3) : (latest - mean) / stdDev;
  return { zScore, mean, stdDev, latest };
}
