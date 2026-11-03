import type { ParsedTable } from './parser';

export type ColumnProfile = {
  name: string;
  type: 'number' | 'date' | 'boolean' | 'text';
  nonNull: number;
  nulls: number;
  distinct: number;
  // numeric columns
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
  // categorical columns (top 5)
  topValues?: { value: string; count: number }[];
};

export type Trend = {
  dateColumn: string;
  valueColumn: string;
  points: { period: string; total: number }[];
  direction: 'up' | 'down' | 'flat';
  growthPct: number | null;
  forecast: { period: string; predicted: number }[];
};

export type Analysis = {
  rowCount: number;
  columns: ColumnProfile[];
  kpis: { label: string; value: string }[];
  trends: Trend[];
  summaryInput: string;
};

const DATE_RE = /^\d{4}-\d{2}(-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?)?$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;

function detectType(values: string[]): ColumnProfile['type'] {
  const sample = values.filter((v) => v !== '').slice(0, 200);
  if (!sample.length) return 'text';
  const numeric = sample.filter((v) => NUM_RE.test(v.replace(/,/g, ''))).length;
  const dates = sample.filter((v) => DATE_RE.test(v)).length;
  const bools = sample.filter((v) => /^(true|false|yes|no)$/i.test(v)).length;
  if (numeric / sample.length >= 0.8) return 'number';
  if (dates / sample.length >= 0.8) return 'date';
  if (bools / sample.length >= 0.8) return 'boolean';
  return 'text';
}

function num(v: string): number | null {
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function profileTable(table: ParsedTable): ColumnProfile[] {
  return table.headers.map((name) => {
    const values = table.rows.map((r) => String(r[name] ?? '').trim());
    const present = values.filter((v) => v !== '');
    const type = detectType(values);
    const base: ColumnProfile = {
      name,
      type,
      nonNull: present.length,
      nulls: values.length - present.length,
      distinct: new Set(present).size,
    };
    if (type === 'number') {
      const nums = present.map(num).filter((n): n is number => n !== null);
      if (nums.length) {
        base.min = Math.min(...nums);
        base.max = Math.max(...nums);
        base.sum = nums.reduce((a, b) => a + b, 0);
        base.mean = base.sum / nums.length;
      }
    }
    if (type === 'text' || type === 'boolean') {
      const counts = new Map<string, number>();
      for (const v of present) counts.set(v, (counts.get(v) ?? 0) + 1);
      base.topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
    }
    return base;
  });
}

// Monthly aggregation + least-squares linear trend + 3-period forecast.
export function detectTrends(table: ParsedTable, columns: ColumnProfile[]): Trend[] {
  const dateCols = columns.filter((c) => c.type === 'date');
  const numCols = columns.filter((c) => c.type === 'number');
  const trends: Trend[] = [];
  for (const dc of dateCols.slice(0, 2)) {
    for (const nc of numCols.slice(0, 3)) {
      const buckets = new Map<string, number>();
      for (const r of table.rows) {
        const raw = String(r[dc.name] ?? '');
        if (!raw) continue;
        const period = raw.slice(0, 7); // YYYY-MM
        const v = num(String(r[nc.name] ?? ''));
        if (v === null) continue;
        buckets.set(period, (buckets.get(period) ?? 0) + v);
      }
      if (buckets.size < 3) continue;
      const points = [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, total]) => ({ period, total: Math.round(total * 100) / 100 }));
      const n = points.length;
      const xs = points.map((_, i) => i);
      const ys = points.map((p) => p.total);
      const xBar = xs.reduce((a, b) => a + b, 0) / n;
      const yBar = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i] - xBar) * (ys[i] - yBar);
        sxx += (xs[i] - xBar) ** 2;
      }
      const slope = sxx === 0 ? 0 : sxy / sxx;
      const intercept = yBar - slope * xBar;
      const first = ys[0];
      const last = ys[ys.length - 1];
      const growthPct =
        first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : null;
      const direction: Trend['direction'] =
        growthPct === null ? 'flat' : growthPct > 5 ? 'up' : growthPct < -5 ? 'down' : 'flat';
      const forecast = [0, 1, 2].map((k) => {
        const [y, m] = points[points.length - 1].period.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 + k + 1, 1));
        return {
          period: d.toISOString().slice(0, 7),
          predicted: Math.round((intercept + slope * (n + k)) * 100) / 100,
        };
      });
      trends.push({
        dateColumn: dc.name,
        valueColumn: nc.name,
        points,
        direction,
        growthPct,
        forecast,
      });
      if (trends.length >= 3) return trends;
    }
  }
  return trends;
}

export function analyzeTable(table: ParsedTable): Analysis {
  const columns = profileTable(table);
  const trends = detectTrends(table, columns);
  const kpis: { label: string; value: string }[] = [
    { label: 'Rows', value: String(table.rows.length) },
  ];
  for (const c of columns.filter((c) => c.type === 'number').slice(0, 4)) {
    kpis.push({
      label: `Total ${c.name}`,
      value: (c.sum ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
    });
  }
  const cat = columns.find((c) => c.topValues?.length);
  if (cat?.topValues?.[0]) {
    kpis.push({
      label: `Top ${cat.name}`,
      value: `${cat.topValues[0].value} (${cat.topValues[0].count})`,
    });
  }
  // Compact, bounded context for the LLM summary — never raw PII-heavy rows.
  const summaryInput = [
    `Dataset: ${table.rows.length} rows, ${columns.length} columns.`,
    ...columns.map((c) => {
      if (c.type === 'number') {
        return `${c.name}: numeric, sum=${c.sum?.toFixed(2)}, mean=${c.mean?.toFixed(2)}, range ${c.min}–${c.max}`;
      }
      const top = c.topValues?.map((t) => `${t.value}(${t.count})`).join(', ');
      return `${c.name}: ${c.type}, ${c.distinct} distinct${top ? `, top: ${top}` : ''}`;
    }),
    ...trends.map(
      (t) =>
        `Trend ${t.valueColumn} by ${t.dateColumn}: ${t.direction}, growth ${t.growthPct ?? 'n/a'}%, forecast: ${t.forecast.map((f) => `${f.period}=${f.predicted}`).join(', ')}`
    ),
  ].join('\n');
  return { rowCount: table.rows.length, columns, kpis, trends, summaryInput };
}
