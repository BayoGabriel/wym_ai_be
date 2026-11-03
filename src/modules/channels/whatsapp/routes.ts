import { NextFunction, Request, Response, Router } from 'express';
import { env } from '../../../config/env';
import { handleInboundWhatsAppText } from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Meta webhook verification handshake (hub.mode/subscribe + verify token).
router.get('/whatsapp', (req, res) => {
  const {
    'hub.mode': mode,
    'hub.verify_token': token,
    'hub.challenge': challenge,
  } = req.query as Record<string, string>;
  if (!env.WHATSAPP_VERIFY_TOKEN) {
    return res
      .status(503)
      .json({ error: { code: 'CHANNEL_NOT_CONFIGURED', message: 'WhatsApp not configured' } });
  }
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge ?? '');
  }
  return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Verification failed' } });
});

type WaInboundMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
};

// Meta Cloud API inbound event. Always 200 quickly — Meta retries non-2xx,
// and retries are safe because the pipeline is idempotent on message id.
router.post(
  '/whatsapp',
  handle(async (req, res) => {
    const body = req.body as {
      entry?: {
        changes?: {
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: { wa_id?: string; profile?: { name?: string } }[];
            messages?: WaInboundMessage[];
          };
        }[];
      }[];
    };

    const results: { accepted: number } = { accepted: 0 };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        for (const message of value?.messages ?? []) {
          if (message.type !== 'text' || !message.text?.body || !message.from || !message.id) {
            continue;
          }
          const displayName = value?.contacts?.find((c) => c.wa_id === message.from)?.profile?.name;
          try {
            await handleInboundWhatsAppText({
              phoneNumberId,
              from: message.from,
              text: message.text.body,
              messageId: message.id,
              displayName,
            });
            results.accepted += 1;
          } catch (err) {
            // Log and continue: one bad message must not reject the batch.
             
            console.error('[whatsapp] inbound handling failed:', err);
          }
        }
      }
    }
    res.status(200).json(results);
  })
);

export default router;
