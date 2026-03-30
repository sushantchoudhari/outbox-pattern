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
const healthRouter = require('./routes/health');
const applicationsRouter = require('./routes/applications');

const app = express();

app.use(express.json());

app.use('/health',       healthRouter);
app.use('/applications', applicationsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[api] Server listening on port ${PORT}`);
});
