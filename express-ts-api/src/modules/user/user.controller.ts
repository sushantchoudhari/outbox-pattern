/**
 * modules/user/user.controller.ts — User HTTP Handlers
 * ───────────────────────────────────────────────────────
 * Controllers translate HTTP requests into service calls and service
 * results into HTTP responses.  There is no business logic here —
 * the controller is a thin adapter between Express and the service layer.
 *
 * PATTERN:
 *   1. Extract validated data from req (body/params already validated by middleware)
 *   2. Call the service
 *   3. Send a response using a helper from response.helper.ts
 *   4. Forward any error to next(err) — the central error handler takes over
 */

import { NextFunction, Request, Response } from 'express';
import { userService } from './user.service';
import { ok, created, noContent } from '../../common/helpers/response.helper';

async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.createUser(req.body);
    created(res, user);
  } catch (err) {
    next(err);
  }
}

function getAll(_req: Request, res: Response, next: NextFunction): void {
  try {
    ok(res, userService.getAllUsers());
  } catch (err) {
    next(err);
  }
}

function getById(req: Request, res: Response, next: NextFunction): void {
  try {
    ok(res, userService.getUserById(req.params['id'] as string));
  } catch (err) {
    next(err);
  }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.updateUser(req.params['id'] as string, req.body);
    ok(res, user);
  } catch (err) {
    next(err);
  }
}

function remove(req: Request, res: Response, next: NextFunction): void {
  try {
    userService.deleteUser(req.params['id'] as string);
    noContent(res);
  } catch (err) {
    next(err);
  }
}

export const userController = { create, getAll, getById, update, remove };
