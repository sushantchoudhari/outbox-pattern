/**
 * middlewares/sessionAuth.middleware.ts — Session-Based Auth & CSRF Guards
 * ──────────────────────────────────────────────────────────────────────────
 * Three middleware functions for protecting routes backed by Redis sessions:
 *
 *   authenticateSession  — Rejects requests without a valid active session.
 *                          Checks req.session.userId set during login.
 *
 *   authorizeSession     — Restricts to users whose session role matches
 *                          one of the provided values. Must follow
 *                          authenticateSession in the middleware chain.
 *
 *   csrfProtect          — Validates the X-CSRF-Token request header against
 *                          the token stored in the Redis session (set at login).
 *                          Safe HTTP methods (GET, HEAD, OPTIONS) bypass check.
 *                          Must follow authenticateSession.
 *
 * HOW CSRF LINKAGE WORKS (per architecture diagram):
 *   1. At login, the server generates a random CSRF token and stores it as
 *      req.session.csrfToken in Redis alongside the userId / role.
 *   2. The login response body returns the csrfToken to the browser client.
 *   3. The client stores the token in memory (NOT in a cookie) and attaches it
 *      as the X-CSRF-Token header on every state-mutating request.
 *   4. csrfProtect compares the header value against the session-stored token.
 *      An attacker's forged cross-origin request cannot read the response body
 *      (SameSite cookie + CORS) so they cannot obtain the X-CSRF-Token value.
 */

import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../common/errors/ApiError';

/**
 * Confirms an active Redis-backed session exists.
 * If req.session.userId is absent the browser's session is expired or invalid.
 */
export function authenticateSession(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    next(ApiError.unauthorized('Session expired or not found — please log in again'));
    return;
  }
  next();
}

/**
 * Restricts a route to users whose session role matches one of the given values.
 * Usage: router.delete('/:id', authenticateSession, authorizeSession('admin'), handler)
 */
export function authorizeSession(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session?.role || !roles.includes(req.session.role)) {
      next(ApiError.forbidden('You do not have permission to perform this action'));
      return;
    }
    next();
  };
}

/**
 * CSRF token validation — second layer of CSRF protection after SameSite cookie.
 * Compares the X-CSRF-Token request header against the session-stored token.
 * Must be placed AFTER authenticateSession so the session is guaranteed present.
 */
export function csrfProtect(req: Request, _res: Response, next: NextFunction): void {
  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
  if (SAFE_METHODS.includes(req.method)) {
    next();
    return;
  }

  const headerToken = req.headers['x-csrf-token'];
  if (!headerToken || headerToken !== req.session?.csrfToken) {
    next(ApiError.forbidden('CSRF token missing or invalid'));
    return;
  }
  next();
}
