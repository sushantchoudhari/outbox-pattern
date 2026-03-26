/**
 * database/index.ts — Database Connection Template
 * ──────────────────────────────────────────────────
 * The app ships with an in-memory repository — no database required to run.
 * When you're ready to connect to PostgreSQL, this file is the only place
 * that needs to change.
 *
 * ENABLING POSTGRESQL:
 *   1. npm install pg
 *   2. Uncomment the pool setup below.
 *   3. Set DATABASE_URL in your .env.* file.
 *   4. Replace Map operations in user.repository.ts with pool.query() calls
 *      (examples are provided in the comments there).
 */

// import { Pool } from 'pg';
// import { config } from '../config';
// import { logger } from '../common/helpers/logger';
//
// export const pool = new Pool({
//   connectionString:      config.db.url,
//   max:                   10,
//   idleTimeoutMillis:     30_000,
//   connectionTimeoutMillis: 3_000,
// });

import { logger } from '../common/helpers/logger';
import { config } from '../config';

export async function connectDatabase(): Promise<void> {
  if (!config.db.url) {
    logger.info('DATABASE_URL not set — using in-memory store');
    return;
  }

  // Uncomment when pool is enabled:
  // await pool.query('SELECT 1');
  // logger.info('PostgreSQL connected');
  logger.info({ url: config.db.url }, 'DATABASE_URL found — configure pool in database/index.ts');
}
