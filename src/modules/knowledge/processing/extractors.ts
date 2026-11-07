import mammoth from 'mammoth';
import { extractTextFromPdf } from './pdf-extractor';

export type Extracted = { text: string; meta?: Record<string, unknown> };

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  DOCX_MIME,
  'text/plain',
  'text/csv',
  'application/csv',
] as const;

/** Route a stored document buffer to the right text extractor. */
export async function extractTextFromBuffer(
  buf: Buffer,
  mimeType: string,
  fileName: string
): Promise<Extracted> {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    const data = await extractTextFromPdf(buf);
    return { text: data.text || '' };
  }
  if (mimeType === DOCX_MIME || lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: value || '' };
  }
  if (mimeType === 'text/csv' || mimeType === 'application/csv' || lower.endsWith('.csv')) {
    // Keep rows readable for the chunker: "col: value | col: value" per line.
    const raw = buf.toString('utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { text: raw };
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      return headers.map((h, i) => `${h}: ${cells[i] ?? ''}`).join(' | ');
    });
    return { text: rows.join('\n'), meta: { rows: rows.length } };
  }
  // text/plain and anything else: best-effort UTF-8 decode.
  return { text: buf.toString('utf8') };
}
