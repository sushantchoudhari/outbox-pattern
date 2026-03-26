/**
 * loaders/express.loader.ts — Express Application Assembly
 * ──────────────────────────────────────────────────────────
 * Registers every piece of global middleware and all route handlers
 * onto the Express application.  Called once at startup from loaders/index.ts.
 *
 * MIDDLEWARE ORDER (matters — do not rearrange):
 *   1. Security     — helmet, cors, rate limiter
 *   2. Performance  — compression
 *   3. Body parsing — json, urlencoded
 *   4. Request ID   — must run before logging so req.id is available
 *   5. Routes       — health + versioned API routes
 *   6. Swagger       — served last among routes (non-prod only)
 *   7. 404 handler  — after all routes so it only fires for unmatched paths
 *   8. Error handler — must be the VERY LAST middleware (4-arg signature)
 */

import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { config } from '../config';
import { requestId } from '../middlewares/requestId.middleware';
import { notFound } from '../middlewares/notFound.middleware';
import { errorHandler } from '../middlewares/error.middleware';
import authRoutes from '../modules/auth/auth.routes';
import userRoutes from '../modules/user/user.routes';
import { setupSwagger } from '../docs/swagger';

export function loadExpress(app: Application): void {
  // ── 1. Security headers ──────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors({ origin: config.cors.origin, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  app.use(
    rateLimit({
      windowMs:       config.rateLimit.windowMs,
      max:            config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders:   false,
      message: { success: false, error: 'Too many requests — please try again later' },
    }),
  );

  // ── 2. Performance ────────────────────────────────────────────────────────
  app.use(compression());

  // ── 3. Body parsing ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ── 4. Request ID ─────────────────────────────────────────────────────────
  app.use(requestId);

  // ── 5. Routes ─────────────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', uptime: process.uptime(), env: config.env },
    });
  });

  app.use('/api/v1/auth',  authRoutes);
  app.use('/api/v1/users', userRoutes);

  // ── 6. API documentation (skipped in production) ─────────────────────────
  if (!config.isProduction) {
    setupSwagger(app);
  }

  // ── 7. 404 catch-all ─────────────────────────────────────────────────────
  app.use(notFound);

  // ── 8. Central error handler — MUST be last ───────────────────────────────
  app.use(errorHandler);
}
