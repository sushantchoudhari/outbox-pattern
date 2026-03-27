'use strict';

/**
 * index.js — Worker Entry Point
 * ──────────────────────────────
 * Starts a continuous poll loop that drives the Transactional Outbox Pattern:
 *
 *   every 5 seconds:
 *     → fetch unpublished events from the database
 *     → publish them to SNS
 *     → mark them as published
 *
 * The loop never stops.  If a cycle fails (e.g. SNS is temporarily down)
 * the error is logged and the next cycle runs normally — events are never lost
 * because they stay in the database with published = FALSE until they succeed.
 */

const { loadConfig } = require('./config');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * Used to pause between poll cycles so we don't hammer the database
 * when the outbox is empty.
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

/**
 * Logs startup configuration so operators can quickly verify the worker
 * is running with the right settings, then enters the poll loop.
 */
async function startWorker() {
  // Load secrets from SSM Parameter Store into process.env (production only).
  // In local/dev/CI (no SSM_PARAMETER_PREFIX) this is a no-op.
  //
  // IMPORTANT: outboxPublisher.js and db.js create the SNS client and the
  // pg Pool at require()-time, reading directly from process.env.  They must
  // therefore be required AFTER SSM loading, via dynamic require() below.
  await loadConfig();

  // Dynamic require — deferred until SSM has populated process.env so that
  // the pg Pool and SNSClient are initialised with the correct values.
  const { publishOutboxEvents } = require('./outboxPublisher');

  // ─── Configuration ──────────────────────────────────────────────────────
  // Read after SSM loading so an SSM-stored POLL_INTERVAL_MS is respected.
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);

  console.log('[worker] Outbox publisher started');
  console.log(`[worker] Topic  : ${process.env.SNS_TOPIC_ARN}`);
  console.log(`[worker] Poll   : every ${POLL_INTERVAL_MS}ms`);
  console.log(`[worker] Batch  : up to ${process.env.BATCH_SIZE || 10} rows`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const publishedCount = await publishOutboxEvents();

      // Only log when something actually happened — silent idle cycles keep
      // logs clean and reduce CloudWatch ingestion costs.
      if (publishedCount > 0) {
        console.log(`[worker] Cycle complete — published ${publishedCount} event(s)`);
      }
    } catch (err) {
      // A failed cycle is recoverable.  Log it and continue — the unpublished
      // events remain in the database and will be retried next cycle.
      console.error('[worker] Publish cycle error:', err.message);
    }

    // Wait before the next cycle regardless of success or failure.
    // This prevents a tight spin loop when errors occur continuously.
    await wait(POLL_INTERVAL_MS);
  }
}

// Start the worker.  If startWorker() itself ever rejects (a programming error,
// not a normal cycle failure) exit with code 1 so Docker/Kubernetes restarts us.
startWorker().catch((err) => {
  console.error('[worker] Fatal startup error — exiting:', err);
  process.exit(1);
});
