/**
 * session/redisClient.ts — Redis Client Singleton
 * ─────────────────────────────────────────────────
 * Creates and exports one shared node-redis v4 client for the process.
 * Callers must call connectRedis() (loaders/redis.loader.ts) before the
 * first command; after that the client is fully reusable.
 */

import { createClient } from 'redis';
import { config } from '../config';
import { logger } from '../common/helpers/logger';

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

/**
 * Returns the shared Redis client, creating it on first call.
 * The client is not connected yet — call client.connect() in a loader.
 */
export function getRedisClient(): RedisClient {
  if (!client) {
    client = createClient({ url: config.redis.url });

    client.on('error',       (err: Error) => logger.error({ err }, 'Redis client error'));
    client.on('connect',     ()           => logger.info('Redis connected'));
    client.on('reconnecting',()           => logger.warn('Redis reconnecting'));
    client.on('ready',       ()           => logger.debug('Redis ready'));
  }
  return client;
}
