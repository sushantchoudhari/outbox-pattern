'use strict';

/**
 * Salesforce Integration Consumer
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
 */

const axios = require('axios');

// ─── Startup validation ───────────────────────────────────────────────────────
// Validated once at container init time.  A missing variable throws here
// rather than silently failing inside the first invocation.
const REQUIRED_ENV = [
  'SALESFORCE_INSTANCE_URL',
  'SALESFORCE_CLIENT_ID',
  'SALESFORCE_CLIENT_SECRET',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Lambda misconfiguration: missing required environment variable "${key}"`);
  }
}

const SF_INSTANCE_URL  = process.env.SALESFORCE_INSTANCE_URL.replace(/\/$/, '');
const SF_CLIENT_ID     = process.env.SALESFORCE_CLIENT_ID;
const SF_CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;
const SF_TOKEN_URL     = process.env.SALESFORCE_TOKEN_URL
  || 'https://login.salesforce.com/services/oauth2/token';

// SSRF prevention — reject non-HTTPS or non-URL values early
try {
  const parsed = new URL(SF_INSTANCE_URL);
  if (parsed.protocol !== 'https:') {
    throw new Error('protocol must be https');
  }
} catch (err) {
  throw new Error(`Lambda misconfiguration: invalid SALESFORCE_INSTANCE_URL — ${err.message}`);
}

// ─── HTTP client ──────────────────────────────────────────────────────────────
// A shared instance with a conservative timeout prevents Lambda from hanging
// for the full execution limit on a slow/unresponsive upstream.
const http = axios.create({ timeout: 10_000 });

// ─── Token cache ──────────────────────────────────────────────────────────────
let cachedToken    = null;
let tokenExpiresAt = 0;

// ─── Structured logger ────────────────────────────────────────────────────────
// JSON lines are directly queryable in CloudWatch Logs Insights.
function log(level, message, fields = {}) {
  const entry = JSON.stringify({
    level,
    message,
    ...fields,
    ts: new Date().toISOString(),
  });
  if (level === 'error') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

// ─── Error helpers ────────────────────────────────────────────────────────────

/**
 * Thrown for errors that should not be retried (e.g. malformed payload,
 * Salesforce 4xx).  The record goes to batchItemFailures immediately; after
 * maxReceiveCount attempts it routes to the DLQ.
 */
class NonRetryableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name  = 'NonRetryableError';
    this.cause = cause;
  }
}

/**
 * Returns true when the error is transient and worth retrying:
 *   - Network / timeout errors (no response)
 *   - 429 Too Many Requests
 *   - 5xx server errors
 * 4xx (except 429) are non-retryable — retrying won't fix bad data.
 */
function isRetryable(err) {
  if (!err.response) return true;            // network error or timeout
  if (err.response.status === 429) return true;
  return err.response.status >= 500;
}

/**
 * Extracts a human-readable error string from an axios error, including
 * the Salesforce errorCode + message arrays when present.
 */
function salesforceErrorDetail(err) {
  if (!err.response) return err.message;
  const { status, data } = err.response;
  const detail = Array.isArray(data)
    ? data.map(e => `${e.errorCode}: ${e.message}`).join('; ')
    : JSON.stringify(data);
  return `HTTP ${status} — ${detail}`;
}

// ─── Token acquisition ────────────────────────────────────────────────────────

async function getSalesforceToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });

  let data;
  try {
    ({ data } = await http.post(SF_TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }));
  } catch (err) {
    // OAuth failures are typically a misconfiguration — mark non-retryable so
    // operators are alerted via the DLQ rather than exhausting retry budget.
    throw new NonRetryableError(
      `Salesforce token request failed: ${salesforceErrorDetail(err)}`,
      err,
    );
  }

  if (!data.access_token) {
    throw new NonRetryableError('Salesforce token response missing access_token');
  }

  cachedToken    = data.access_token;
  // Salesforce tokens live for 2 hours; refresh 5 minutes before expiry
  tokenExpiresAt = Date.now() + 115 * 60 * 1000;
  return cachedToken;
}

/** Clears the cached token so the next call fetches a fresh one. */
function invalidateToken() {
  cachedToken    = null;
  tokenExpiresAt = 0;
}

// ─── Payload validation ───────────────────────────────────────────────────────

function validatePayload(payload) {
  if (typeof payload !== 'object' || payload === null) {
    throw new NonRetryableError('SNS Message payload is not a JSON object');
  }
  const invalid = ['applicationId', 'applicantName', 'applicantEmail']
    .filter(k => !payload[k] || typeof payload[k] !== 'string');
  if (invalid.length > 0) {
    throw new NonRetryableError(
      `Payload missing or invalid required fields: ${invalid.join(', ')}`,
    );
  }
}

// ─── Salesforce sync ──────────────────────────────────────────────────────────

async function syncToSalesforce(payload) {
  const token = await getSalesforceToken();

  const caseRecord = {
    Subject:       `Application – ${payload.applicantName}`,
    Description:   JSON.stringify(payload.data || {}),
    Origin:        'Web',
    Status:        'New',
    SuppliedEmail: payload.applicantEmail,
    SuppliedName:  payload.applicantName,
  };

  // encodeURIComponent guards against path traversal in the external-ID segment
  const url = `${SF_INSTANCE_URL}/services/data/v59.0/sobjects/Case/External_ID__c/${encodeURIComponent(payload.applicationId)}`;

  try {
    await http.patch(url, caseRecord, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    // 401 Unauthorized — token may have been revoked; clear cache and fail so
    // SQS retries with a fresh token on the next attempt.
    if (err.response?.status === 401) {
      invalidateToken();
      throw new Error(`Salesforce returned 401 — token invalidated, will retry: ${salesforceErrorDetail(err)}`);
    }

    if (!isRetryable(err)) {
      throw new NonRetryableError(
        `Salesforce upsert rejected (non-retryable): ${salesforceErrorDetail(err)}`,
        err,
      );
    }

    throw new Error(`Salesforce upsert failed (retryable): ${salesforceErrorDetail(err)}`);
  }

  log('info', 'Application synced to Salesforce', { applicationId: payload.applicationId });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
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

      // ── Validate and process ──────────────────────────────────────────────
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
