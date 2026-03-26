/**
 * loaders/index.ts — Startup Orchestration
 * ──────────────────────────────────────────
 * Runs every initialisation step in the correct order.
 * server.ts calls this once before starting the HTTP listener.
 *
 * ADDING A NEW LOADER (e.g. Redis, message queue):
 *   1. Create loaders/redis.loader.ts
 *   2. Import and call it here, before loadExpress().
 */

import { Application } from 'express';
import { connectDatabase } from '../database';
import { loadExpress } from './express.loader';
import { logger } from '../common/helpers/logger';

export async function initLoaders(app: Application): Promise<void> {
  // Database first — routes may depend on it being ready.
  await connectDatabase();
  logger.debug('Database loader complete');

  // Express last — we don't want to accept HTTP traffic before other
  // dependencies (DB, cache, etc.) are confirmed healthy.
  loadExpress(app);
  logger.debug('Express loader complete');
}
