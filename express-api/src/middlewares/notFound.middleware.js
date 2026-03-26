'use strict';

/**
 * middlewares/notFound.middleware.js — 404 Catch-All
 * ───────────────────────────────────────────────────
 * Catches any request that didn't match a defined route and returns a
 * consistent 404 JSON response.
 *
 * REGISTRATION (in app.js):
 *   app.use(notFound);          // after all routes
 *   app.use(errorHandler);      // after notFound
 *
 * WHY NOT JUST LET THE REQUEST TIME OUT?
 *   Without this, Express falls through to its default HTML 404 page,
 *   which is inconsistent with the rest of the API's JSON responses.
 */

function notFound(req, res) {
  res.status(404).json({
    success: false,
    error:   `Route ${req.method} ${req.originalUrl} not found`,
  });
}

module.exports = notFound;
