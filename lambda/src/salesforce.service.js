'use strict';

/**
 * salesforce.service.js — Salesforce Integration Service
 * ────────────────────────────────────────────────────────
 * Responsibility: own the Salesforce OAuth token lifecycle and the Case upsert
 * operation.  No Lambda event wiring, no logging concerns live here.
 *
 * INITIALISATION
 * ──────────────
 * Call initService() once after SSM/env vars have been loaded.  It validates
 * required config, creates the shared axios HTTP client, and reads Salesforce
 * credentials into module-level variables so they are reused across Lambda
 * warm invocations without re-reading process.env on every call.
 *
 * TOKEN CACHING
 * ─────────────
 * Salesforce Connected App tokens are valid for 2 hours.  Fetching a new token
 * on every invocation would be slow and may hit rate limits under high load.
 * We cache the token in memory and refresh it 5 minutes before expiry.
 * On a 401 response from the Salesforce API the cache is cleared so the next
 * call fetches a fresh token automatically.
 *
 * SSRF PREVENTION
 * ───────────────
 * SALESFORCE_INSTANCE_URL is validated to be a well-formed https:// URL at
 * startup.  Only the standard Salesforce data API path is constructed — no
 * user-supplied path segments are concatenated without encodeURIComponent.
 */

const axios = require('axios');
const { NonRetryableError, isRetryable, salesforceErrorDetail } = require('./errors');
const { log } = require('./logger');

// ─── Module-level state (reused across warm Lambda invocations) ───────────────

let SF_INSTANCE_URL;
let SF_CLIENT_ID;
let SF_CLIENT_SECRET;
let SF_TOKEN_URL;
let http;

let cachedToken    = null;
let tokenExpiresAt = 0;

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Validates Salesforce config from process.env, creates the axios HTTP client,
 * and stores credentials in module-level variables.
 *
 * Must be called once after loadConfig() has populated process.env.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @throws {Error} when SALESFORCE_INSTANCE_URL is missing or non-HTTPS.
 */
function initService() {
  // Validate required env vars.
  const REQUIRED = [
    'SALESFORCE_INSTANCE_URL',
    'SALESFORCE_CLIENT_ID',
    'SALESFORCE_CLIENT_SECRET',
  ];
  for (const key of REQUIRED) {
    if (!process.env[key]) {
      throw new Error(`Lambda misconfiguration: missing required environment variable "${key}"`);
    }
  }

  SF_INSTANCE_URL  = process.env.SALESFORCE_INSTANCE_URL.replace(/\/$/, '');
  SF_CLIENT_ID     = process.env.SALESFORCE_CLIENT_ID;
  SF_CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;
  SF_TOKEN_URL     = process.env.SALESFORCE_TOKEN_URL
    || 'https://login.salesforce.com/services/oauth2/token';

  // SSRF prevention — reject non-HTTPS or malformed URLs at startup.
  try {
    const parsed = new URL(SF_INSTANCE_URL);
    if (parsed.protocol !== 'https:') {
      throw new Error('protocol must be https');
    }
  } catch (err) {
    throw new Error(
      `Lambda misconfiguration: invalid SALESFORCE_INSTANCE_URL — ${err.message}`,
    );
  }

  // HTTP_TIMEOUT_MS defaults to 10 s — increase for sandbox envs under load.
  const httpTimeoutMs = parseInt(process.env.HTTP_TIMEOUT_MS || '10000', 10);
  http = axios.create({ timeout: httpTimeoutMs });
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
  // Salesforce tokens live for 2 hours; refresh 5 minutes before expiry.
  tokenExpiresAt = Date.now() + 115 * 60 * 1000;
  return cachedToken;
}

function invalidateToken() {
  cachedToken    = null;
  tokenExpiresAt = 0;
}

// ─── Salesforce Case upsert ───────────────────────────────────────────────────

/**
 * Creates or updates a Salesforce Case for the given application payload,
 * using External_ID__c (applicationId) as the idempotency key.
 *
 * @param {object} payload - Validated application event payload.
 * @param {string} payload.applicationId
 * @param {string} payload.applicantName
 * @param {string} payload.applicantEmail
 * @param {object} [payload.data]
 * @throws {NonRetryableError} for permanent Salesforce 4xx rejections.
 * @throws {Error} for transient failures that SQS should retry.
 */
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

  // encodeURIComponent guards against path traversal in the External ID segment.
  const url = `${SF_INSTANCE_URL}/services/data/v59.0/sobjects/Case/External_ID__c/${encodeURIComponent(payload.applicationId)}`;

  try {
    await http.patch(url, caseRecord, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    // 401 — token may have been revoked; clear cache so the next SQS retry
    // fetches a fresh token automatically.
    if (err.response?.status === 401) {
      invalidateToken();
      throw new Error(
        `Salesforce returned 401 — token invalidated, will retry: ${salesforceErrorDetail(err)}`,
      );
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

module.exports = { initService, syncToSalesforce };
