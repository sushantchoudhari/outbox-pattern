'use strict';

/**
 * outboxRepository.js — Outbox Database Operations
 * ──────────────────────────────────────────────────
 * Responsibility: all SQL queries against the outbox_events table.
 *
 * This module knows ONLY about the database — it has no knowledge of SNS,
 * poll timing, or business rules.
 *
 * WHY RECEIVE client AS AN ARGUMENT?
 * ───────────────────────────────────
 * Both functions must run inside the same database transaction that the
 * caller (outboxPublisher.js) opens.  Passing the client in means these
 * functions don't manage transactions themselves — they are pure data-access
 * helpers that work with whatever connection they are given.
 */

/**
 * Fetches the next batch of unpublished outbox events, locking them so that
 * parallel worker instances don't pick up the same rows.
 *
 * @param {import('pg').PoolClient} client    - Active transaction client.
 * @param {number}                  batchSize - Max rows to return.
 * @returns {Promise<object[]>} Array of outbox_events rows.
 */
async function fetchUnpublishedEvents(client, batchSize) {
  // FOR UPDATE: lock the selected rows for the duration of the transaction.
  // SKIP LOCKED: skip rows already locked by another worker — prevents
  //   multiple replicas from competing on the same events.
  // ORDER BY created_at ASC: oldest events delivered first (FIFO).
  const { rows } = await client.query(
    `SELECT id, aggregate_type, aggregate_id, event_type, payload
       FROM outbox_events
      WHERE published = FALSE
      ORDER BY created_at ASC
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    [batchSize],
  );

  return rows;
}

/**
 * Marks a single outbox event as successfully published.
 * Stores the SNS MessageId so the event can be traced in CloudWatch.
 *
 * @param {import('pg').PoolClient} client       - Active transaction client.
 * @param {string}                  eventId      - UUID of the outbox_events row.
 * @param {string}                  snsMessageId - MessageId returned by SNS.
 * @returns {Promise<void>}
 */
async function markEventPublished(client, eventId, snsMessageId) {
  await client.query(
    `UPDATE outbox_events
        SET published      = TRUE,
            published_at   = NOW(),
            sns_message_id = $1
      WHERE id = $2`,
    [snsMessageId, eventId],
  );
}

module.exports = { fetchUnpublishedEvents, markEventPublished };
