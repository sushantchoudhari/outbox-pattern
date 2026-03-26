'use strict';

/**
 * app.js — Express Application Setup
 * ────────────────────────────────────
 * This file creates and configures the Express app object WITHOUT starting
 * the HTTP server.  Keeping app and server separate makes the app easy to
 * import in tests (no port binding needed).
 *
 * MIDDLEWARE ORDER MATTERS:
 *   helmet + cors  — applied first, before any request processing
 *   morgan         — logs requests (skipped in test env to keep output clean)
 *   body parsers   — must run before route handlers try to read req.body
 *   routes         — actual API logic
 *   notFound       — catches requests that didn't match any route
 *   errorHandler   — MUST be last; catches errors forwarded via next(err)
 */

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');

const config       = require('./config');
const router       = require('./routes');
const errorHandler = require('./middlewares/error.middleware');
const notFound     = require('./middlewares/notFound.middleware');

const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
// helmet() sets ~15 HTTP response headers that defend against common web
// vulnerabilities (XSS, clickjacking, MIME sniffing, etc.).
app.use(helmet());

// Configure CORS — in production set CORS_ORIGIN to your frontend domain(s).
// Example: CORS_ORIGIN=https://app.example.com
app.use(cors({
  origin:  config.cors ? config.cors.origin : (process.env.CORS_ORIGIN || '*'),
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// ── Request logging ──────────────────────────────────────────────────────────
// morgan 'dev' format: "GET /api/health 200 4ms" — human-readable for terminals.
// In production, switch to 'combined' and pipe output to a log aggregator.
if (config.server.env !== 'test') {
  app.use(morgan('dev'));
}

// ── Body parsers ─────────────────────────────────────────────────────────────
// Parse JSON bodies (Content-Type: application/json).  1mb limit prevents
// large-payload denial-of-service attacks.
app.use(express.json({ limit: '1mb' }));

// Parse URL-encoded bodies (HTML form submissions).
app.use(express.urlencoded({ extended: false }));

// ── API routes ───────────────────────────────────────────────────────────────
// All routes are prefixed with /api so they're easily distinguishable from
// any static-file serving you might add later.
app.use('/api', router);

// ── 404 + error handling ─────────────────────────────────────────────────────
// notFound must come AFTER all routes — it catches anything that fell through.
app.use(notFound);
// errorHandler must be LAST and must declare 4 parameters (err, req, res, next).
app.use(errorHandler);

module.exports = app;
