/**
 * middlewares/notFound.middleware.ts — 404 Catch-All
 * ─────────────────────────────────────────────────────
 * Catches any request that didn't match a registered route and returns
 * a consistent 404 JSON response.  Must be registered AFTER all routes.
 */

import { Request, Response } from 'express';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error:   `Route ${req.method} ${req.originalUrl} not found`,
  });
}
