/**
 * common/helpers/response.helper.ts — HTTP Response Formatter
 * ─────────────────────────────────────────────────────────────
 * Centralises the shape of every API response so that all endpoints
 * return the same consistent envelope regardless of who wrote them.
 *
 * SUCCESS ENVELOPE:  { success: true,  data: T,           meta?: {...} }
 * ERROR ENVELOPE:    { success: false, error: string,    details?: unknown }
 *
 * Controllers import these helpers and never call res.json() directly.
 * The error envelope is produced by the central error middleware instead.
 */

import { Response } from 'express';

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * 200 OK — general successful response (read operations, updates).
 */
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  const body: SuccessBody<T> = { success: true, data };
  if (meta) body.meta = meta;
  res.status(200).json(body);
}

/**
 * 201 Created — resource was successfully created.
 */
export function created<T>(res: Response, data: T): void {
  const body: SuccessBody<T> = { success: true, data };
  res.status(201).json(body);
}

/**
 * 204 No Content — operation succeeded with no body to return (e.g. DELETE).
 */
export function noContent(res: Response): void {
  res.status(204).send();
}
