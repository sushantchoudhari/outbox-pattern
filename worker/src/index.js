'use strict';

/**
 * Worker entry point — poll loop
 *
 * This module starts an infinite poll loop that drives the outbox relay:
 *
 *   while (true) {
 *     publishOutboxEvents()   // fetch → publish → mark published
 *     sleep(POLL_INTERVAL_MS)
 *   }
 *
 * Design decisions:
 *
 *   Sequential polling (not parallel):
 *     A new cycle does not start until the previous one completes.  This keeps
 *     the concurrency model simple and avoids overlapping database transactions
 *     on a single worker instance.  Horizontal scaling (multiple worker
 *     replicas) is handled at the database level via FOR UPDATE SKIP LOCKED.
 *
 *   Error isolation per cycle:
 *     Each cycle error is caught and logged but does not crash the process.
 *     The worker sleeps and retries on the next tick.  Transient failures
 *     (network blip, database restart) recover automatically without any
 *     operator intervention.
 *
 *   Graceful fatal exit:
 *     If run() itself rejects (only possible if the event loop throws outside
 *     the try/catch — extremely unlikely) the process exits with code 1 so
 *     Docker / Kubernetes knows to restart the container.
 */

const { publishOutboxEvents } = require('./outboxPublisher');

// How long to wait between poll cycles (milliseconds).
// Lower values reduce end-to-end latency but increase DB query frequency.
// Default: 5 000 ms (5 seconds) — appropriate for most use cases.
// Production recommendations:
//   - Latency-sensitive workflows: 1 000–2 000 ms
//   - Cost-sensitive / low-volume:  10 000–30 000 ms
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);

/**
 * Pauses execution for the given number of milliseconds.
 * Used to introduce a deliberate delay between poll cycles so the worker
 * does not busy-loop and hammer the database when the outbox is empty.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main poll loop — runs indefinitely until the process is killed.
 *
 * Startup log lines are emitted once at boot so operators can quickly verify
 * the worker configuration from container logs without inspecting env vars.
 */
async function run() {
  console.log('[worker] Outbox publisher started');
  console.log(`[worker] Topic  : ${process.env.SNS_TOPIC_ARN}`);
  console.log(`[worker] Poll   : every ${POLL_INTERVAL_MS}ms`);
  console.log(`[worker] Batch  : up to ${process.env.BATCH_SIZE || 10} rows`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const count = await publishOutboxEvents();
      // Only log when there is something to report — silence on empty cycles
      // keeps logs signal-rich and avoids CloudWatch log ingestion costs from
      // high-frequency idle noise.
      if (count > 0) {
        console.log(`[worker] Cycle complete — published ${count} event(s)`);
      }
    } catch (err) {
      // Log and continue — a single failed cycle must not kill the worker.
      // The unpublished rows remain in the database and will be retried on the
      // next cycle.  Persistent errors here (e.g. SNS unreachable, DB down)
      // will appear in logs and can be tracked by a CloudWatch alarm on
      // ERROR-level log filter patterns.
      console.error('[worker] Publish cycle error:', err.message);
    }
    // Sleep regardless of success or failure so the loop has a predictable
    // cadence and does not spin at full speed when errors occur continuously.
    await sleep(POLL_INTERVAL_MS);
  }
}

// Top-level rejection handler: if run() ever rejects (fatal, unexpected)
// we log and exit non-zero so the container orchestrator restarts the process.
run().catch((err) => {
  console.error('[worker] Fatal error — exiting:', err);
  process.exit(1);
});
