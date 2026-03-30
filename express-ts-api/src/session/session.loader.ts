/**
 * session/session.loader.ts — Express-Session + Redis Store Configuration
 * ─────────────────────────────────────────────────────────────────────────
 * Builds the configured express-session middleware backed by ElastiCache Redis.
 *
 * SESSION COOKIE PROPERTIES (matching the architecture diagram):
 *   name:              'sid'     — hides the session library from clients
 *   httpOnly:          true      — JS cannot read the cookie (XSS defence)
 *   secure:            true/false— HTTPS-only in production (behind ALB)
 *   sameSite:          'strict'  — browser only sends cookie on same-origin requests
 *   maxAge:            from env  — controlled expiry
 *
 * REDIS STORE:
 *   - Sessions are stored in ElastiCache Redis keyed by sessionId.
 *   - Any ECS task that receives a request can retrieve the same session data.
 *   - ECS tasks are fully stateless — no in-memory session state.
 */

import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { config } from '../config';
import { getRedisClient } from './redisClient';

/**
 * Returns a configured express-session middleware instance wired to Redis.
 * Call once and register on the Express app via app.use().
 */
export function buildSessionMiddleware(): ReturnType<typeof session> {
  const store = new RedisStore({ client: getRedisClient() });

  return session({
    store,

    // 'sid' prevents disclosing the session library name in the Set-Cookie header.
    name: 'sid',

    // Server-side secret used to sign the sessionId cookie value.
    // Changing this invalidates all existing sessions.
    secret: config.session.secret,

    // Do not re-save sessions that were not modified during the request.
    // Reduces unnecessary Redis write load.
    resave: false,

    // Do not save a session until data is first written to it (after login).
    // Prevents Redis from filling up with empty sessions from unauthenticated visitors.
    saveUninitialized: false,

    cookie: {
      // JS cannot access this cookie — mitigates XSS token theft.
      httpOnly: true,

      // In production the API runs behind the ALB which terminates TLS.
      // app.set('trust proxy', 1) in express.loader.ts ensures Express
      // treats the forwarded request as HTTPS so this flag is honoured.
      secure: config.isProduction,

      // Browser only sends the cookie on same-site navigation.
      // First layer of CSRF protection (the X-CSRF-Token header is the second).
      sameSite: 'strict',

      // Session TTL — default 24 h, configurable via SESSION_MAX_AGE_MS.
      maxAge: config.session.maxAgeMs,
    },
  });
}
