import { ApiError } from '../../middleware/error';

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string>[];
};

// RFC-4180-ish CSV: quoted fields, escaped quotes, CRLF handling.
export function parseCsv(text: string): ParsedTable {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);

  if (rows.length < 2) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'CSV must contain a header row and data rows');
  }
  const headers = rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
  return {
    headers,
    rows: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
  };
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedTable> {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Workbook contains no worksheets');
  }
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const cells = r.values as unknown[];
    // exceljs row values are 1-indexed
    const row = cells.slice(1).map((c) => {
      if (c == null) return '';
      if (typeof c === 'object' && 'text' in (c as object)) {
        return String((c as { text: unknown }).text ?? '');
      }
      if (c instanceof Date) return c.toISOString().slice(0, 10);
      return String(c);
    });
    matrix.push(row);
  });
  if (matrix.length < 2) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Spreadsheet must contain a header row and data rows'
    );
  }
  const headers = matrix[0].map((h, i) => String(h).trim() || `column_${i + 1}`);
  return {
    headers,
    rows: matrix
      .slice(1)
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '')]))),
  };
}
