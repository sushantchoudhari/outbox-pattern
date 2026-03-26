/**
 * middlewares/auth.middleware.ts — JWT Authentication & Role Authorization
 * ──────────────────────────────────────────────────────────────────────────
 * Two exported middleware functions:
 *
 *   authenticate  — Verifies the Bearer token in the Authorization header.
 *                   Attaches the decoded payload to req.user on success.
 *
 *   authorize     — Guards a route to one or more specific roles.
 *                   Must always be placed AFTER authenticate:
 *                     router.delete('/:id', authenticate, authorize('admin'), controller.remove);
 */

import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { ApiError } from '../common/errors/ApiError';

interface JwtPayload {
  id:   string;
  role: string;
}

/** Reads "Authorization: Bearer <token>", verifies it, and sets req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next(ApiError.unauthorized('Authorization header missing or malformed — expected: Bearer <token>'));
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch {
    next(ApiError.unauthorized('Token is invalid or has expired'));
  }
}

/**
 * Restricts a route to users whose role matches one of the provided values.
 * Returns a middleware function — call it as: authorize('admin') or authorize('admin', 'manager').
 */
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(ApiError.forbidden('You do not have permission to perform this action'));
      return;
    }
    next();
  };
}
