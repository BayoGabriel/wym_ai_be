import { Router } from 'express';
import whatsappRoutes from './whatsapp/routes';
import messengerRoutes from './messenger/routes';
import instagramRoutes from './instagram/routes';
import telegramRoutes from './telegram/routes';
import emailRoutes from './email/routes';

// External channel webhooks, mounted at /api/v1/webhooks:
//   GET/POST /whatsapp            Meta Cloud API (WhatsApp Business)
//   GET/POST /messenger           Meta (Facebook Messenger)
//   GET/POST /instagram           Meta (Instagram DMs)
//   POST     /telegram/:botToken  Telegram Bot API (per-org bot)
//   POST     /email               Provider-agnostic inbound email JSON
const router = Router();

router.use(whatsappRoutes);
router.use(messengerRoutes);
router.use(instagramRoutes);
router.use(telegramRoutes);
router.use(emailRoutes);

export default router;
