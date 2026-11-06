import { NextFunction, Request, Response, Router } from 'express';
import { env } from '../../../config/env';
import { parseMetaMessaging, verifyMetaSignature, verifyMetaWebhook } from '../meta/common';
import { handleInboundInstagramText } from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.get('/instagram', verifyMetaWebhook);

// Meta inbound event. Always 200 quickly — Meta retries non-2xx, and retries
// are safe because the pipeline is idempotent on message id. Story mentions,
// reactions and attachments carry no text and are skipped.
router.post(
  '/instagram',
  handle(async (req, res) => {
    if (!verifyMetaSignature(req, env.META_APP_SECRET)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bad signature' } });
    }
    const results: { accepted: number } = { accepted: 0 };
    for (const entry of parseMetaMessaging(req.body)) {
      const accountId = entry.id;
      if (!accountId) continue;
      for (const event of entry.messaging ?? []) {
        const message = event.message;
        const senderIgsid = event.sender?.id;
        if (!senderIgsid || !message || message.is_echo || !message.mid || !message.text) {
          continue;
        }
        try {
          await handleInboundInstagramText({
            accountId,
            senderIgsid,
            text: message.text,
            messageId: message.mid,
          });
          results.accepted += 1;
        } catch (err) {
          // Log and continue: one bad message must not reject the batch.
           
          console.error('[instagram] inbound handling failed:', err);
        }
      }
    }
    res.status(200).json(results);
  })
);

export default router;
