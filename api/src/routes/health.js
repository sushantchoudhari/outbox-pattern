'use strict';

/**
 * routes/health.js — Health Check Route
 * ───────────────────────────────────────
 * Liveness probe for load balancers, Docker health checks,
 * and Kubernetes probes. Returns 200 while the process is alive.
 */

const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => res.json({ status: 'ok' }));

module.exports = router;
