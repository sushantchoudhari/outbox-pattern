/**
 * modules/user/user.routes.ts — User Resource Route Definitions
 * ───────────────────────────────────────────────────────────────
 * Maps HTTP method + path combinations to controller handlers with
 * an explicit middleware chain on each route.
 *
 * MIDDLEWARE CHAIN (left to right):
 *   authenticate          → verify JWT, attach req.user
 *   authorize('admin')    → restrict to admin role
 *   validate(schema)      → parse & validate input, return 422 if invalid
 *   controller.method     → execute the handler (always last)
 *
 * ACCESS CONTROL:
 *   POST /      — public (registration, no auth required)
 *   GET, PATCH  — any authenticated user
 *   DELETE      — admin only
 */

import { Router } from 'express';
import { userController } from './user.controller';
import { authenticate, authorize } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { createUserSchema, updateUserSchema, idParamSchema } from './user.schema';

const router = Router();

router.get('/',
  authenticate,
  userController.getAll,
);

router.get('/:id',
  authenticate,
  validate(idParamSchema, 'params'),
  userController.getById,
);

router.post('/',
  validate(createUserSchema),
  userController.create,
);

router.patch('/:id',
  authenticate,
  validate(idParamSchema, 'params'),
  validate(updateUserSchema),
  userController.update,
);

router.delete('/:id',
  authenticate,
  authorize('admin'),
  validate(idParamSchema, 'params'),
  userController.remove,
);

export default router;
