/**
 * config/env.schema.ts — Step 2: Environment Variable Schema
 * ─────────────────────────────────────────────────────────────
 * Sole responsibility: declare what every environment variable must look like.
 *
 * This file contains only the Zod schema and its inferred TypeScript type.
 * It does not load files, does not read process.env, and does not export
 * a config object — those belong to other steps in the pipeline.
 *
 * To add a new variable:
 *   1. Add it here with its type, default value, and validation rule.
 *   2. Add the matching key to the config object in config/index.ts.
 *   3. Add it to .env.example.
 */

import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'testing', 'preprod', 'production'])
    .default('development'),

  PORT: z.string().regex(/^\d+$/, 'PORT must be a numeric string').default('3000'),

  // ── Auth ──────────────────────────────────────────────────────────────────
  JWT_SECRET:    z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),

  // ── Rate limiting ─────────────────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).default('900000'),
  RATE_LIMIT_MAX:       z.string().regex(/^\d+$/).default('100'),

  // ── CORS ──────────────────────────────────────────────────────────────────
  CORS_ORIGIN: z.string().default('*'),

  // ── Logging — 'silent' suppresses all output (used in tests) ─────────────
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // ── Database — optional; app runs in-memory when omitted ──────────────────
  DATABASE_URL: z.string().optional(),

  // ── Redis — session store (ElastiCache in production) ─────────────────────
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // ── Session ───────────────────────────────────────────────────────────────
  SESSION_SECRET:    z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_MAX_AGE_MS: z.string().regex(/^\d+$/).default('86400000'), // 24 h
});

/** The validated, typed shape of all environment variables. */
export type Env = z.infer<typeof envSchema>;
