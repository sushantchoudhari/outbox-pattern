/**
 * common/errors/ApiError.ts — Application Error Class
 * ──────────────────────────────────────────────────────
 * The single error class used across all service layers to signal
 * expected failure conditions (wrong input, resource not found, etc.).
 *
 * WHY A CUSTOM CLASS?
 *   The central error middleware (error.middleware.ts) uses
 *   `instanceof ApiError` to distinguish between:
 *     - Intentional errors (404, 409, …) → map statusCode directly to HTTP
 *     - Unexpected errors (bugs, crashes) → always respond with 500
 *
 * USAGE:
 *   throw ApiError.notFound('User not found');
 *   throw ApiError.conflict('Email is already in use');
 */

export class ApiError extends Error {
  public readonly statusCode: number;
  /** True for domain errors (safe to show to clients); false for system errors. */
  public readonly isOperational: boolean;
  /** Optional structured details, e.g. per-field validation errors. */
  public details?: unknown;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.name         = 'ApiError';
    this.statusCode   = statusCode;
    this.isOperational = isOperational;
    // Ensures the stack trace points to the throw site, not this constructor.
    Error.captureStackTrace(this, this.constructor);
  }

  // ─── Static factory helpers ────────────────────────────────────────────────
  // Prefer these over `new ApiError()` directly — they make call sites readable.

  static badRequest(message: string): ApiError {
    return new ApiError(message, 400);
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(message, 401);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(message, 403);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(message, 404);
  }

  static conflict(message: string): ApiError {
    return new ApiError(message, 409);
  }

  static unprocessableEntity(message: string): ApiError {
    return new ApiError(message, 422);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(message, 500, false);
  }
}
