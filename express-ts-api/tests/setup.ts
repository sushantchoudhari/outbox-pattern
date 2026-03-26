/**
 * tests/setup.ts — Test Environment Bootstrap
 * ──────────────────────────────────────────────
 * Runs before every test file (configured in jest.config.ts as setupFiles).
 * Sets the minimum required environment variables so config/index.ts
 * passes Zod validation without needing a real .env.testing file on disk.
 *
 * NOTE: These values are for tests ONLY — never use them in production.
 */

process.env['NODE_ENV']    = 'testing';
process.env['PORT']        = '3001';
process.env['JWT_SECRET']  = 'test-secret-key-that-is-at-least-thirty-two-chars';
process.env['LOG_LEVEL']   = 'silent';
process.env['CORS_ORIGIN'] = '*';
process.env['RATE_LIMIT_WINDOW_MS'] = '900000';
process.env['RATE_LIMIT_MAX']       = '10000';
