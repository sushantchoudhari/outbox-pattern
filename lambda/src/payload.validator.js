'use strict';

/**
 * payload.validator.js — SNS Message Payload Validation
 * ───────────────────────────────────────────────────────
 * Responsibility: validate that the parsed SNS Message payload contains the
 * fields required to create a Salesforce Case.
 *
 * Throws NonRetryableError for any invalid payload — bad data will never
 * become valid on retry, so it routes directly to the DLQ.
 */

const { NonRetryableError } = require('./errors');

/**
 * Validates the parsed application event payload.
 * Required fields: applicationId, applicantName, applicantEmail (all strings).
 *
 * @param {unknown} payload
 * @throws {NonRetryableError} when the payload is missing or has invalid fields.
 */
function validatePayload(payload) {
  if (typeof payload !== 'object' || payload === null) {
    throw new NonRetryableError('SNS Message payload is not a JSON object');
  }

  const invalid = ['applicationId', 'applicantName', 'applicantEmail']
    .filter((k) => !payload[k] || typeof payload[k] !== 'string');

  if (invalid.length > 0) {
    throw new NonRetryableError(
      `Payload missing or invalid required fields: ${invalid.join(', ')}`,
    );
  }
}

module.exports = { validatePayload };
