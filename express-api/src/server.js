'use strict';

/**
 * server.js — HTTP Server Entry Point
 * ─────────────────────────────────────
 * This is the only file that starts the TCP listener.  Everything else
 * (app configuration, routes, middleware) lives in app.js so tests can
 * import the app without binding a port.
 *
 * GRACEFUL SHUTDOWN:
 *   When the process receives SIGTERM (sent by Docker / Kubernetes during
 *   a rolling deploy) or SIGINT (Ctrl-C during local dev), we:
 *     1. Stop accepting NEW connections immediately.
 *     2. Wait for in-flight requests to finish.
 *     3. Exit cleanly once the server has fully closed.
 *
 *   A 10-second safety timer ensures the process always exits even if some
 *   connection is kept alive indefinitely.
 *
 * RUN:
 *   node src/server.js          # production
 *   nodemon src/server.js       # development (auto-restart on file changes)
 */

const app    = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

// Start listening.  Express's listen() returns a Node.js http.Server instance.
const server = app.listen(config.server.port, () => {
  logger.info('Server started', {
    port: config.server.port,
    env:  config.server.env,
  });
});

/**
 * Gracefully shuts down the HTTP server.
 *
 * @param {string} signal  — The OS signal that triggered the shutdown.
 */
function shutdown(signal) {
  logger.info(`${signal} received — starting graceful shutdown`);

  // Stop accepting new connections; wait for current ones to finish.
  server.close(() => {
    logger.info('All connections drained — exiting cleanly');
    process.exit(0);
  });

  // Safety net: if connections somehow don't drain within 10 seconds,
  // force-exit to avoid hanging the deployment.
  // .unref() means this timer won't prevent the event loop from ending
  // on its own if everything closes naturally before the timeout fires.
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

// SIGTERM is sent by Docker, Kubernetes, and most process managers during a
// controlled stop or rolling deployment.
process.on('SIGTERM', () => shutdown('SIGTERM'));

// SIGINT is sent by Ctrl-C in the terminal during local development.
process.on('SIGINT',  () => shutdown('SIGINT'));
