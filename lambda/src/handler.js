'use strict';

/**
 * handler.js — Lambda Entry Point
 * ─────────────────────────────────
 * Responsibility: wire together config loading, SQS record iteration, and
 * partial-batch failure reporting.  No business logic lives here.
 *
 * Triggered by SQS, which is subscribed to the SNS "application-events" topic.
 * Each SQS record body is a JSON-stringified SNS notification envelope:
 *
 *   { "Type": "Notification", "Message": "<JSON payload>", ... }
 *
 * Partial-batch failure reporting is enabled via the event-source mapping
 * (ReportBatchItemFailures).  Records that succeed are deleted from the queue;
 * only failed records increment their receive count and eventually route to the
 * Dead Letter Queue after maxReceiveCount (3) attempts.
 *
 * MODULE STRUCTURE
 * ────────────────
 * handler.js           ← you are here (entry point + init)
 * salesforce.service.js  Salesforce OAuth + Case upsert
 * payload.validator.js   Input validation
 * errors.js              Error classes + axios error helpers
 * logger.js              Structured JSON logger
 * config.js              SSM Parameter Store / env loader
 */

const { loadConfig }       = require('./config');
const { initService, syncToSalesforce } = require('./salesforce.service');
const { validatePayload }  = require('./payload.validator');
const { NonRetryableError } = require('./errors');
const { log }              = require('./logger');

// ─── One-time cold-start initialisation ──────────────────────────────────────
// Lambda module-level code is synchronous, so SSM (async) cannot be called
// there.  Instead we do a lazy async init on the first handler invocation.
// Because Lambda reuses the execution environment across warm invocations the
// SSM call and Salesforce config validation only happen once per cold start.

let initialized = false;

async function init() {
  if (initialized) return;

  // 1. Load secrets from SSM Parameter Store into process.env.
  //    In local / dev / CI (no SSM_PARAMETER_PREFIX set) this is a no-op.
  await loadConfig();

  // 2. Validate Salesforce config and create the shared HTTP client.
  //    initService() throws with a clear message if required vars are missing.
  initService();

  initialized = true;
  log('info', 'Lambda initialised', {
    configSource: process.env.SSM_PARAMETER_PREFIX ? 'SSM Parameter Store' : 'environment variables',
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  await init();

  const failures = [];

  for (const record of event.Records) {
    try {
      // ── Parse SQS → SNS envelope ──────────────────────────────────────────
      let snsEnvelope;
      try {
        snsEnvelope = JSON.parse(record.body);
      } catch {
        throw new NonRetryableError('SQS record body is not valid JSON');
      }

      let payload;
      try {
        payload = JSON.parse(snsEnvelope.Message);
      } catch {
        throw new NonRetryableError('SNS Message field is not valid JSON');
      }

      // ── Validate and sync ─────────────────────────────────────────────────
      validatePayload(payload);

      log('info', 'Processing record', {
        messageId:     record.messageId,
        applicationId: payload.applicationId,
      });

      await syncToSalesforce(payload);

    } catch (err) {
      const isNonRetryable = err instanceof NonRetryableError;
      log('error', isNonRetryable
        ? 'Non-retryable failure — record will route to DLQ after max retries'
        : 'Retryable failure — record will be requeued by SQS', {
        messageId:    record.messageId,
        error:        err.message,
        nonRetryable: isNonRetryable,
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  if (failures.length > 0) {
    return { batchItemFailures: failures };
  }
};
