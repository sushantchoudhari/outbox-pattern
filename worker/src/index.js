'use strict';

const { publishOutboxEvents } = require('./outboxPublisher');

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('[worker] Outbox publisher started');
  console.log(`[worker] Topic  : ${process.env.SNS_TOPIC_ARN}`);
  console.log(`[worker] Poll   : every ${POLL_INTERVAL_MS}ms`);
  console.log(`[worker] Batch  : up to ${process.env.BATCH_SIZE || 10} rows`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const count = await publishOutboxEvents();
      if (count > 0) {
        console.log(`[worker] Cycle complete — published ${count} event(s)`);
      }
    } catch (err) {
      console.error('[worker] Publish cycle error:', err.message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

run().catch((err) => {
  console.error('[worker] Fatal error — exiting:', err);
  process.exit(1);
});
