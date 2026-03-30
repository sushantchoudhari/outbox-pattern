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
 *   req.id      — requestId.middleware.ts (UUID for every request)
 *   req.user    — auth.middleware.ts      (decoded JWT payload)
 *   req.session — express-session        (Redis-backed session data)
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** Unique request identification, injected by the requestId middleware. */
    id: string;
    /** Decoded JWT payload, injected by the authenticate middleware. */
    user?: { id: string; role: string };
  }
}

/**
 * Custom fields stored in every Redis session (set at login, cleared at logout).
 *
 * SESSION STATE (per architecture diagram):
 *   userId      — identifies the authenticated user across ECS tasks
 *   role        — controls route-level authorization without a DB round-trip
 *   loginAt     — Unix ms timestamp; used for session age assertions
 *   csrfToken   — random token validated via X-CSRF-Token header on mutations
 */
declare module 'express-session' {
  interface SessionData {
    userId:    string;
    role:      string;
    loginAt:   number;
    csrfToken: string;
  }
}

// This export makes the file a MODULE so the declaration above augments
// express-serve-static-core instead of replacing it.
export {};
