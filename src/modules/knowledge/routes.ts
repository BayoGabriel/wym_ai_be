import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { db } from '../../database/client';
import { knowledgeDocuments, knowledgeItems } from '../../database/schema/core';
import { and, eq, ilike, like, or } from 'drizzle-orm';
import { validate } from '../../middleware/validate';
import {
  createTextKnowledgeSchema,
  listQuerySchema,
  updateKnowledgeSchema,
  uploadPdfSchema,
} from './validation';
import { recordAudit } from '../audit/service';
import { organizationHasProduct } from '../products/service';
import { initStorage, savePdfBuffer, readPdf } from './storage';
import { env } from '../../config/env';
import { processKnowledgeItem } from './processing/processor';
import { embedMissingForItem } from '../retrieval/embedder';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.use(authenticate);

async function ensureAssistEntitlement(auth: any) {
  const ok =
    auth.organizationId && (await organizationHasProduct(auth.organizationId, 'WYMASSIST'));
  if (!ok) {
    const err: any = new Error('Forbidden: WYMASSIST not entitled');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

router.get(
  '/knowledge',
  validate(listQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.read');
    await ensureAssistEntitlement(auth);
    const { category, sourceType, status, search, page, limit } = req.query as any;

    const whereClauses: any[] = [eq(knowledgeItems.organizationId, auth.organizationId!)];
    if (category) whereClauses.push(eq(knowledgeItems.category, category));
    if (sourceType) whereClauses.push(eq(knowledgeItems.sourceType, sourceType));
    if (status) whereClauses.push(eq(knowledgeItems.status, status));

    let rowsQuery = db
      .select()
      .from(knowledgeItems)
      .where(and(...whereClauses));
    if (search) {
      rowsQuery = db
        .select()
        .from(knowledgeItems)
        .where(
          and(
            ...whereClauses,
            or(
              ilike(knowledgeItems.title as any, `%${search}%`),
              ilike(knowledgeItems.description as any, `%${search}%`)
            )
          )
        );
    }
    const offset = (page - 1) * limit;
    // @ts-ignore drizzle typing for limit/offset
    const rows = await (rowsQuery as any).limit(limit).offset(offset);
    return res.json({ items: rows, page, limit });
  })
);

router.post(
  '/knowledge',
  validate(createTextKnowledgeSchema),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.write');
    await ensureAssistEntitlement(auth);
    const body = req.body as any;
    const [row] = await db
      .insert(knowledgeItems)
      .values({
        organizationId: auth.organizationId!,
        title: body.title,
        description: body.description,
        content: body.content,
        sourceType: 'TEXT',
        status: body.status ?? 'DRAFT',
        category: body.category ?? 'GENERAL',
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning();
    await recordAudit({
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'knowledge.created',
      resourceType: 'knowledge_item',
      resourceId: row.id,
    });
    return res.status(201).json(row);
  })
);

router.get(
  '/knowledge/:id',
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.read');
    await ensureAssistEntitlement(auth);
    const id = req.params.id;
    const [row] = await db
      .select()
      .from(knowledgeItems)
      .where(
        and(eq(knowledgeItems.id, id), eq(knowledgeItems.organizationId, auth.organizationId!))
      )
      .limit(1);
    if (!row)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge not found' } });
    return res.json(row);
  })
);

router.patch(
  '/knowledge/:id',
  validate(updateKnowledgeSchema),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.write');
    await ensureAssistEntitlement(auth);
    const id = req.params.id;
    const updates = req.body as any;
    const existing = await db
      .select()
      .from(knowledgeItems)
      .where(
        and(eq(knowledgeItems.id, id), eq(knowledgeItems.organizationId, auth.organizationId!))
      )
      .limit(1);
    if (existing.length === 0)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge not found' } });
    const [row] = await db
      .update(knowledgeItems)
      .set({ ...updates, updatedBy: auth.userId })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await recordAudit({
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'knowledge.updated',
      resourceType: 'knowledge_item',
      resourceId: row.id,
    });
    return res.json(row);
  })
);

router.delete(
  '/knowledge/:id',
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.write');
    await ensureAssistEntitlement(auth);
    const id = req.params.id;
    const existing = await db
      .select()
      .from(knowledgeItems)
      .where(
        and(eq(knowledgeItems.id, id), eq(knowledgeItems.organizationId, auth.organizationId!))
      )
      .limit(1);
    if (existing.length === 0)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge not found' } });
    const [row] = await db
      .update(knowledgeItems)
      .set({ status: 'ARCHIVED', updatedBy: auth.userId })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await recordAudit({
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'knowledge.archived',
      resourceType: 'knowledge_item',
      resourceId: row.id,
    });
    return res.status(204).send();
  })
);

router.post(
  '/knowledge/documents',
  validate(uploadPdfSchema),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.write');
    await ensureAssistEntitlement(auth);
    const body = req.body as any;
    // Validate base64 and size
    const buf = Buffer.from(body.base64, 'base64');
    const maxBytes = env.MAX_KNOWLEDGE_DOCUMENT_SIZE_MB * 1024 * 1024;
    if (buf.length > maxBytes)
      return res
        .status(400)
        .json({ error: { code: 'FILE_TOO_LARGE', message: 'PDF exceeds maximum size' } });
    // Check magic bytes for PDF: starts with %PDF-
    const header = buf.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-')
      return res.status(400).json({ error: { code: 'INVALID_PDF', message: 'Invalid PDF file' } });
    await initStorage();
    const storageKey = await savePdfBuffer(auth.organizationId!, body.fileName, buf);
    // Create knowledge item + document
    const [item] = await db
      .insert(knowledgeItems)
      .values({
        organizationId: auth.organizationId!,
        title: body.title,
        description: body.description,
        sourceType: 'PDF',
        status: 'DRAFT',
        category: body.category ?? 'GENERAL',
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning();
    const [doc] = await db
      .insert(knowledgeDocuments)
      .values({
        knowledgeItemId: item.id,
        originalFilename: body.fileName,
        mimeType: body.mimeType,
        fileSize: buf.length,
        storageKey,
        uploadedBy: auth.userId,
      })
      .returning();
    await recordAudit({
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'knowledge.document.uploaded',
      resourceType: 'knowledge_document',
      resourceId: doc.id,
      metadata: { knowledgeItemId: item.id, storageKey },
    });
    return res.status(201).json({ item, document: doc });
  })
);

router.post(
  '/knowledge/:id/process',
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.write');
    await ensureAssistEntitlement(auth);
    const id = req.params.id;
    const [item] = await db
      .select()
      .from(knowledgeItems)
      .where(
        and(eq(knowledgeItems.id, id), eq(knowledgeItems.organizationId, auth.organizationId!))
      )
      .limit(1);
    if (!item)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge not found' } });
    try {
      if (item.processingStatus && item.processingStatus !== 'PENDING') {
        await recordAudit({
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'knowledge.reprocessed',
          resourceType: 'knowledge_item',
          resourceId: id,
        });
      }
      await processKnowledgeItem({
        organizationId: auth.organizationId!,
        itemId: id,
        actorUserId: auth.userId,
      });
      const [after] = await db
        .select()
        .from(knowledgeItems)
        .where(eq(knowledgeItems.id, id))
        .limit(1);
      // generate embeddings for newly created chunks (idempotent for pending)
      try {
        await embedMissingForItem({
          organizationId: auth.organizationId!,
          itemId: id,
          actorUserId: auth.userId,
        });
      } catch {}
      return res.json({
        processingStatus: after.processingStatus,
        processingError: after.processingError,
      });
    } catch (e: any) {
      return res
        .status(400)
        .json({ error: { code: 'PROCESSING_FAILED', message: String(e?.message || e) } });
    }
  })
);

export default router;
