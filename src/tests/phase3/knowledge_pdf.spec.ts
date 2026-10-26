import { describe, it, beforeAll, expect } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import { knowledgeDocuments } from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import { eq } from 'drizzle-orm';
import {
  assignUserRole,
  ensureOrg,
  ensureRole,
  ensureUser,
  grantRolePermission,
  setAssistEntitlement,
} from '../utils/fixtures';

function makeMinimalPdf(): Buffer {
  const content = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF';
  return Buffer.from(content, 'utf-8');
}

describe('Phase 3: Knowledge (PDF)', () => {
  const app = createApp();
  let org: any;
  let token: string;

  beforeAll(async () => {
    org = await ensureOrg('DocOrg', 'doc-org');
    const u = await ensureUser('docadmin@example.com', org.id);

    const role = await ensureRole('Knowledge Tester', 'organization');
    for (const perm of ['knowledge.read', 'knowledge.write']) {
      await grantRolePermission(role.id, perm);
    }
    await assignUserRole({ userId: u.id, roleId: role.id, organizationId: org.id });
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });

    token = (await issueTokens({ id: u.id, organizationId: org.id, status: 'active' })).accessToken;
  });

  it('uploads valid PDF and creates item+document', async () => {
    const pdf = makeMinimalPdf();
    const res = await request(app)
      .post('/api/v1/knowledge/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Handbook',
        description: 'PDF doc',
        category: 'GENERAL',
        fileName: 'handbook.pdf',
        mimeType: 'application/pdf',
        base64: pdf.toString('base64'),
      });
    expect(res.status).toBe(201);
    expect(res.body?.item?.id).toBeDefined();
    expect(res.body?.document?.id).toBeDefined();
    const [doc] = await db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, res.body.document.id))
      .limit(1);
    expect(doc).toBeTruthy();
  });

  it('rejects invalid PDF (wrong magic header)', async () => {
    const fake = Buffer.from('NOTPDF', 'utf-8');
    const res = await request(app)
      .post('/api/v1/knowledge/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Fake',
        description: 'bad',
        category: 'GENERAL',
        fileName: 'fake.pdf',
        mimeType: 'application/pdf',
        base64: fake.toString('base64'),
      });
    expect(res.status).toBe(400);
  });
});
