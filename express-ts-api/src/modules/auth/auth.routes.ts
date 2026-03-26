/**
 * modules/auth/auth.routes.ts — Authentication Route Definitions
 * ────────────────────────────────────────────────────────────────
 *
 * POST /api/v1/auth/register  — public, creates account + returns token
 * POST /api/v1/auth/login     — public, verifies credentials + returns token
 * GET  /api/v1/auth/me        — requires JWT, returns the current user's profile
 */

import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { registerSchema, loginSchema } from './auth.schema';

const router = Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login',    validate(loginSchema),    authController.login);
router.get('/me',        authenticate,             authController.profile);

export default router;
