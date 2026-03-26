/**
 * middlewares/validate.middleware.ts — Zod Request Validation
 * ─────────────────────────────────────────────────────────────
 * Generic middleware factory that runs a Zod schema against a
 * chosen part of the request (body, params, or query).
 *
 * On failure: responds 422 with a structured list of field-level errors.
 * On success: replaces the source with the parsed/coerced Zod output
 *             so downstream handlers receive clean, typed data.
 *
 * USAGE:
 *   router.post('/', validate(createUserSchema), controller.create);
 *   router.get('/:id', validate(idParamSchema, 'params'), controller.getById);
 */

import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../common/errors/ApiError';

type ValidateTarget = 'body' | 'params' | 'query';

export function validate(schema: ZodSchema, target: ValidateTarget = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const source = target === 'body' ? req.body : target === 'params' ? req.params : req.query;

    const result = schema.safeParse(source);

    if (!result.success) {
      const details = result.error.errors.map((e) => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      const err = ApiError.unprocessableEntity('Validation failed');
      err.details = details;
      next(err);
      return;
    }

    // Replace the target with the parsed output so controllers receive
    // coerced, stripped values (e.g. trimmed strings, defaulted fields).
    if (target === 'body') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      req.body = result.data;
    }

    next();
  };
}
