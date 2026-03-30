/**
 * config/index.ts — Environment Configuration
 * ─────────────────────────────────────────────
 * This is the single source of truth for all environment variables.
 *
 * HOW IT WORKS:
 *   1. Reads NODE_ENV to determine which .env file to load
 *      (.env.development, .env.testing, .env.preprod, .env.production).
 *   2. Parses and validates every required variable with Zod.
 *   3. If any variable is missing or invalid, logs the problems and
 *      calls process.exit(1) — the app won't start with bad config.
 *
 * WHY FAIL FAST?
 *   Discovering a missing JWT_SECRET three hours after deployment is far worse
 *   than a clear startup error that pinpoints exactly what is wrong.
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// ─── Load the correct .env file ───────────────────────────────────────────────

const nodeEnv = process.env['NODE_ENV'] ?? 'development';
const envFile = path.resolve(__dirname, '../..', `.env.${nodeEnv}`);

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
} else {
  // Fall back to a generic .env if the environment-specific file doesn't exist.
  dotenv.config();
}

// ─── Env schema ───────────────────────────────────────────────────────────────

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'testing', 'preprod', 'production'])
    .default('development'),

  PORT: z.string().regex(/^\d+$/, 'PORT must be a numeric string').default('3000'),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).default('900000'),
  RATE_LIMIT_MAX: z.string().regex(/^\d+$/).default('100'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),

  // Logging — 'silent' suppresses all output (used in tests)
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Database — optional; app runs in-memory when omitted
  DATABASE_URL: z.string().optional(),

  // Redis — session store (ElastiCache in production, local Redis in development)
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Session
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_MAX_AGE_MS: z.string().regex(/^\d+$/).default('86400000'), // 24 h
});

// ─── Validate ─────────────────────────────────────────────────────────────────

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Use console.error here — logger isn't available yet (it imports this module)
  console.error('\n❌  Invalid environment configuration — server will not start:\n');
  for (const issue of parsed.error.issues) {
    console.error(`   • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error(`\n   Loaded from: ${fs.existsSync(envFile) ? envFile : '.env (fallback)'}\n`);
  process.exit(1);
}

const env = parsed.data;

// ─── Exported config object ───────────────────────────────────────────────────

export const config = {
  env:  env.NODE_ENV,
  port: parseInt(env.PORT, 10),

  jwt: {
    secret:    env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  rateLimit: {
    windowMs: parseInt(env.RATE_LIMIT_WINDOW_MS, 10),
    max:      parseInt(env.RATE_LIMIT_MAX, 10),
  },

  cors: {
    origin: env.CORS_ORIGIN,
  },

  log: {
    level: env.LOG_LEVEL,
  },

  db: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  session: {
    secret:   env.SESSION_SECRET,
    maxAgeMs: parseInt(env.SESSION_MAX_AGE_MS, 10),
  },

  // Convenience booleans used throughout the codebase
  isDevelopment: env.NODE_ENV === 'development',
  isTest:        env.NODE_ENV === 'testing',
  isPreprod:     env.NODE_ENV === 'preprod',
  isProduction:  env.NODE_ENV === 'production',
} as const;
