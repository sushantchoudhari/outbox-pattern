'use strict';

/**
 * applications.service.js — Applications Business Logic
 * ───────────────────────────────────────────────────────
 * Orchestrates the transactional outbox write and retrieval logic.
 * Throws on failure; never writes HTTP responses.
 */

const pool = require('../../db');
const {
  insertApplication,
  insertOutboxEvent,
  findApplicationById,
} = require('./applications.repository');

/**
 * Create a new application and record the outbox event in a single transaction.
 * Both writes succeed or both are rolled back — the outbox guarantee.
 *
 * @returns {object} The saved application row.
 * @throws  On transaction failure (caller maps to HTTP 500).
 */
async function createApplication({ applicantName, applicantEmail, data }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const saved = await insertApplication(client, { applicantName, applicantEmail, data });

    await insertOutboxEvent(client, {
      aggregateType: 'Application',
      aggregateId:   saved.id,
      eventType:     'ApplicationSubmitted',
      payload: {
        applicationId:  saved.id,
        applicantName:  saved.applicant_name,
        applicantEmail: saved.applicant_email,
        status:         saved.status,
        data:           saved.data,
        createdAt:      saved.created_at,
      },
    });

    await client.query('COMMIT');
    return saved;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieve an application by its UUID. Returns null if not found.
 */
async function getApplicationById(id) {
  return findApplicationById(id);
}

module.exports = { createApplication, getApplicationById };
