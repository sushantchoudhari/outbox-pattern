'use strict';

/**
 * db.js — Database Connection Pool (API)
 * ────────────────────────────────────────
 * Creates and exports a single shared PostgreSQL connection pool.
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

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'appdb',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
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
