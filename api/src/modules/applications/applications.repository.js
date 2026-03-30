'use strict';

/**
 * applications.repository.js — Applications Data Access
 * ───────────────────────────────────────────────────────
 * All SQL queries for the applications and outbox_events tables.
 * No business logic; no HTTP concerns.
 */

const pool = require('../../db');

/**
 * Insert a new application row and return the saved record.
 * Requires an active pg PoolClient so this can participate in a transaction.
 */
async function insertApplication(client, { applicantName, applicantEmail, data }) {
  const { rows: [row] } = await client.query(
    `INSERT INTO applications (applicant_name, applicant_email, data)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [applicantName, applicantEmail, JSON.stringify(data)],
  );
  return row;
}

/**
 * Insert an outbox event row.
 * Requires an active pg PoolClient so this can participate in a transaction.
 */
async function insertOutboxEvent(client, { aggregateType, aggregateId, eventType, payload }) {
  await client.query(
    `INSERT INTO outbox_events
       (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4)`,
    [aggregateType, aggregateId, eventType, JSON.stringify(payload)],
  );
}

/**
 * Find an application by its UUID. Returns null if no matching row exists.
 */
async function findApplicationById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM applications WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

module.exports = { insertApplication, insertOutboxEvent, findApplicationById };
