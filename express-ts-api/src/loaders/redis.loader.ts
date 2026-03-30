/**
 * loaders/redis.loader.ts — Redis Startup Health Check
 * ──────────────────────────────────────────────────────
 * Connects the Redis client and confirms it is reachable before the
 * Express server begins accepting HTTP traffic.
 *
 * Called from loaders/index.ts before loadExpress() to guarantee that
 * session storage is available before any route handler runs.
 */

import { getRedisClient } from '../session/redisClient';
import { logger } from '../common/helpers/logger';

/**
 * Opens the Redis connection and sends a PING to verify reachability.
 * Throws on connection failure so initLoaders() fails fast.
 */
export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  await client.connect();
  await client.ping();
  logger.info('Redis loader complete');
}
