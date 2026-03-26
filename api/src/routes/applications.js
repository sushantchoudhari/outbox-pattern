'use strict';

/**
 * routes/applications.js — Application Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles two HTTP routes:
 *
 *   POST /applications     — Submit a new job application.
 *   GET  /applications/:id — Retrieve an application by its UUID.
 *
 * THE KEY IDEA: ATOMIC WRITE (Transactional Outbox Pattern)
 * ──────────────────────────────────────────────────────────
 * When a new application is submitted, TWO things must happen together:
 *
 *   1. Save the application to the `applications` table.
 *   2. Write an event to the `outbox_events` table so the worker can
 *      later publish it to SNS (which triggers the Salesforce integration).
 *
 * Both writes happen inside a single database transaction.  This guarantees
 * they always succeed or fail together — you will NEVER end up with an
 * application saved but no corresponding event, or vice versa.
 *
 * The worker picks up the event row and publishes it to SNS asynchronously.
 */

const { Router } = require('express');
const pool = require('../db');

const router = Router();

// ─── POST /applications ───────────────────────────────────────────────────────

/**
 * Submit a new job application.
 *
 * Expects a JSON body:
 *   { applicantName: string, applicantEmail: string, data?: object }
 *
 * Returns 201 with the saved application row on success.
 * Returns 400 if required fields are missing or have the wrong type.
 * Returns 500 if the database transaction fails.
 */
router.post('/', async (req, res) => {
  const { applicantName, applicantEmail, data = {} } = req.body;

  // Validate required fields before touching the database.
  if (!applicantName || typeof applicantName !== 'string' ||
      !applicantEmail || typeof applicantEmail !== 'string') {
    return res.status(400).json({
      error: 'applicantName (string) and applicantEmail (string) are required',
    });
  }

  // We need a dedicated connection (not pool.query) because all three
  // queries — BEGIN, INSERT, INSERT, COMMIT — must run on the SAME connection.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Write 1: Save the application ─────────────────────────────────────────
    // RETURNING * gives us back the generated id, created_at, etc. without
    // a second SELECT round-trip.
    const { rows: [savedApplication] } = await client.query(
      `INSERT INTO applications (applicant_name, applicant_email, data)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [applicantName, applicantEmail, JSON.stringify(data)],
    );

    // ── Write 2: Record the outbox event (same transaction) ───────────────────
    // This row tells the worker "there is a new ApplicationSubmitted event
    // that needs to be sent to SNS".  Because it's in the same transaction,
    // it's impossible for an application to exist without a matching event,
    // or for an event to exist without its application.
    await client.query(
      `INSERT INTO outbox_events
         (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [
        'Application',                     // what kind of domain object this is
        savedApplication.id,               // the ID of that object
        'ApplicationSubmitted',            // what happened to it
        JSON.stringify({                   // the full event payload the consumer needs
          applicationId:  savedApplication.id,
          applicantName:  savedApplication.applicant_name,
          applicantEmail: savedApplication.applicant_email,
          status:         savedApplication.status,
          data:           savedApplication.data,
          createdAt:      savedApplication.created_at,
        }),
      ],
    );

    // Both writes succeeded — commit and return the saved application.
    await client.query('COMMIT');
    return res.status(201).json(savedApplication);

  } catch (err) {
    // Something failed — roll back both writes so nothing is partially saved.
    await client.query('ROLLBACK');
    console.error('[api] Transaction rolled back:', err.message);
    return res.status(500).json({ error: 'Failed to submit application' });

  } finally {
    // Always return the connection to the pool, even if an error occurred.
    client.release();
  }
});

// ─── GET /applications/:id ────────────────────────────────────────────────────

/**
 * Retrieve a single application by its UUID.
 *
 * Returns 200 with the application row on success.
 * Returns 400 if the id is not a valid UUID format.
 * Returns 404 if no application exists with that id.
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  // Reject obviously invalid ids before they reach the database.
  // This also prevents path traversal / SQL injection attempts on the id.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid id format' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM applications WHERE id = $1',
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json(rows[0]);

  } catch (err) {
    console.error('[api] Query error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

