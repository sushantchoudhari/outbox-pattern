'use strict';

/**
 * middlewares/error.middleware.js — Central Error Handler
 * ────────────────────────────────────────────────────────
 * This is the single place where all unhandled errors land.
 * Controllers forward errors here via next(err). Having one handler
 * means consistent error responses across the entire API.
 *
 * HOW TO REGISTER IT (in app.js):
 *   app.use(errorHandler);  // Must be LAST — after all routes and notFound
 *
 * WHY THE 4-ARGUMENT SIGNATURE?
 *   Express only treats a function as an error handler when it declares
 *   exactly 4 parameters: (err, req, res, next). Do not remove `next`
 *   even if it is unused — Express checks the function's .length property.
 *
 * ERROR CATEGORIES HANDLED:
 *   1. AppError  — intentional errors thrown by services (404, 409, etc.)
 *   2. JSON parse errors — malformed request body (express.json() throws these)
 *   3. Everything else — unexpected server errors (logged, details hidden in prod)
 */

const { AppError } = require('../utils/errors');
const logger       = require('../utils/logger');
const config       = require('../config');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Always log the error for observability (stack trace in dev only).
  logger.error('Request error', {
    error:  err.message,
    stack:  config.server.env === 'development' ? err.stack : undefined,
    method: req.method,
    url:    req.originalUrl,
  });

  // ── 1. Known application error (thrown intentionally by a service) ──────────
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error:   err.message,
    });
  }

  // ── 2. Malformed JSON in the request body ───────────────────────────────────
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error:   'Request body contains invalid JSON',
    });
  }

  // ── 3. Unexpected / uncaught error ──────────────────────────────────────────
  // In production we hide the internal detail to avoid leaking implementation
  // information. In development we include it to help with debugging.
  return res.status(500).json({
    success: false,
    error:   'An unexpected error occurred',
    ...(config.server.env === 'development' && { detail: err.message }),
  });
}

module.exports = errorHandler;
