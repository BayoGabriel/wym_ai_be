import path from 'path';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { requestLogger } from './middleware/requestLogger';
import routes from './routes/index';
import { errorHandler, notFoundHandler } from './middleware/error';
import authRoutes from './modules/auth/routes';
import orgRoutes from './modules/organizations/routes';
import userRoutes from './modules/users/routes';
import rbacRoutes from './modules/rbac/routes';
import orgSettingsRoutes from './modules/organizations/settings';
import assistConfigRoutes from './modules/assist/config';
import productAdminRoutes from './modules/products/routes';
import knowledgeRoutes from './modules/knowledge/routes';
import retrievalRoutes from './modules/retrieval/routes';
import aiRoutes from './modules/ai/routes';
import conversationRoutes from './modules/conversations/routes';
import leadRoutes from './modules/leads/routes';
import handoffRoutes from './modules/handoffs/routes';
import appointmentRoutes from './modules/appointments/routes';
import reportRoutes from './modules/reports/routes';
import insightRoutes from './modules/insight/routes';
import flowRoutes from './modules/flow/routes';
import adminRoutes from './modules/admin/routes';
import publicAssistRoutes from './modules/public/routes';
import channelWebhookRoutes from './modules/channels/routes';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi';
import { env } from './config/env';

export function createApp() {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());

  const corsOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));

  // Base64 PDF uploads are ~4/3 the document size; the limit must exceed
  // MAX_KNOWLEDGE_DOCUMENT_SIZE_MB or uploads are rejected before validation.
  // `verify` keeps the raw body so webhook handlers can verify HMAC signatures.
  app.use(
    express.json({
      limit: `${Math.ceil(env.MAX_KNOWLEDGE_DOCUMENT_SIZE_MB * 1.5)}mb`,
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    })
  );
  app.use(requestLogger);

  const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

  app.get('/', (_req: Request, res: Response) => {
    res.json({ name: 'WymNet AI Backend', status: 'running' });
  });

  app.use('/api/v1', routes);
  app.use('/api/v1/auth', authLimiter, authRoutes);
  app.use('/api/v1/public/assist', publicAssistRoutes);

  // Embeddable widget bundle (frontend/dist-widget by default). Embed snippets
  // point at <api-host>/widget/wymassist.js so clients need only the API origin.
  const widgetDir = env.WIDGET_ASSETS_DIR ?? path.resolve(process.cwd(), '../frontend/dist-widget');
  app.use('/widget', (_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });
  app.use('/widget', express.static(widgetDir, { maxAge: '1h', index: false }));
  app.use('/api/v1/webhooks', channelWebhookRoutes);

  // Interactive API documentation (Swagger UI) + raw OpenAPI JSON.
  // Disabled by default in production; set ENABLE_API_DOCS=true to expose.
  if (env.ENABLE_API_DOCS) {
    // helmet's default CSP blocks Swagger UI's inline init script and styles —
    // relax it for the docs pages only.
    app.use('/api/docs', (_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
      );
      next();
    });
    app.get('/api/docs.json', (_req: Request, res: Response) => res.json(openApiSpec));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  }

  app.use('/api/v1/organizations', orgSettingsRoutes);
  app.use('/api/v1/organizations', orgRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1', rbacRoutes);
  app.use('/api/v1/assist', assistConfigRoutes);
  app.use('/api/v1/admin', productAdminRoutes);
  app.use('/api/v1', knowledgeRoutes);
  app.use('/api/v1', retrievalRoutes);
  app.use('/api/v1', aiRoutes);
  app.use('/api/v1', conversationRoutes);
  app.use('/api/v1', leadRoutes);
  app.use('/api/v1', handoffRoutes);
  app.use('/api/v1', appointmentRoutes);
  app.use('/api/v1', reportRoutes);
  app.use('/api/v1', insightRoutes);
  app.use('/api/v1', flowRoutes);
  app.use('/api/v1/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
