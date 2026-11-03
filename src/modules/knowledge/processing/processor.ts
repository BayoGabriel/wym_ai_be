import { db } from '../../../database/client';
import { knowledgeChunks, knowledgeDocuments, knowledgeItems } from '../../../database/schema/core';
import { and, eq } from 'drizzle-orm';
import { normalizeText } from './normalizer';
import { chunkText } from './chunker';
import { readPdf } from '../storage';
import { extractTextFromPdf } from './pdf-extractor';
import { recordAudit } from '../../audit/service';

export async function processKnowledgeItem(params: {
  organizationId: string;
  itemId: string;
  actorUserId: string;
}) {
  const { organizationId, itemId, actorUserId } = params;
  const [item] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.organizationId, organizationId)))
    .limit(1);
  if (!item) throw new Error('Knowledge item not found');

  await db
    .update(knowledgeItems)
    .set({ processingStatus: 'PROCESSING', processingError: null })
    .where(eq(knowledgeItems.id, itemId));
  await recordAudit({
    organizationId,
    actorUserId,
    action: 'knowledge.processing.started',
    resourceType: 'knowledge_item',
    resourceId: itemId,
  });

  try {
    let nextChunkIndex = 0;
    // clear previous chunks first (safe even if we fail later; failed state prevents retrieval using stale chunks)
    await db
      .delete(knowledgeChunks)
      .where(
        and(
          eq(knowledgeChunks.organizationId, organizationId),
          eq(knowledgeChunks.knowledgeItemId, itemId)
        )
      );

    if (item.sourceType === 'TEXT') {
      const sourceText = item.content || '';
      const normalized = normalizeText(sourceText);
      const chunks = chunkText(normalized);
      if (chunks.length > 0) {
        const values = chunks.map((c) => ({
          organizationId,
          knowledgeItemId: itemId,
          content: c.content,
          chunkIndex: nextChunkIndex++,
          metadata: null,
        }));
        await db.insert(knowledgeChunks).values(values);
      }
    } else {
      const [doc] = await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.knowledgeItemId, itemId))
        .limit(1);
      if (!doc) throw new Error('Document metadata missing');
      const buf = await readPdf(doc.storageKey);
      const extracted = await extractTextFromPdf(buf);
      const raw = extracted.text || '';
      if (!raw.trim()) throw new Error('No extractable text in PDF');
      // split pages on form-feed if present, otherwise treat as single page
      const pages = raw.split('\f');
      const values: (typeof knowledgeChunks.$inferInsert)[] = [];
      for (let p = 0; p < pages.length; p++) {
        const normalized = normalizeText(pages[p]);
        const chunks = chunkText(normalized);
        for (const c of chunks) {
          values.push({
            organizationId,
            knowledgeItemId: itemId,
            content: c.content,
            chunkIndex: nextChunkIndex++,
            metadata: JSON.stringify({
              sourceType: 'PDF',
              pageNumber: p + 1,
              filename: doc.originalFilename,
            }),
          });
        }
      }
      if (values.length > 0) await db.insert(knowledgeChunks).values(values);
    }

    await db
      .update(knowledgeItems)
      .set({ processingStatus: 'COMPLETED', processingError: null })
      .where(eq(knowledgeItems.id, itemId));
    await recordAudit({
      organizationId,
      actorUserId,
      action: 'knowledge.processing.completed',
      resourceType: 'knowledge_item',
      resourceId: itemId,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await db
      .update(knowledgeItems)
      .set({ processingStatus: 'FAILED', processingError: errMsg })
      .where(eq(knowledgeItems.id, itemId));
    await recordAudit({
      organizationId,
      actorUserId,
      action: 'knowledge.processing.failed',
      resourceType: 'knowledge_item',
      resourceId: itemId,
      metadata: { error: errMsg },
    });
    throw e;
  }
}
