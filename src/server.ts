import { env } from './config/env';
import { createApp } from './app';
import { startReportScheduler } from './modules/reports/schedules';

const app = createApp();
startReportScheduler();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

function gracefulShutdown() {
  // eslint-disable-next-line no-console
  console.log('Shutting down gracefully...');
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
