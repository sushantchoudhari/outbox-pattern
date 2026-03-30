/**
 * modules/auth/auth.routes.ts — Authentication Route Definitions
 * ────────────────────────────────────────────────────────────────
 *
 * POST /api/v1/auth/register  — public, creates account + sets Redis session
 * POST /api/v1/auth/login     — public, verifies credentials + sets Redis session
 * GET  /api/v1/auth/me        — requires JWT, returns the current user's profile
 * POST /api/v1/auth/logout    — requires session, destroys Redis session + clears cookie
 */

import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { authenticateSession } from '../../middlewares/sessionAuth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { registerSchema, loginSchema } from './auth.schema';

const router = Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login',    validate(loginSchema),    authController.login);
router.get('/me',        authenticate,             authController.profile);
router.post('/logout',   authenticateSession,      authController.logout);

export default router;
