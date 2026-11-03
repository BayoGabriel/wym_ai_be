import { db } from '../../database/client';
import { knowledgeChunks, knowledgeItems } from '../../database/schema/core';
import { and, desc, eq } from 'drizzle-orm';
import { getEmbeddingProvider } from './embedding';
import { env } from '../../config/env';

export type RetrievalFilters = {
  sourceType?: 'TEXT' | 'PDF';
  category?: 'FAQ' | 'EVENTS' | 'FEATURES' | 'GENERAL';
  knowledgeStatus?: 'ACTIVE';
};

export type RetrievalParams = {
  organizationId: string;
  query: string;
  topK?: number;
  minScore?: number; // cosine similarity threshold 0..1 (approx for local provider)
  filters?: RetrievalFilters;
};

export async function retrieveRelevantKnowledge(params: RetrievalParams) {
  const provider = getEmbeddingProvider();
  const topK = params.topK ?? env.RETRIEVAL_TOPK;
  const minScore = params.minScore ?? env.RETRIEVAL_MIN_SCORE;
  const qEmb = await provider.generateEmbedding(params.query || '');

  // For LOCAL provider with JSON embeddings, compute cosine similarity in TS after fetching candidate rows
  // Scope by org and ACTIVE knowledge status
  const rows = await db
    .select({
      id: knowledgeChunks.id,
      orgId: knowledgeChunks.organizationId,
      itemId: knowledgeChunks.knowledgeItemId,
      content: knowledgeChunks.content,
      meta: knowledgeChunks.metadata,
      embedding: knowledgeChunks.embedding,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeItems, eq(knowledgeItems.id, knowledgeChunks.knowledgeItemId))
    .where(
      and(
        eq(knowledgeChunks.organizationId, params.organizationId),
        eq(knowledgeItems.status, 'ACTIVE')
      )
    )
    .orderBy(desc(knowledgeChunks.createdAt))
    .limit(200); // small candidate cap

  const withScores = rows
    .map((r) => {
      const e = r.embedding ? (JSON.parse(r.embedding) as number[]) : null;
      const score = e ? cosine(qEmb, e) : 0;
      return { ...r, score };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => ({
      chunkId: r.id,
      knowledgeItemId: r.itemId,
      content: r.content,
      score: r.score,
      metadata: safeParseMeta(r.meta),
    }));

  return { results: withScores };
}

function cosine(a: number[], b: number[]) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}

function safeParseMeta(m: unknown): Record<string, unknown> | undefined {
  if (!m) return undefined;
  try {
    if (typeof m === 'string') return JSON.parse(m) as Record<string, unknown>;
    if (typeof m === 'object') return m as Record<string, unknown>;
    return undefined;
  } catch {
    return undefined;
  }
}
