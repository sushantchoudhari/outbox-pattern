/**
 * middlewares/requestId.middleware.ts — Request ID Injection
 * ────────────────────────────────────────────────────────────
 * Attaches a unique UUID to every incoming request as req.id.
 * Also echoes it back in the X-Request-Id response header so callers
 * can correlate their client-side log entries with server-side logs.
 *
 * If the client sends an X-Request-Id header (e.g. from an API gateway)
 * we honour it rather than generating a new one — this preserves
 * end-to-end tracing across distributed systems.
 */

import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string | undefined) ?? uuidv4();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
