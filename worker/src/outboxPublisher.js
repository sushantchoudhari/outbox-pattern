'use strict';

/**
 * outboxPublisher.js — Outbox Relay Worker
 * ─────────────────────────────────────────
 * This module does one job: read unpublished events from the database
 * and deliver them to SNS.  It runs on a timer (see index.js).
 *
 * HOW THE OUTBOX PATTERN WORKS (plain English)
 * ─────────────────────────────────────────────
 * When the API saves a new application it also writes a matching "event"
 * row into the outbox_events table — all inside ONE database transaction.
 * This means either both writes happen or neither does.
 *
 * This worker then picks up those event rows and publishes them to AWS SNS.
 * Once published, it marks the row as done so it won't be sent again.
 *
 * WHY THIS APPROACH?
 * ──────────────────
 * Without the outbox pattern you might try to publish to SNS directly inside
 * the API request.  The problem: the database write can succeed but the SNS
 * call can fail, leaving your system in an inconsistent state.
 * The outbox pattern removes that risk — the event is durable in the database
 * first, and this worker handles delivery separately with automatic retries.
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const pool = require('./db');

// ─── Configuration ────────────────────────────────────────────────────────────

// The SNS topic where application events are published.
// Example: arn:aws:sns:us-east-1:123456789012:application-events
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// How many events to process in one database round-trip.
// Keeping this at 10 is safe for most workloads.  If you need higher
// throughput, increase it — but larger batches mean a bigger rollback
// if something fails midway.
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);

// ─── SNS Client ───────────────────────────────────────────────────────────────
//
// One client instance is created here and shared across all poll cycles.
// Creating a new client on every call would be wasteful (it involves TLS
// handshakes and connection setup).
//
// LOCAL DEVELOPMENT: SNS_ENDPOINT points to LocalStack (http://localstack:4566)
//   so no real AWS account is needed.
// PRODUCTION: Leave SNS_ENDPOINT unset — the SDK automatically connects to
//   the real AWS SNS endpoint for the configured region.
const snsClient = new SNSClient({
  region:   process.env.AWS_REGION    || 'us-east-1',
  endpoint: process.env.SNS_ENDPOINT, // undefined in production — that is correct
  credentials: {
    // These placeholder values satisfy the SDK in local/test environments.
    // In production, real credentials come from the ECS/EC2 IAM role
    // automatically — you never hardcode real keys here.
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Runs one "relay cycle":
 *   1. Fetch a batch of unpublished events from the database (with a row lock).
 *   2. Publish each event to SNS.
 *   3. Mark each event as published.
 *   4. Commit — all three steps land together, or none of them do.
 *
 * If anything goes wrong (SNS is down, DB error, etc.) the transaction is
 * rolled back and the events stay unpublished.  The next poll cycle will
 * try again automatically — no manual intervention needed.
 *
 * @returns {Promise<number>} How many events were published in this cycle.
 */
async function publishOutboxEvents() {
  // We need a dedicated connection (not pool.query) because BEGIN and COMMIT
  // must run on the SAME physical connection.  pool.query picks any free
  // connection each time, which would spread our transaction across multiple
  // connections and break it.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Step 1: Fetch unpublished events ─────────────────────────────────────
    //
    // FOR UPDATE: lock these rows so another worker replica won't pick them up.
    // SKIP LOCKED: instead of waiting for locked rows, just skip them.
    //   This makes it safe to run multiple worker instances in parallel —
    //   each instance works on a different set of rows with no conflicts.
    // ORDER BY created_at ASC: process oldest events first (FIFO order).
    const { rows: unpublishedEvents } = await client.query(
      `SELECT id, aggregate_type, aggregate_id, event_type, payload
         FROM outbox_events
        WHERE published = FALSE
        ORDER BY created_at ASC
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    // Nothing to publish — close the transaction and exit early.
    if (unpublishedEvents.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    console.log(`[worker] Processing ${unpublishedEvents.length} outbox event(s)…`);

    // ── Step 2 & 3: Publish each event, then mark it done ────────────────────
    for (const event of unpublishedEvents) {
      await publishSingleEvent(client, event);
    }

    // ── Step 4: Commit ────────────────────────────────────────────────────────
    // This releases the row locks and makes all the "published = TRUE" updates
    // visible to the rest of the application.
    await client.query('COMMIT');
    return unpublishedEvents.length;

  } catch (err) {
    // Something went wrong.  Roll back the entire batch so nothing is
    // left in a half-published state.  All events remain published = FALSE
    // and will be retried on the next poll cycle.
    await client.query('ROLLBACK');
    throw err; // let the caller (index.js) log this and schedule the retry

  } finally {
    // ALWAYS release the connection back to the pool, even if ROLLBACK threw.
    // Not releasing would permanently leak a connection and eventually
    // exhaust the pool, causing all future requests to hang.
    client.release();
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Publishes a single outbox event to SNS, then updates its database row
 * to mark it as published.  Both operations run inside the caller's
 * open transaction, so they are atomic.
 *
 * @param {import('pg').PoolClient} client  - Active database transaction client.
 * @param {object}                  event   - Row from outbox_events.
 */
async function publishSingleEvent(client, event) {
  // Send the event to SNS.
  // MessageAttributes let downstream consumers filter by eventType or
  // aggregateType without parsing the message body — useful when you later
  // add other event types and want separate Lambda consumers per type.
  const { MessageId } = await snsClient.send(
    new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      // event.payload is a JS object (PostgreSQL JSONB is auto-parsed by pg).
      // SNS requires the message to be a plain string, so we serialise it here.
      Message: JSON.stringify(event.payload),
      MessageAttributes: {
        eventType: {
          DataType:    'String',
          StringValue: event.event_type,       // e.g. "ApplicationSubmitted"
        },
        aggregateType: {
          DataType:    'String',
          StringValue: event.aggregate_type,   // e.g. "Application"
        },
      },
    }),
  );

  // Record the SNS MessageId so you can trace this database row back to
  // a specific SNS message in CloudWatch Logs if you ever need to debug.
  await client.query(
    `UPDATE outbox_events
        SET published      = TRUE,
            published_at   = NOW(),
            sns_message_id = $1
      WHERE id = $2`,
    [MessageId, event.id],
  );

  console.log(`[worker] Published event=${event.id} type=${event.event_type} → SNS msgId=${MessageId}`);
}

module.exports = { publishOutboxEvents };

