'use strict';

/**
 * errors.js — Error Classes and Helpers
 * ──────────────────────────────────────
 * Responsibility: define error types and classify axios errors for the
 * Lambda retry/DLQ decision.
 *
 * RETRY STRATEGY
 * ──────────────
 * SQS automatically retries records that appear in batchItemFailures.
 * After maxReceiveCount attempts the record routes to the DLQ.
 *
 * Retryable  — transient conditions (network timeout, 5xx, 429).
 *              Retrying may succeed once the downstream recovers.
 * Non-retryable — permanent failures (bad payload, 4xx except 429).
 *              Retrying will never help; send straight to DLQ.
 */

/**
 * Thrown for failures that should NOT be retried.
 * Examples: malformed JSON payload, Salesforce 400/404/422.
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
 *   - Network / timeout errors (no HTTP response)
 *   - 429 Too Many Requests
 *   - 5xx server errors
 *
 * 4xx responses (except 429) are non-retryable — retrying won't fix bad data.
 *
 * @param {import('axios').AxiosError} err
 * @returns {boolean}
 */
function isRetryable(err) {
  if (!err.response) return true;            // network error or timeout
  if (err.response.status === 429) return true;
  return err.response.status >= 500;
}

/**
 * Extracts a human-readable error string from an axios error, including
 * Salesforce errorCode + message arrays when present in the response body.
 *
 * @param {import('axios').AxiosError} err
 * @returns {string}
 */
function salesforceErrorDetail(err) {
  if (!err.response) return err.message;
  const { status, data } = err.response;
  const detail = Array.isArray(data)
    ? data.map((e) => `${e.errorCode}: ${e.message}`).join('; ')
    : JSON.stringify(data);
  return `HTTP ${status} — ${detail}`;
}

module.exports = { NonRetryableError, isRetryable, salesforceErrorDetail };
