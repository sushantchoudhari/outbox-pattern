'use strict';

/**
 * config/index.js — Centralised Configuration
 * ─────────────────────────────────────────────
 * All environment variables are read ONCE here and exported as a typed
 * object.  The rest of the codebase only imports from this file — never
 * directly from process.env.
 *
 * WHY?
 * - One place to audit every setting the app depends on.
 * - Easy to add defaults, parse integers, or validate on startup.
 * - Swap config sources (env vars, AWS Parameter Store, etc.) without
 *   touching application code.
 */

// Load .env file values into process.env.
// Does nothing if the variable is already set (e.g. in production).
require('dotenv').config();

const config = {
  server: {
    port:    parseInt(process.env.PORT || '3000', 10),
    env:     process.env.NODE_ENV || 'development',
  },

  auth: {
    // IMPORTANT: set a strong random value in production via the JWT_SECRET env var.
    jwtSecret:    process.env.JWT_SECRET    || 'change-me-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },

  db: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    name:     process.env.DB_NAME     || 'appdb',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },

  cors: {
    // Comma-separated list of allowed origins, e.g. "https://app.example.com"
    // Use "*" only in development — never in production.
    origin: process.env.CORS_ORIGIN || '*',
  },
};

module.exports = config;
