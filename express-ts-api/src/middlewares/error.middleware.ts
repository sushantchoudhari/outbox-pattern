/**
 * middlewares/error.middleware.ts — Central Error Handler
 * ─────────────────────────────────────────────────────────
 * The single place where every unhandled error lands before a response
 * is sent. Controllers forward errors here via next(err).
 *
 * CATEGORIES HANDLED:
 *   1. ApiError          — intentional domain errors (4xx) from service layer
 *   2. JSON parse errors — malformed request body (thrown by express.json())
 *   3. Everything else   — unexpected server errors (logged; detail hidden in prod)
 *
 * IMPORTANT: Express identifies error handlers by their FOUR-parameter signature.
 * Never remove the `_next` parameter even though it is unused.
 */

import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../common/errors/ApiError';
import { config } from '../config';
import { logger } from '../common/helpers/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.id;

  // ── 1. Operational domain error ───────────────────────────────────────────
  if (err instanceof ApiError) {
    logger.warn({ requestId, statusCode: err.statusCode, error: err.message }, 'Application error');

    res.status(err.statusCode).json({
      success: false,
      error:   err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }

  // ── 2. Malformed JSON body ─────────────────────────────────────────────────
  if ('type' in err && (err as Error & { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ success: false, error: 'Request body contains invalid JSON' });
    return;
  }

  // ── 3. Unexpected error ────────────────────────────────────────────────────
  logger.error({ requestId, error: err.message, stack: err.stack }, 'Unhandled error');

  res.status(500).json({
    success: false,
    error:   'An unexpected error occurred',
    // Only include internal details in development so we don't leak stack info.
    ...(config.isDevelopment && { detail: err.message }),
  });
}
