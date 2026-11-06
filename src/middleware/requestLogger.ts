import morgan from 'morgan';

// Webhook credentials travel in the URL (Telegram bot token in the path,
// inbound email secret as a query param) — keep them out of the logs.
function redactUrl(url: string | undefined): string {
  return (url ?? '')
    .replace(/(\/webhooks\/telegram\/)[^/?]+/i, '$1<redacted>')
    .replace(/([?&]secret=)[^&\s]+/i, '$1<redacted>');
}

morgan.token('safe-url', (req) => {
  const r = req as unknown as { originalUrl?: string; url?: string };
  return redactUrl(r.originalUrl ?? r.url);
});

export const requestLogger = morgan(
  ':method :safe-url :status :res[content-length] - :response-time ms'
);
