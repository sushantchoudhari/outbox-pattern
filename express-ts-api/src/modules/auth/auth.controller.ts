/**
 * modules/auth/auth.controller.ts — Auth HTTP Handlers
 * ───────────────────────────────────────────────────────
 */

import { NextFunction, Request, Response } from 'express';
import { authService } from './auth.service';
import { ok, created } from '../../common/helpers/response.helper';
import { ApiError } from '../../common/errors/ApiError';

async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.register(req.body.name, req.body.email, req.body.password);
    created(res, result);
  } catch (err) {
    next(err);
  }
}

async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.login(req.body.email, req.body.password);
    ok(res, result);
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

export const authController = { register, login, profile };
