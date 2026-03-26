'use strict';

/**
 * Outbox Publisher
 *
 * Implements the "relay" step of the Transactional Outbox Pattern:
 *
 *   1. Open a PostgreSQL transaction.
 *   2. SELECT … FOR UPDATE SKIP LOCKED — atomically lock a batch of unpublished
 *      outbox_events rows.  Rows already locked by another worker replica are
 *      skipped, so this is safe to run on multiple concurrent worker instances.
 *   3. Publish each event to the SNS topic.
 *   4. UPDATE outbox_events SET published = TRUE — mark rows as published inside
 *      the same transaction so the update is atomic with the lock release.
 *   5. COMMIT — both the publish record updates land or neither does.
 *
 * Failure behaviour:
 *   If any SNS publish call throws, the error propagates out of the loop,
 *   the catch block issues a ROLLBACK, and all rows in the batch remain with
 *   published = FALSE.  They will be picked up again on the next poll cycle.
 *   This guarantees at-least-once delivery — duplicate messages are handled
 *   on the consumer side via idempotent upserts (External_ID__c in Salesforce).
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const pool = require('./db');

/**
 * SNS client — constructed once at module load and reused across poll cycles.
 *
 * SNS_ENDPOINT: set to http://localstack:4566 in the Docker Compose environment
 * so traffic is routed to LocalStack instead of real AWS.  Leave this variable
 * unset in production and the SDK uses the default regional endpoint.
 *
 * Credentials: placeholder values are supplied for LocalStack compatibility.
 * In production the Lambda/ECS task role provides credentials automatically
 * via the EC2 metadata service — hardcoded keys are never used.
 */
const snsClient = new SNSClient({
  region:   process.env.AWS_REGION || 'us-east-1',
  // SNS_ENDPOINT is set to http://localstack:4566 locally; unset in production.
  endpoint: process.env.SNS_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

// The ARN of the SNS topic to publish events to.
// Must be set via environment variable — no default; an undefined ARN causes
// the SNS SDK call to throw, which rolls back the transaction and retries.
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// Maximum number of outbox rows to process per poll cycle.  Tuning guidance:
//   - Too large: a single slow SNS call (or failure) stalls the entire batch.
//   - Too small: increases the number of DB round-trips relative to throughput.
// 10 is a safe default; raise to 25-50 if you have sustained high throughput.
const BATCH_SIZE    = parseInt(process.env.BATCH_SIZE || '10', 10);

/**
 * Fetches up to BATCH_SIZE unpublished outbox events inside a single
 * database transaction, publishes each to SNS, then marks them as published.
 *
 * FOR UPDATE SKIP LOCKED ensures multiple worker replicas never compete
 * for the same rows — any row already locked by another session is skipped.
 *
 * If the SNS publish call throws, the error propagates, the transaction is
 * rolled back, and the row stays unpublished for the next poll cycle.
 *
 * @returns {number} count of events successfully published
 */
/**
 * Fetches up to BATCH_SIZE unpublished outbox events inside a single
 * database transaction, publishes each to SNS, then marks them as published.
 *
 * FOR UPDATE SKIP LOCKED ensures multiple worker replicas never compete
 * for the same rows — any row already locked by another session is skipped.
 *
 * If the SNS publish call throws, the error propagates, the transaction is
 * rolled back, and the row stays unpublished for the next poll cycle.
 *
 * @returns {Promise<number>} count of events successfully published this cycle
 */
async function publishOutboxEvents() {
  // Acquire a dedicated client from the pool.  Using a client (rather than
  // pool.query) is required because BEGIN/COMMIT must run on the same
  // connection — pool.query may route each call to a different client.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the oldest unpublished rows in insertion order.
    // ORDER BY created_at ASC guarantees FIFO delivery to SNS, which matters
    // for consumers that depend on event ordering within an aggregate.
    // FOR UPDATE SKIP LOCKED: rows locked by another transaction (e.g. a
    // second worker replica) are silently bypassed rather than blocking — this
    // is what makes horizontal scaling of the worker safe.
    const { rows: events } = await client.query(
      `SELECT id, aggregate_type, aggregate_id, event_type, payload
         FROM outbox_events
        WHERE published = FALSE
        ORDER BY created_at ASC
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    // Nothing to do — commit the no-op transaction and release the client.
    if (events.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    console.log(`[worker] Processing ${events.length} outbox event(s)…`);

    for (const event of events) {
      // ── Publish to SNS ───────────────────────────────────────────────────
      // MessageAttributes carry metadata that SNS filter policies can use
      // to route messages to specific subscriptions without deserialising
      // the Message body.  Adding eventType and aggregateType here means
      // future consumers can subscribe to a subset of events without any
      // changes to the publisher.
      const { MessageId } = await snsClient.send(
        new PublishCommand({
          TopicArn: SNS_TOPIC_ARN,
          // The payload column is already a parsed JSONB object (returned by
          // pg as a JS object).  Re-serialise to a string because SNS Message
          // must be a string.
          Message:  JSON.stringify(event.payload),
          MessageAttributes: {
            eventType: {
              DataType:    'String',
              StringValue: event.event_type,
            },
            aggregateType: {
              DataType:    'String',
              StringValue: event.aggregate_type,
            },
          },
        }),
      );

      // ── Mark as published (same transaction) ─────────────────────────────
      // Storing the SNS MessageId provides an audit trail: you can correlate
      // a database row with a specific SNS message in CloudWatch Logs.
      // Both the status update and the SNS call are inside the same database
      // transaction — if COMMIT fails after SNS succeeds the row stays
      // unpublished and the message will be published again on the next cycle
      // (at-least-once).  The consumer's idempotent upsert handles the duplicate.
      await client.query(
        `UPDATE outbox_events
            SET published      = TRUE,
                published_at   = NOW(),
                sns_message_id = $1
          WHERE id = $2`,
        [MessageId, event.id],
      );

      console.log(
        `[worker] event=${event.id} type=${event.event_type} → SNS msgId=${MessageId}`,
      );
    }

    // Commit releases all FOR UPDATE locks and makes the published = TRUE
    // updates visible to other connections.
    await client.query('COMMIT');
    return events.length;
  } catch (err) {
    // Roll back on any failure — SNS errors, DB errors, or unexpected throws.
    // After ROLLBACK the locked rows become visible again immediately so
    // the next poll cycle (or another worker replica) can retry them.
    await client.query('ROLLBACK');
    throw err;
  } finally {
    // Always release back to the pool — even if ROLLBACK itself threw.
    // Failure to release would leak the client and eventually exhaust the pool.
    client.release();
  }
}

module.exports = { publishOutboxEvents };
