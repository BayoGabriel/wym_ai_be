import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import { conversations, messages, organizationSettings } from '../../database/schema/core';
import { ensureOrg, setAssistEntitlement } from '../utils/fixtures';

type OrgRow = Awaited<ReturnType<typeof ensureOrg>>;

async function bindChannels(
  organizationId: string,
  bindings: Partial<typeof organizationSettings.$inferInsert>
) {
  const existing = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, organizationId))
    .limit(1);
  if (existing.length) {
    await db
      .update(organizationSettings)
      .set(bindings)
      .where(eq(organizationSettings.organizationId, organizationId));
  } else {
    await db.insert(organizationSettings).values({ organizationId, ...bindings });
  }
}

async function conversationFor(orgId: string, externalSessionId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.organizationId, orgId), eq(conversations.externalSessionId, externalSessionId))
    )
    .limit(1);
  return conv;
}

async function messageCount(conversationId: string) {
  const rows = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
  return rows.length;
}

describe.sequential('Phase 14: external channels', () => {
  const app = createApp();
  let org: OrgRow;
  let orgNoEnt: OrgRow;

  beforeAll(async () => {
    org = await ensureOrg('Channels Org', 'channels-org');
    orgNoEnt = await ensureOrg('Channels NoEnt', 'channels-noent');
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    await bindChannels(org.id, {
      messengerPageId: '111222333',
      instagramAccountId: '444555666',
      telegramBotToken: '123456789:AAAtestToken_testToken_testToken',
      inboundEmailAddress: 'assist@channels-org.test',
    });
    await bindChannels(orgNoEnt.id, { messengerPageId: '999000111' });
  });

  it('routes Messenger texts into a conversation and replies', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/messenger')
      .send({
        object: 'page',
        entry: [
          {
            id: '111222333',
            messaging: [
              { sender: { id: 'PSID-1' }, message: { mid: 'm-1', text: 'Hello from FB' } },
            ],
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);

    const conv = await conversationFor(org.id, 'fb:PSID-1');
    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('MESSENGER');
    expect(await messageCount(conv.id)).toBe(2); // user + assistant

    // Meta retry with the same mid must not duplicate messages.
    const retry = await request(app)
      .post('/api/v1/webhooks/messenger')
      .send({
        object: 'page',
        entry: [
          {
            id: '111222333',
            messaging: [
              { sender: { id: 'PSID-1' }, message: { mid: 'm-1', text: 'Hello from FB' } },
            ],
          },
        ],
      });
    expect(retry.status).toBe(200);
    expect(await messageCount(conv.id)).toBe(2);
  });

  it('skips Messenger echoes and unknown pages', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/messenger')
      .send({
        object: 'page',
        entry: [
          {
            id: '111222333',
            messaging: [
              { sender: { id: 'PSID-1' }, message: { mid: 'm-echo', text: 'echo', is_echo: true } },
            ],
          },
          {
            id: 'unbound-page',
            messaging: [
              { sender: { id: 'PSID-2' }, message: { mid: 'm-2', text: 'Hi' } },
            ],
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(0);
  });

  it('routes Instagram DMs into a conversation', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/instagram')
      .send({
        object: 'instagram',
        entry: [
          {
            id: '444555666',
            messaging: [
              { sender: { id: 'IGSID-1' }, message: { mid: 'ig-1', text: 'Hi from IG' } },
            ],
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);

    const conv = await conversationFor(org.id, 'ig:IGSID-1');
    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('INSTAGRAM');
    expect(await messageCount(conv.id)).toBe(2);
  });

  it('routes Telegram messages by bot token in the webhook path', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/telegram/123456789:AAAtestToken_testToken_testToken')
      .send({
        update_id: 100,
        message: {
          message_id: 7,
          chat: { id: 4242, type: 'private' },
          from: { first_name: 'Ada', last_name: 'Lovelace' },
          text: 'Hello bot',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);

    const conv = await conversationFor(org.id, 'tg:4242');
    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('TELEGRAM');
    expect(conv.title).toBe('Telegram: Ada Lovelace');
    expect(await messageCount(conv.id)).toBe(2);
  });

  it('rejects Telegram webhooks for unknown bot tokens', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/telegram/999999999:BBBunknownToken_unknownToken_x')
      .send({ message: { message_id: 1, chat: { id: 1 }, text: 'hi' } });
    expect(res.status).toBe(404);
  });

  it('acknowledges non-text Telegram updates without processing', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/telegram/123456789:AAAtestToken_testToken_testToken')
      .send({ message: { message_id: 8, chat: { id: 4242 }, sticker: { emoji: '👍' } } });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(0);
  });

  it('routes inbound email by the bound inbound address', async () => {
    const res = await request(app).post('/api/v1/webhooks/email').send({
      from: 'Gabriel <gabriel@example.com>',
      to: 'assist@channels-org.test',
      subject: 'Pricing question',
      text: 'How much does it cost?',
      messageId: '<msg-1@mail.example.com>',
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);

    const conv = await conversationFor(org.id, 'email:gabriel@example.com');
    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('EMAIL');
    expect(await messageCount(conv.id)).toBe(2);
  });

  it('rejects malformed inbound email payloads', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/email')
      .send({ from: 'a@b.c', to: 'assist@channels-org.test' });
    expect(res.status).toBe(400);
  });

  it('404s inbound email to unbound addresses', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/email')
      .send({ from: 'a@b.c', to: 'nobody@nowhere.test', text: 'hi' });
    expect(res.status).toBe(404);
  });

  it('returns CHANNEL_UNAVAILABLE for orgs without entitlement', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/messenger')
      .send({
        object: 'page',
        entry: [
          {
            id: '999000111',
            messaging: [
              { sender: { id: 'PSID-9' }, message: { mid: 'm-noent', text: 'Hi' } },
            ],
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(0);
    const conv = await conversationFor(orgNoEnt.id, 'fb:PSID-9');
    expect(conv).toBeUndefined();
  });
});
