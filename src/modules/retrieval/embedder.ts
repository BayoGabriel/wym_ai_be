import { db } from '../../database/client';
import { knowledgeChunks } from '../../database/schema/core';
import { and, eq, isNull, or } from 'drizzle-orm';
import { getEmbeddingProvider } from './embedding';
import { recordAudit } from '../audit/service';

export async function embedMissingForItem(params: {
  organizationId: string;
  itemId: string;
  actorUserId: string;
}) {
  const { organizationId, itemId, actorUserId } = params;
  const provider = getEmbeddingProvider();

  const rows = await db
    .select({ id: knowledgeChunks.id, content: knowledgeChunks.content })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.organizationId, organizationId),
        eq(knowledgeChunks.knowledgeItemId, itemId),
        or(
          isNull(knowledgeChunks.embeddingStatus),
          eq(knowledgeChunks.embeddingStatus as any, 'PENDING')
        )
      )
    );

  if (rows.length === 0) return { embedded: 0 };

  const embeddings = await provider.generateEmbeddings(rows.map((r) => r.content));
  for (let i = 0; i < rows.length; i++) {
    const e = embeddings[i];
    await db
      .update(knowledgeChunks)
      .set({
        embedding: JSON.stringify(e),
        embeddingStatus: 'COMPLETED' as any,
        embeddingError: null as any,
        embeddingModel: provider.model,
        embeddingDim: provider.dimensions,
      })
      .where(eq(knowledgeChunks.id, rows[i].id));
  }

  await recordAudit({
    organizationId,
    actorUserId,
    action: 'knowledge.embedding.completed',
    resourceType: 'knowledge_item',
    resourceId: itemId,
  });
  return { embedded: rows.length };
}
