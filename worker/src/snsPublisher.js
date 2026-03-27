'use strict';

/**
 * snsPublisher.js — SNS Publish Operation
 * ─────────────────────────────────────────
 * Responsibility: send a single outbox event to the SNS topic.
 *
 * This module knows ONLY about SNS — it has no knowledge of databases,
 * transactions, or poll timing.
 *
 * MESSAGE ATTRIBUTES
 * ──────────────────
 * eventType and aggregateType are attached as MessageAttributes so that
 * downstream SQS subscribers can filter messages using subscription filter
 * policies without parsing the message body.
 * Example: a Lambda that only processes "ApplicationSubmitted" events can
 * filter on eventType = "ApplicationSubmitted" and ignore all other events.
 *
 * PAYLOAD SERIALISATION
 * ─────────────────────
 * PostgreSQL's JSONB column is auto-parsed into a JS object by the pg driver.
 * SNS requires the message to be a plain string, so we re-serialise here.
 */

const { PublishCommand } = require('@aws-sdk/client-sns');
const snsClient = require('./snsClient');

// Read once at module load time (after SSM has populated process.env).
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

/**
 * Publishes one outbox event to SNS.
 *
 * @param {object} event - Row from outbox_events table.
 * @param {string} event.id             - Event UUID.
 * @param {string} event.event_type     - e.g. "ApplicationSubmitted"
 * @param {string} event.aggregate_type - e.g. "Application"
 * @param {object} event.payload        - JSONB payload (already parsed by pg).
 * @returns {Promise<string>} The SNS MessageId assigned to this message.
 */
async function publishEventToSns(event) {
  const { MessageId } = await snsClient.send(
    new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Message:  JSON.stringify(event.payload),
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

  return MessageId;
}

module.exports = { publishEventToSns };
