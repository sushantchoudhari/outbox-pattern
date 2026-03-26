/**
 * common/types/express.d.ts — Express Request Augmentation
 * ────────────────────────────────────────────────────────────
 * Extends Express's built-in Request interface with custom fields
 * that our middlewares attach at runtime.
 *
 * HOW THIS WORKS:
 *   TypeScript's "declaration merging" lets you extend interfaces from
 *   third-party packages without modifying them. We merge into the
 *   `express-serve-static-core` module, which is the deep package
 *   that Express's own types extend.
 *
 *   IMPORTANT: The `export {}` below makes this file a MODULE (not a
 *   global script). Without it, TypeScript treats the `declare module`
 *   block as an ambient declaration that replaces the real module,
 *   stripping all existing methods from Request, Response, and Application.
 *
 * FIELDS ATTACHED BY:
 *   req.id   — requestId.middleware.ts (UUID for every request)
 *   req.user — auth.middleware.ts      (decoded JWT payload)
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** Unique request identification, injected by the requestId middleware. */
    id: string;
    /** Decoded JWT payload, injected by the authenticate middleware. */
    user?: { id: string; role: string };
  }
}

// This export makes the file a MODULE so the declaration above augments
// express-serve-static-core instead of replacing it.
export {};
