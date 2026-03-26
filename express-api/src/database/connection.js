'use strict';

/**
 * database/connection.js — PostgreSQL Connection Pool
 * ─────────────────────────────────────────────────────
 * Exports a shared pg.Pool instance.
 *
 * The in-memory user repository (src/repositories/user.repository.js)
 * does NOT use this pool — you can run the API out of the box without a
 * database.  This file is here as a ready-to-use template: import the pool
 * in any repository that needs a real database and call pool.query() or
 * pool.connect() as needed.
 *
 * USAGE IN A REPOSITORY:
 *   const pool = require('../database/connection');
 *   const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
 */

const { Pool } = require('pg');
const config  = require('../config');
const logger  = require('../utils/logger');

const pool = new Pool({
  host:                    config.db.host,
  port:                    config.db.port,
  database:                config.db.name,
  user:                    config.db.user,
  password:                config.db.password,
  max:                     10,      // max simultaneous connections
  idleTimeoutMillis:      30_000,   // close idle connections after 30 s
  connectionTimeoutMillis: 3_000,   // throw if no free connection within 3 s
});

// Log pool-level errors (e.g. the DB server restarted mid-connection).
// The pool reconnects automatically — this just makes the event visible.
pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

module.exports = pool;
