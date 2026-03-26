'use strict';

/**
 * Database connection pool — worker
 *
 * A single shared pg.Pool is created once at module load and reused for
 * every poll cycle.  Pooling avoids the cost of opening and closing a TCP
 * connection on every database transaction.
 *
 * Pool sizing rationale:
 *   max: 5  — the worker is single-threaded and processes one batch at a time,
 *             so more than 5 connections provides no throughput benefit and
 *             wastes database connection slots.
 *
 * Timeout rationale:
 *   idleTimeoutMillis (30 s)  — connections idle longer than this are closed
 *                               and returned to the OS; prevents accumulating
 *                               stale connections on a quiet system.
 *   connectionTimeoutMillis (3 s) — if no connection is available within 3 s
 *                               the pool throws, the poll cycle catches it,
 *                               logs the error, and retries on the next tick.
 *
 * All configuration is injected via environment variables so the same image
 * works in local Docker Compose and production without rebuilding.
 */

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'appdb',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  // Maximum number of clients the pool will hold open simultaneously.
  max: 5,
  // A client idle for longer than this is destroyed (milliseconds).
  idleTimeoutMillis:      30_000,
  // Throw if a client cannot be acquired from the pool within this time.
  connectionTimeoutMillis: 3_000,
});

// Log unexpected client errors (e.g. the database server restarted and
// terminated an idle connection).  The pool handles reconnection automatically;
// this handler exists only to surface the error in logs rather than silently
// swallowing it.
pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

module.exports = pool;
