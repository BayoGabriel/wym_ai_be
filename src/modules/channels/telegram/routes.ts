import { NextFunction, Request, Response, Router } from 'express';
import { env } from '../../../config/env';
import { handleInboundTelegramText } from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

type TelegramUpdate = {
  message?: {
    message_id?: number;
    chat?: { id?: number };
    from?: { first_name?: string; last_name?: string; username?: string };
    text?: string;
  };
};

// Each org registers its own BotFather bot and points the webhook at
// /api/v1/webhooks/telegram/<botToken>; the token in the path both identifies
// the org and authenticates the source. When TELEGRAM_WEBHOOK_SECRET is set,
// Telegram's secret_token header must also match.
router.post(
  '/telegram/:botToken',
  handle(async (req, res) => {
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      if (header !== env.TELEGRAM_WEBHOOK_SECRET) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Bad secret' } });
      }
    }

    const update = req.body as TelegramUpdate;
    const message = update.message;
    const chatId = message?.chat?.id;
    // Non-text updates (joins, stickers, edited messages, channel posts) are
    // acknowledged and ignored — Telegram expects a 200 regardless.
    if (!chatId || !message?.message_id || !message.text) {
      return res.status(200).json({ accepted: 0 });
    }

    const displayName =
      [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') ||
      message.from?.username;

    const result = await handleInboundTelegramText({
      botToken: req.params.botToken,
      chatId,
      text: message.text,
      messageId: message.message_id,
      displayName,
    });
    return res.status(200).json({ accepted: 1, ...result });
  })
);

export default router;
