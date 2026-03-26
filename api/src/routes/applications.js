'use strict';

const { Router } = require('express');
const pool = require('../db');

const router = Router();

/**
 * POST /applications
 *
 * Atomically inserts one row into `applications` and one row into
 * `outbox_events` inside a single database transaction.
 *
 * If either insert fails the whole transaction is rolled back, so the
 * two tables never diverge.
 */
router.post('/', async (req, res) => {
  const { applicantName, applicantEmail, data = {} } = req.body;

  if (!applicantName || typeof applicantName !== 'string' ||
      !applicantEmail || typeof applicantEmail !== 'string') {
    return res.status(400).json({
      error: 'applicantName (string) and applicantEmail (string) are required',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Write business data ────────────────────────────────
    const { rows: [application] } = await client.query(
      `INSERT INTO applications (applicant_name, applicant_email, data)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [applicantName, applicantEmail, JSON.stringify(data)],
    );

    // ── 2. Write outbox event (same transaction) ──────────────
    await client.query(
      `INSERT INTO outbox_events
         (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [
        'Application',
        application.id,
        'ApplicationSubmitted',
        JSON.stringify({
          applicationId:  application.id,
          applicantName:  application.applicant_name,
          applicantEmail: application.applicant_email,
          status:         application.status,
          data:           application.data,
          createdAt:      application.created_at,
        }),
      ],
    );

    await client.query('COMMIT');
    return res.status(201).json(application);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[api] Transaction rolled back:', err.message);
    return res.status(500).json({ error: 'Failed to submit application' });
  } finally {
    client.release();
  }
});

/**
 * GET /applications/:id
 * Returns a single application by UUID.
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  // Basic UUID format guard to avoid malformed queries
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid id format' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM applications WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[api] Query error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
