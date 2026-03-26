'use strict';

/**
 * db.js — Database Connection Pool (Worker)
 * ──────────────────────────────────────────
 * Creates and exports a single shared PostgreSQL connection pool.
 *
 * WHY A POOL?
 * ───────────
 * Opening a new database connection for every query is expensive — it
 * involves a TCP handshake and PostgreSQL authentication.  A pool keeps
 * a small number of connections open and reuses them, which is much faster.
 *
 * WHY MAX 5?
 * ──────────
 * The worker processes events sequentially in a single thread, so it only
 * ever needs one connection at a time.  5 slots give a small safety margin
 * without wasting precious database connection resources.
 *
 * TIMEOUTS?
 * ─────────
 * idleTimeoutMillis: if a connection sits unused for 30 seconds, close it.
 *   This prevents stale connections accumulating on an idle system.
 * connectionTimeoutMillis: if no connection is free within 3 seconds, throw.
 *   This surfaces pool exhaustion quickly rather than hanging forever.
 */

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'appdb',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max:                     5,       // max simultaneous connections
  idleTimeoutMillis:      30_000,   // close idle connections after 30 s
  connectionTimeoutMillis: 3_000,   // throw if no connection available after 3 s
});

// Log pool-level errors (e.g. database server restarted mid-connection).
// The pool handles reconnection on its own — this handler just makes the
// error visible in logs instead of swallowing it silently.
pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

module.exports = pool;
