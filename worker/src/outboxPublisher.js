'use strict';

/**
 * outboxPublisher.js — Transaction Coordinator
 * ─────────────────────────────────────────────
 * Responsibility: orchestrate one relay cycle inside a single DB transaction.
 *
 * This module owns the BEGIN / COMMIT / ROLLBACK lifecycle.  It delegates:
 *   • "what to fetch"   → outboxRepository.fetchUnpublishedEvents()
 *   • "how to publish"  → snsPublisher.publishEventToSns()
 *   • "how to mark done" → outboxRepository.markEventPublished()
 *
 * It has no SQL, no SNS SDK calls, and no timing logic.
 *
 * HOW THE OUTBOX PATTERN WORKS (plain English)
 * ─────────────────────────────────────────────
 * When the API saves a new application it also writes a matching "event"
 * row into outbox_events — all inside ONE database transaction.
 * Either both writes happen, or neither does.
 *
 * This worker picks up those rows, publishes them to SNS, then marks them
 * done — all inside a second transaction so the fetch-publish-mark trio is
 * also atomic.  If anything fails mid-batch, ROLLBACK leaves every row
 * as published = FALSE and the next cycle retries them automatically.
 *
 * WHY THE OUTBOX PATTERN?
 * ───────────────────────
 * Publishing to SNS directly inside the API request risks a "dual-write"
 * failure: the DB commit succeeds but the SNS call fails, leaving the system
 * inconsistent.  The outbox removes that risk — events are durable in the DB
 * first, and this worker handles reliable delivery separately.
 */

const pool = require('./db');
const { fetchUnpublishedEvents, markEventPublished } = require('./outboxRepository');
const { publishEventToSns } = require('./snsPublisher');

// How many events to process in one database round-trip.
// Larger batches increase throughput but increase blast radius on rollback.
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);

/**
 * Runs one relay cycle inside a single database transaction:
 *   1. Fetch a locked batch of unpublished events.
 *   2. Publish each event to SNS.
 *   3. Mark each event as published.
 *   4. Commit — all three steps land together, or none of them do.
 *
 * If anything fails the transaction is rolled back and every event stays
 * as published = FALSE, ready for the next cycle to retry.
 *
 * @returns {Promise<number>} Count of events published this cycle.
 */
async function publishOutboxEvents() {
  // We need a dedicated connection (not pool.query) because BEGIN/COMMIT
  // must run on the SAME physical connection.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const events = await fetchUnpublishedEvents(client, BATCH_SIZE);

    if (events.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    console.log(`[worker] Processing ${events.length} outbox event(s)…`);

    for (const event of events) {
      const messageId = await publishEventToSns(event);
      await markEventPublished(client, event.id, messageId);
      console.log(
        `[worker] Published event=${event.id} type=${event.event_type} → SNS msgId=${messageId}`,
      );
    }

    await client.query('COMMIT');
    return events.length;

  } catch (err) {
    // Roll back the entire batch — nothing left in a half-published state.
    await client.query('ROLLBACK');
    throw err;  // bubble up so the poll loop in index.js can log and retry

  } finally {
    // ALWAYS release — not releasing leaks the connection permanently and
    // will eventually exhaust the pool.
    client.release();
  }
}

module.exports = { publishOutboxEvents };

