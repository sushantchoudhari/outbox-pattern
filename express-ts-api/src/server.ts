/**
 * server.ts — HTTP Server Entry Point
 * ─────────────────────────────────────
 * The only file that starts the TCP listener.  Run with:
 *
 *   node dist/server.js    # production (after npm run build)
 *   npm run dev            # development (tsx watch, auto-restart)
 *
 * GRACEFUL SHUTDOWN:
 *   On SIGTERM (Docker stop / Kubernetes rolling deploy) or SIGINT (Ctrl-C):
 *     1. Stop accepting new connections immediately.
 *     2. Wait for in-flight requests to drain.
 *     3. Exit 0 once all connections close.
 *   A 10-second hard timeout ensures the process always exits even if a
 *   keep-alive connection is held open by a client.
 */

import { createApp } from './app';
import { initLoaders } from './loaders';
import { config } from './config';
import { logger } from './common/helpers/logger';

async function start(): Promise<void> {
  const app = createApp();
  await initLoaders(app);

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Server started');
    if (!config.isProduction) {
      logger.info(`API docs: http://localhost:${config.port}/api/docs`);
    }
  });

  function shutdown(signal: string): void {
    logger.info(`${signal} received — starting graceful shutdown`);

    server.close(() => {
      logger.info('All connections drained — exiting');
      process.exit(0);
    });

    // Hard timeout so we never hang a deployment.
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
}

start().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
