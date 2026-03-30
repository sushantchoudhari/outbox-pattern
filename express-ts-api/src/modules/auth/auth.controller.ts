/**
 * modules/auth/auth.controller.ts — Auth HTTP Handlers
 * ───────────────────────────────────────────────────────
 */

import { randomBytes } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { authService } from './auth.service';
import { ok, created, noContent } from '../../common/helpers/response.helper';
import { ApiError } from '../../common/errors/ApiError';

async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.register(req.body.name, req.body.email, req.body.password);

    // Auto-login: populate the Redis session immediately after registration
    // so the user doesn't have to log in separately.
    req.session.userId    = result.user.id;
    req.session.role      = result.user.role;
    req.session.loginAt   = Date.now();
    req.session.csrfToken = randomBytes(32).toString('hex');

    // Return csrfToken in the response body — the browser stores it in memory
    // (not in a cookie) and sends it back on mutations via X-CSRF-Token header.
    created(res, { ...result, csrfToken: req.session.csrfToken });
  } catch (err) {
    next(err);
  }
}

async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.login(req.body.email, req.body.password);

    // Populate the shared Redis session.
    // This data is persisted to ElastiCache so that any ECS task that
    // subsequently handles a request from this browser can find the session.
    req.session.userId    = result.user.id;
    req.session.role      = result.user.role;
    req.session.loginAt   = Date.now();
    req.session.csrfToken = randomBytes(32).toString('hex');

    ok(res, { ...result, csrfToken: req.session.csrfToken });
  } catch (err) {
    next(err);
  }
}

function profile(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    ok(res, authService.profile(req.user.id));
  } catch (err) {
    next(err);
  }
}

async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  req.session.destroy((err) => {
    if (err) {
      next(err);
      return;
    }
    // Clear the session cookie from the browser.
    res.clearCookie('sid');
    noContent(res);
  });
}

export const authController = { register, login, profile, logout };
