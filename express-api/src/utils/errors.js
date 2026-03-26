'use strict';

/**
 * utils/errors.js — Custom Application Error Classes
 * ────────────────────────────────────────────────────
 * Defining errors in their own file prevents circular imports:
 *   services throw AppError  →  error middleware catches AppError
 * If AppError lived in a service file, the middleware would import the
 * service, creating a circular dependency.
 */

/**
 * AppError represents an intentional, expected error condition —
 * something that is wrong with the REQUEST, not the application itself.
 *
 * Examples: "User not found" (404), "Email already in use" (409).
 *
 * The central error handler maps these directly to HTTP responses.
 * Unexpected programming errors (bugs, crashes) are NOT AppErrors —
 * they fall through to the generic 500 handler.
 */
class AppError extends Error {
  /**
   * @param {string} message    - Human-readable description shown to the API client.
   * @param {number} statusCode - HTTP status code (e.g. 400, 404, 409).
   */
  constructor(message, statusCode = 500) {
    super(message);
    this.name       = 'AppError';
    this.statusCode = statusCode;
  }
}

module.exports = { AppError };
