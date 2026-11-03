import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { datasets, insightReports, products, usageRecords } from '../../database/schema/core';
import { ApiError } from '../../middleware/error';
import { recordAudit } from '../audit/service';
import { getLLMProvider } from '../ai/provider';
import { analyzeTable, Analysis, profileTable } from './analysis';
import { parseCsv, parseXlsx, ParsedTable } from './parser';

const MAX_ROWS_KEPT = 5000;

type DatasetRow = typeof datasets.$inferSelect;
type ReportRow = typeof insightReports.$inferSelect;

async function recordInsightUsage(organizationId: string, eventType: string, quantity = 1) {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.code, 'WYMINSIGHT'))
      .limit(1);
    await db.insert(usageRecords).values({
      organizationId,
      productId: product?.id ?? null,
      eventType,
      quantity,
    });
  } catch {
    /* usage recording must not break the feature */
  }
}

export function mapDataset(d: DatasetRow, includeRows = false) {
  return {
    id: d.id,
    name: d.name,
    filename: d.filename,
    format: d.format,
    status: d.status,
    rowCount: d.rowCount,
    profile: d.profile ?? null,
    error: d.error ?? null,
    createdAt: d.createdAt,
    ...(includeRows ? { rows: d.rows } : {}),
  };
}

export function mapReport(r: ReportRow) {
  return {
    id: r.id,
    datasetId: r.datasetId,
    title: r.title,
    analysis: r.analysis,
    summary: r.summary,
    createdAt: r.createdAt,
  };
}

export async function uploadDataset(params: {
  organizationId: string;
  userId: string;
  name: string;
  filename: string;
  contentBase64: string;
}) {
  const buffer = Buffer.from(params.contentBase64, 'base64');
  if (buffer.length > 8 * 1024 * 1024) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'File exceeds the 8MB limit');
  }
  const lower = params.filename.toLowerCase();
  const format = lower.endsWith('.xlsx') ? 'xlsx' : lower.endsWith('.csv') ? 'csv' : null;
  if (!format) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Only .csv and .xlsx files are supported');
  }

  let table: ParsedTable;
  try {
    table = format === 'csv' ? parseCsv(buffer.toString('utf8')) : await parseXlsx(buffer);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, 'VALIDATION_ERROR', 'Could not parse the uploaded file');
  }
  if (table.rows.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The file contains no data rows');
  }

  const trimmed: ParsedTable = {
    headers: table.headers,
    rows: table.rows.slice(0, MAX_ROWS_KEPT),
  };

  const [dataset] = await db
    .insert(datasets)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      filename: params.filename,
      format,
      status: 'PROCESSED',
      rowCount: trimmed.rows.length,
      profile: profileTable(trimmed),
      rows: trimmed.rows,
    })
    .returning();

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'insight.dataset.uploaded',
    resourceType: 'dataset',
    resourceId: dataset.id,
    metadata: { filename: params.filename, format, rowCount: trimmed.rows.length },
  });
  await recordInsightUsage(params.organizationId, 'dataset_uploaded');
  return dataset;
}

export async function listDatasets(params: {
  organizationId: string;
  page: number;
  limit: number;
}) {
  const where = eq(datasets.organizationId, params.organizationId);
  const rows = await db
    .select()
    .from(datasets)
    .where(where)
    .orderBy(desc(datasets.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);
  const [totalRow] = await db.select({ value: count() }).from(datasets).where(where);
  return { items: rows.map((d) => mapDataset(d)), total: totalRow?.value ?? 0 };
}

export async function getDataset(params: { organizationId: string; datasetId: string }) {
  const [d] = await db
    .select()
    .from(datasets)
    .where(
      and(eq(datasets.id, params.datasetId), eq(datasets.organizationId, params.organizationId))
    )
    .limit(1);
  if (!d) throw new ApiError(404, 'NOT_FOUND', 'Dataset not found');
  return d;
}

export async function deleteDataset(params: {
  organizationId: string;
  datasetId: string;
  userId: string;
}) {
  const d = await getDataset(params);
  await db
    .delete(insightReports)
    .where(
      and(
        eq(insightReports.datasetId, d.id),
        eq(insightReports.organizationId, params.organizationId)
      )
    );
  await db
    .delete(datasets)
    .where(and(eq(datasets.id, d.id), eq(datasets.organizationId, params.organizationId)));
  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'insight.dataset.deleted',
    resourceType: 'dataset',
    resourceId: d.id,
  });
}

const SUMMARY_SYSTEM =
  'You are an analyst writing a concise executive summary of a business dataset profile. ' +
  'Report only what the statistics support: key figures, notable trends, and 2-3 practical ' +
  'observations or opportunities. Do not invent figures. Use short paragraphs.';

async function generateExecutiveSummary(analysis: Analysis): Promise<string> {
  try {
    const provider = getLLMProvider();
    const res = await provider.generate({
      system: SUMMARY_SYSTEM,
      context: analysis.summaryInput,
      message: 'Write the executive summary for this dataset.',
      maxTokens: 512,
    });
    return res.text.trim() || fallbackSummary(analysis);
  } catch {
    return fallbackSummary(analysis);
  }
}

function fallbackSummary(a: Analysis): string {
  const parts = [`The dataset contains ${a.rowCount} rows across ${a.columns.length} columns.`];
  for (const t of a.trends.slice(0, 2)) {
    parts.push(
      `${t.valueColumn} is trending ${t.direction} over time (${t.growthPct ?? 'n/a'}% change across the period).`
    );
  }
  const cat = a.columns.find((c) => c.topValues?.length);
  if (cat?.topValues?.[0]) {
    parts.push(`The most common ${cat.name} is "${cat.topValues[0].value}".`);
  }
  return parts.join(' ');
}

export async function analyzeDataset(params: {
  organizationId: string;
  datasetId: string;
  userId: string;
}) {
  const d = await getDataset({
    organizationId: params.organizationId,
    datasetId: params.datasetId,
  });
  const rows = (d.rows as Record<string, string>[] | null) ?? [];
  if (!rows.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Dataset has no stored rows to analyze');
  }
  const analysis = analyzeTable({ headers: Object.keys(rows[0]), rows });
  const summary = await generateExecutiveSummary(analysis);
  const [report] = await db
    .insert(insightReports)
    .values({
      organizationId: params.organizationId,
      datasetId: d.id,
      title: `Analysis of ${d.name}`,
      analysis: {
        rowCount: analysis.rowCount,
        columns: analysis.columns,
        kpis: analysis.kpis,
        trends: analysis.trends,
      },
      summary,
      createdBy: params.userId,
    })
    .returning();
  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'insight.report.generated',
    resourceType: 'insight_report',
    resourceId: report.id,
    metadata: { datasetId: d.id },
  });
  await recordInsightUsage(params.organizationId, 'analysis_run');
  return report;
}

export async function listReports(params: {
  organizationId: string;
  datasetId?: string;
  page: number;
  limit: number;
}) {
  const where = params.datasetId
    ? and(
        eq(insightReports.organizationId, params.organizationId),
        eq(insightReports.datasetId, params.datasetId)
      )
    : eq(insightReports.organizationId, params.organizationId);
  const rows = await db
    .select()
    .from(insightReports)
    .where(where)
    .orderBy(desc(insightReports.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);
  const [totalRow] = await db.select({ value: count() }).from(insightReports).where(where);
  return { items: rows.map(mapReport), total: totalRow?.value ?? 0 };
}

export async function getReport(params: { organizationId: string; reportId: string }) {
  const [r] = await db
    .select()
    .from(insightReports)
    .where(
      and(
        eq(insightReports.id, params.reportId),
        eq(insightReports.organizationId, params.organizationId)
      )
    )
    .limit(1);
  if (!r) throw new ApiError(404, 'NOT_FOUND', 'Report not found');
  return r;
}

// CSV export of a report's headline figures — the "downloadable report" deliverable.
export function reportToCsv(report: ReportRow): string {
  const a = report.analysis as Analysis | null;
  const lines: string[] = [
    `# ${report.title}`,
    `# Generated ${report.createdAt.toISOString()}`,
    '',
  ];
  if (a?.kpis?.length) {
    lines.push('KPI,Value');
    for (const k of a.kpis) lines.push(`${csvCell(k.label)},${csvCell(k.value)}`);
    lines.push('');
  }
  if (a?.columns?.length) {
    lines.push('Column,Type,Distinct,Nulls,Min,Max,Mean,Sum');
    for (const c of a.columns) {
      lines.push(
        [
          csvCell(c.name),
          c.type,
          c.distinct,
          c.nulls,
          c.min ?? '',
          c.max ?? '',
          c.mean?.toFixed(2) ?? '',
          c.sum?.toFixed(2) ?? '',
        ].join(',')
      );
    }
    lines.push('');
  }
  for (const t of a?.trends ?? []) {
    lines.push(`Trend,${csvCell(t.valueColumn)} by ${csvCell(t.dateColumn)} (${t.direction})`);
    lines.push('Period,Total');
    for (const p of t.points) lines.push(`${p.period},${p.total}`);
    lines.push('Period,Forecast');
    for (const f of t.forecast) lines.push(`${f.period},${f.predicted}`);
    lines.push('');
  }
  if (report.summary) {
    lines.push('Summary', csvCell(report.summary.replace(/\n/g, ' ')));
  }
  return lines.join('\n');
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
