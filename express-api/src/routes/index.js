'use strict';

/**
 * routes/index.js — Root API Router
 * ──────────────────────────────────
 * This file mounts every feature router onto a versioned path
 * and adds the health-check endpoint.  app.js mounts this entire
 * router under /api, so the full paths become:
 *
 *   GET  /api/health       → health check (no auth required)
 *   *    /api/v1/users/**  → user resource routes
 *
 * ADDING A NEW RESOURCE:
 *   1. Create src/routes/widget.routes.js
 *   2. const widgetRoutes = require('./widget.routes');
 *   3. router.use('/v1/widgets', widgetRoutes);
 */

const { Router }  = require('express');
const userRoutes  = require('./user.routes');

const router = Router();

/**
 * GET /api/health
 * Quick liveness probe — used by load balancers and orchestrators (e.g. ECS,
 * Kubernetes) to decide whether to route traffic to this instance.
 * No authentication required.
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status:  'ok',
      uptime:  process.uptime(),     // seconds since process started
      env:     process.env.NODE_ENV,
    },
  });
});

// Mount the user resource under a versioned prefix.
// Versioning lets you deploy breaking changes as /v2/users without
// removing /v1/users immediately (backward compatibility).
router.use('/v1/users', userRoutes);

module.exports = router;
