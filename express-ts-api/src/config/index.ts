/**
 * config/index.ts — Step 3: Validate + Export Application Config
 * ───────────────────────────────────────────────────────────────
 * Orchestrates the three-step configuration pipeline:
 *
 *   Step 1 — env.loader.ts   Load the correct .env file into process.env
 *   Step 2 — env.schema.ts   Declare what every variable must look like (Zod)
 *   Step 3 — here            Validate process.env against the schema,
 *                             then export a typed, shaped config object
 *
 * WHY FAIL FAST?
 *   Discovering a missing JWT_SECRET three hours after deployment is far worse
 *   than a clear startup error that pinpoints exactly what is wrong.
 *
 * All other modules import from this file — they never read process.env directly.
 */

import { loadEnvFile } from './env.loader';
import { envSchema } from './env.schema';

// ─── Step 1: Load .env file ───────────────────────────────────────────────────
// Must run before safeParse so that process.env is fully populated.

const loadedFrom = loadEnvFile();

// ─── Step 2 + 3: Validate process.env against the schema ─────────────────────

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Use console.error here — logger isn't available yet (it imports this module)
  console.error('\n❌  Invalid environment configuration — server will not start:\n');
  for (const issue of parsed.error.issues) {
    console.error(`   • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error(`\n   Loaded from: ${loadedFrom}\n`);
  process.exit(1);
}

const env = parsed.data;

// ─── Step 4: Export a shaped, typed config object ────────────────────────────
// The rest of the codebase imports `config` — never process.env directly.

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

