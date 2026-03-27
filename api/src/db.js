'use strict';

/**
 * db.js — Database Connection Pool (API)
 * ────────────────────────────────────────
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
 * (ECS task definition, Kubernetes secret, etc.).
 * In local development set them in your .env.development file or via the
 * Docker Compose environment block — never commit real credentials.
 *
 * WHY A POOL?
 * ───────────
 * Opening a fresh database connection for every HTTP request is slow and
 * resource-intensive.  A pool keeps a set of connections open and lends
 * one out to each request, returning it when done.
 *
 * WHY MAX 10?
 * ───────────
 * The API handles multiple concurrent HTTP requests, so it benefits from
 * having more connections available than the single-threaded worker.
 * 10 is a sensible default — tune based on your actual concurrency.
 *
 * TIMEOUTS
 * ────────
 * idleTimeoutMillis: connections unused for 30 s are closed to avoid
 *   accumulating stale connections on a quiet system.
 * connectionTimeoutMillis: if all 10 connections are busy and a new request
 *   waits more than 3 s, an error is thrown immediately rather than queuing
 *   indefinitely — this surfaces overload problems quickly.
 */

const { Pool } = require('pg');

// ─── Env var validation ───────────────────────────────────────────────────────
// Required DB variables — no hardcoded fallbacks.
// In development your .env.development file / Docker Compose provides these;
// in production the container configuration must supply them.

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
  max:                     10,      // max simultaneous connections
  idleTimeoutMillis:      30_000,   // close idle connections after 30 s
  connectionTimeoutMillis: 3_000,   // throw if no connection available after 3 s
});

// Log pool-level errors (e.g. the database server closed an idle connection).
// These are not request errors — the pool will reconnect automatically.
// This handler ensures the event appears in logs instead of being swallowed.
pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

module.exports = pool;
