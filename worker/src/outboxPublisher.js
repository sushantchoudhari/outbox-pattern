'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const pool = require('./db');

const snsClient = new SNSClient({
  region:   process.env.AWS_REGION || 'us-east-1',
  // SNS_ENDPOINT is set to http://localstack:4566 locally; unset in production.
  endpoint: process.env.SNS_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
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
async function publishOutboxEvents() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: events } = await client.query(
      `SELECT id, aggregate_type, aggregate_id, event_type, payload
         FROM outbox_events
        WHERE published = FALSE
        ORDER BY created_at ASC
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    if (events.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    console.log(`[worker] Processing ${events.length} outbox event(s)…`);

    for (const event of events) {
      // ── Publish to SNS ───────────────────────────────────────
      const { MessageId } = await snsClient.send(
        new PublishCommand({
          TopicArn: SNS_TOPIC_ARN,
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

      // ── Mark as published (same transaction) ─────────────────
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

    await client.query('COMMIT');
    return events.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { publishOutboxEvents };
