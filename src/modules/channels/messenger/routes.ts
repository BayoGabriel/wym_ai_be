import { NextFunction, Request, Response, Router } from 'express';
import { env } from '../../../config/env';
import { parseMetaMessaging, verifyMetaSignature, verifyMetaWebhook } from '../meta/common';
import { handleInboundMessengerText } from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.get('/messenger', verifyMetaWebhook);

// Meta inbound event. Always 200 quickly — Meta retries non-2xx, and retries
// are safe because the pipeline is idempotent on message id.
router.post(
  '/messenger',
  handle(async (req, res) => {
    if (!verifyMetaSignature(req, env.META_APP_SECRET)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bad signature' } });
    }
    const results: { accepted: number } = { accepted: 0 };
    for (const entry of parseMetaMessaging(req.body)) {
      const pageId = entry.id;
      if (!pageId) continue;
      for (const event of entry.messaging ?? []) {
        const message = event.message;
        const senderPsid = event.sender?.id;
        if (!senderPsid || !message || message.is_echo || !message.mid || !message.text) {
          continue;
        }
        try {
          await handleInboundMessengerText({
            pageId,
            senderPsid,
            text: message.text,
            messageId: message.mid,
          });
          results.accepted += 1;
        } catch (err) {
          // Log and continue: one bad message must not reject the batch.
           
          console.error('[messenger] inbound handling failed:', err);
        }
      }
    }
    res.status(200).json(results);
  })
);

export default router;
