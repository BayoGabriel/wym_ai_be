import { NextFunction, Request, Response, Router } from 'express';
import { env } from '../../../config/env';
import { handleInboundEmail } from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Provider-agnostic inbound email. Mail providers (SendGrid Inbound Parse,
// Mailgun routes, SES→Lambda, or a poller) normalize to this JSON shape:
// { from, to, subject?, text, messageId? }. When EMAIL_INBOUND_SECRET is set,
// callers must send it in the x-webhook-secret header or ?secret= param.
router.post(
  '/email',
  handle(async (req, res) => {
    if (env.EMAIL_INBOUND_SECRET) {
      const provided = req.headers['x-webhook-secret'] ?? (req.query.secret as string | undefined);
      if (provided !== env.EMAIL_INBOUND_SECRET) {
        return res
          .status(401)
          .json({ error: { code: 'UNAUTHORIZED', message: 'Bad webhook secret' } });
      }
    }

    const body = req.body as {
      from?: string;
      to?: string;
      subject?: string;
      text?: string;
      messageId?: string;
    };
    if (!body.from || !body.to || !body.text) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'from, to and text are required' },
      });
    }

    const result = await handleInboundEmail({
      from: body.from,
      to: body.to,
      subject: body.subject,
      text: body.text,
      messageId: body.messageId,
    });
    return res.status(200).json({ accepted: 1, ...result });
  })
);

export default router;
