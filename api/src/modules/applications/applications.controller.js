'use strict';

/**
 * applications.controller.js — Applications HTTP Handlers
 * ─────────────────────────────────────────────────────────
 * Reads req, validates input, delegates to the service, and writes res.
 * No SQL; no business rules beyond input shape checks.
 */

const { createApplication, getApplicationById } = require('./applications.service');

/**
 * POST /applications — Submit a new job application.
 */
async function create(req, res) {
  const { applicantName, applicantEmail, data = {} } = req.body;

  if (!applicantName || typeof applicantName !== 'string' ||
      !applicantEmail || typeof applicantEmail !== 'string') {
    return res.status(400).json({
      error: 'applicantName (string) and applicantEmail (string) are required',
    });
  }

  try {
    const application = await createApplication({ applicantName, applicantEmail, data });
    return res.status(201).json(application);
  } catch (err) {
    console.error('[api] Transaction rolled back:', err.message);
    return res.status(500).json({ error: 'Failed to submit application' });
  }
}

/**
 * GET /applications/:id — Retrieve a single application by UUID.
 */
async function getById(req, res) {
  const { id } = req.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid id format' });
  }

  try {
    const application = await getApplicationById(id);
    if (!application) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(application);
  } catch (err) {
    console.error('[api] Query error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { create, getById };
