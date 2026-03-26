'use strict';

/**
 * Salesforce Integration Consumer
 *
 * Triggered by SQS, which is subscribed to the SNS "application-events" topic.
 * Each SQS record body is a JSON-stringified SNS notification envelope:
 *
 *   { "Type": "Notification", "Message": "<JSON payload>", ... }
 *
 * On any unhandled error the Lambda throws, SQS makes the message visible
 * again. After `maxReceiveCount` (3) retries the message is moved to the
 * Dead Letter Queue for manual inspection / reprocessing.
 */

const axios = require('axios');

const SF_INSTANCE_URL  = process.env.SALESFORCE_INSTANCE_URL;   // e.g. https://xxx.my.salesforce.com
const SF_CLIENT_ID     = process.env.SALESFORCE_CLIENT_ID;
const SF_CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;
const SF_TOKEN_URL     = process.env.SALESFORCE_TOKEN_URL
  || 'https://login.salesforce.com/services/oauth2/token';

// Simple in-memory token cache (valid for the lifetime of this Lambda container)
let cachedToken    = null;
let tokenExpiresAt = 0;

/**
 * Returns a valid Salesforce access token using the OAuth2
 * client-credentials flow.  The token is reused until 5 minutes before
 * its expiry to avoid unnecessary round-trips.
 */
async function getSalesforceToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });

  const { data } = await axios.post(SF_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  cachedToken    = data.access_token;
  // Salesforce tokens last 2 hours; cache for 115 minutes
  tokenExpiresAt = Date.now() + 115 * 60 * 1000;
  return cachedToken;
}

/**
 * Upserts a Salesforce Case from an application payload.
 * Uses an external-ID field (External_ID__c) so the operation is
 * idempotent — duplicate deliveries will update the existing Case, not
 * create a duplicate record.
 */
async function syncToSalesforce(payload) {
  const token = await getSalesforceToken();

  const caseRecord = {
    Subject:        `Application – ${payload.applicantName}`,
    Description:    JSON.stringify(payload.data || {}),
    Origin:         'Web',
    Status:         'New',
    SuppliedEmail:  payload.applicantEmail,
    SuppliedName:   payload.applicantName,
  };

  // PATCH /sobjects/Case/External_ID__c/<id>  →  upsert
  await axios.patch(
    `${SF_INSTANCE_URL}/services/data/v59.0/sobjects/Case/External_ID__c/${payload.applicationId}`,
    caseRecord,
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );

  console.log(`[lambda] Synced application ${payload.applicationId} → Salesforce Case`);
}

/**
 * Lambda entry point.
 *
 * Iterates over every SQS record in the batch.  If *any* record fails the
 * entire function throws, which tells SQS to keep the failed messages
 * visible for retry.  Partial-batch failure reporting (reportBatchItemFailures)
 * is supported: if your event source mapping enables it, return
 * { batchItemFailures: [{ itemIdentifier: record.messageId }] } instead
 * of re-throwing.
 */
exports.handler = async (event) => {
  const failures = [];

  for (const record of event.Records) {
    try {
      // SQS body is the raw SNS notification envelope (JSON string)
      const snsEnvelope = JSON.parse(record.body);
      // SNS puts the actual event payload inside the "Message" field
      const payload     = JSON.parse(snsEnvelope.Message);

      console.log(`[lambda] Processing applicationId=${payload.applicationId}`);
      await syncToSalesforce(payload);
    } catch (err) {
      console.error(`[lambda] Failed record ${record.messageId}:`, err.message);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  // Partial-batch failure reporting — only failed messages are retried / DLQ'd
  if (failures.length > 0) {
    return { batchItemFailures: failures };
  }
};
