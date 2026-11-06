import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { env } from '../../../config/env';

// Meta webhook verification handshake shared by Messenger and Instagram
// (hub.mode=subscribe + hub.verify_token + hub.challenge).
export function verifyMetaWebhook(req: Request, res: Response) {
  const {
    'hub.mode': mode,
    'hub.verify_token': token,
    'hub.challenge': challenge,
  } = req.query as Record<string, string>;
  if (!env.META_VERIFY_TOKEN) {
    return res
      .status(503)
      .json({ error: { code: 'CHANNEL_NOT_CONFIGURED', message: 'Meta webhooks not configured' } });
  }
  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge ?? '');
  }
  return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Verification failed' } });
}

// X-Hub-Signature-256 check for inbound webhook POSTs. When no app secret is
// configured the check is skipped — set META_APP_SECRET / WHATSAPP_APP_SECRET
// in production so forged inbound events are rejected.
export function verifyMetaSignature(req: Request, appSecret: string | undefined): boolean {
  if (!appSecret) return true;
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=') || !req.rawBody) {
    return false;
  }
  const expected = `sha256=${createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`;
  const provided = Buffer.from(header);
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

// Sends a text reply through the Meta Send API — one endpoint serves both
// Messenger and Instagram; the page/professional account access token decides
// which surface the message lands on.
export async function sendMetaText(params: {
  accessToken: string;
  recipientId: string;
  text: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.NOTIFICATION_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/me/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${params.accessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: params.recipientId },
          message: { text: params.text.slice(0, 2000) },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      throw new Error(`Meta send failed (${res.status})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Shape shared by Messenger (entry.id = page id) and Instagram
// (entry.id = IG professional account id) webhook payloads.
export type MetaMessagingEntry = {
  id?: string;
  messaging?: {
    sender?: { id?: string };
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      attachments?: unknown[];
    };
  }[];
};

export function parseMetaMessaging(body: unknown): MetaMessagingEntry[] {
  const b = body as { entry?: MetaMessagingEntry[] };
  return b?.entry ?? [];
}
