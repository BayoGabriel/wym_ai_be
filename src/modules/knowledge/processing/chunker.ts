import { env } from '../../../config/env';

export type Chunk = { index: number; content: string };

export function chunkText(
  text: string,
  size = env.KNOWLEDGE_CHUNK_SIZE,
  overlap = env.KNOWLEDGE_CHUNK_OVERLAP
): Chunk[] {
  const normalized = text || '';
  if (!normalized.trim()) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let idx = 0;
  while (start < normalized.length) {
    const end = Math.min(start + size, normalized.length);
    const slice = normalized.slice(start, end);
    chunks.push({ index: idx++, content: slice });
    if (end === normalized.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }
  return chunks;
}
