/**
 * common/helpers/logger.ts — Structured JSON Logger
 * ────────────────────────────────────────────────────
 * A single shared Pino logger instance used across the entire application.
 *
 * OUTPUT FORMAT:
 *   Development: human-readable coloured lines (via pino-pretty transport)
 *   Production:  newline-delimited JSON — pipe directly to CloudWatch, Datadog, etc.
 *   Test:        silent (level = 'silent') — no noise in test output
 *
 * USAGE:
 *   import { logger } from '../common/helpers/logger';
 *   logger.info({ requestId: req.id }, 'Request received');
 *   logger.error({ err }, 'Unhandled error');
 */

import pino from 'pino';
import { config } from '../../config';

export const logger = pino({
  level: config.log.level,

  // pino-pretty makes logs human-readable in development terminals.
  // It runs in a separate worker thread — only configured in development.
  // In production, JSON is emitted directly to stdout (no transport overhead).
  ...(config.isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize:  true,
        ignore:    'pid,hostname',
        translateTime: 'HH:MM:ss',
      },
    },
  }),
});
