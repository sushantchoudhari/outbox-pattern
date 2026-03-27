'use strict';

/**
 * db.js — Database Connection Pool (Worker)
 * ──────────────────────────────────────────
 * Creates and exports a single shared PostgreSQL connection pool.
 *
 * CONFIGURATION (all values from environment variables — never hardcoded)
 * ────────────────────────────────────────────────────────────────────────
 * Required in every environment:
 *   DB_HOST      Hostname of the PostgreSQL server
 *   DB_NAME      Database name
 *   DB_USER      Database user
 *   DB_PASSWORD  Database password
 *
 * Optional (sensible default provided):
 *   DB_PORT      PostgreSQL port (default: 5432 — the standard PG port)
 *
 * In production these are injected by the container orchestration platform
 * (ECS task definition, Kubernetes secret, etc.) or populated from SSM
 * Parameter Store by config.js before this module is required.
 *
 * In local development set them in your .env.development file or via the
 * Docker Compose environment block — never commit real credentials.
 *
 * WHY A POOL?
 * ───────────
 * Opening a new database connection for every query is expensive — TCP
 * handshake + PostgreSQL auth on every call.  A pool keeps a small number
 * of connections open and reuses them across poll cycles.
 *
 * WHY MAX 5?
 * ──────────
 * The worker is single-threaded and processes one batch at a time, so it
 * only ever needs one connection.  5 slots give a small safety margin
 * without wasting database connection resources.
 *
 * TIMEOUTS
 * ────────
 * idleTimeoutMillis:       close connections idle for 30 s to prevent stale
 *                          connections accumulating on a quiet system.
 * connectionTimeoutMillis: throw after 3 s if no connection is free — surfaces
 *                          pool exhaustion immediately instead of hanging.
 */

const { Pool } = require('pg');

// ─── Env var validation ───────────────────────────────────────────────────────
// Required DB variables — no hardcoded fallbacks.
// In development the defaults in your .env.development file provide these;
// in production the container / SSM loader must supply them.
// If any are missing the process exits immediately with a clear message rather
// than connecting to a wrong host or authenticating as the wrong user.

const REQUIRED_DB_VARS = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

const missing = REQUIRED_DB_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[db] Missing required environment variable(s): ${missing.join(', ')}\n` +
    '     Set them in your .env.development file (local) or container ' +
    'configuration (production).',
  );
  process.exit(1);
}

// ─── Pool ─────────────────────────────────────────────────────────────────────

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432', 10),  // 5432 is the PG standard
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:                     5,       // max simultaneous connections
  idleTimeoutMillis:      30_000,   // close idle connections after 30 s
  connectionTimeoutMillis: 3_000,   // throw if no connection available after 3 s
});

// Log pool-level errors (e.g. the database server closed an idle connection).
// The pool handles reconnection automatically — this handler ensures the event
// appears in logs instead of being swallowed silently.
pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

module.exports = pool;
