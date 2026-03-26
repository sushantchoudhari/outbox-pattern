'use strict';

/**
 * index.js — API Server Entry Point
 * ───────────────────────────────────
 * Starts the Express HTTP server.  The server exposes two routes:
 *
 *   GET  /health          — liveness probe for load balancers / Kubernetes
 *   POST /applications    — submit a new job application
 *   GET  /applications/:id — retrieve a submitted application by ID
 *
 * All business logic lives in ./routes/applications.js.
 * Database connection configuration lives in ./db.js.
 */

const express = require('express');
const applicationsRouter = require('./routes/applications');

const app = express();

// Parse incoming JSON request bodies and make them available as req.body.
app.use(express.json());

// Simple health check — returns 200 as long as the process is alive.
// Used by Docker health checks, Kubernetes liveness probes, and load balancers.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// All /applications routes are handled by the applications router.
app.use('/applications', applicationsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[api] Server listening on port ${PORT}`);
});
