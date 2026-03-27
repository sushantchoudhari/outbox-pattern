'use strict';

/**
 * config.js — AWS SSM Parameter Store Loader
 * ────────────────────────────────────────────
 * Loads parameters from AWS SSM Parameter Store into process.env.
 *
 * HOW IT WORKS:
 *   - When SSM_PARAMETER_PREFIX is set (production): fetches all parameters
 *     under that path prefix and merges them into process.env.  Secrets live
 *     in SSM (encrypted) instead of being injected as plain environment variables.
 *   - When SSM_PARAMETER_PREFIX is not set (local / dev / CI): no-op — plain
 *     process.env values set by Docker Compose or your .env file are used as-is.
 *
 * PARAMETER NAMING CONVENTION (store parameters at /<prefix>/<ENV_VAR_NAME>):
 *   /outbox-pattern/production/SALESFORCE_INSTANCE_URL
 *   /outbox-pattern/production/SALESFORCE_CLIENT_ID
 *   /outbox-pattern/production/SALESFORCE_CLIENT_SECRET
 *   /outbox-pattern/production/SALESFORCE_TOKEN_URL
 *
 *   Mark SALESFORCE_CLIENT_SECRET as SecureString in SSM — it will be
 *   decrypted automatically (WithDecryption: true).
 *
 * ENV VARS CONSUMED BY THIS MODULE:
 *   SSM_PARAMETER_PREFIX  Required to activate SSM loading.
 *                         e.g. /outbox-pattern/production
 *   AWS_REGION            Region where parameters are stored. Default: us-east-1
 *   SSM_ENDPOINT          Optional override for LocalStack testing.
 *                         e.g. http://localhost:4566
 *
 * SAFETY:
 *   - Called only once per process/cold-start (guarded by `loaded` flag).
 *   - If the prefix exists but has no parameters, startup fails loudly so
 *     a misconfigured deployment surfaces immediately rather than silently
 *     running with missing secrets.
 */

const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');

let loaded = false;

/**
 * Fetches all SSM parameters under SSM_PARAMETER_PREFIX and writes them
 * into process.env.  Safe to call multiple times — subsequent calls are no-ops.
 *
 * @returns {Promise<void>}
 */
async function loadConfig() {
  if (loaded) return;

  const prefix = process.env.SSM_PARAMETER_PREFIX;

  // No prefix — run in env-var-only mode (local, dev, CI).
  if (!prefix) {
    loaded = true;
    return;
  }

  const clientConfig = {
    region: process.env.AWS_REGION || 'us-east-1',
  };

  // SSM_ENDPOINT lets you point to LocalStack to test SSM loading without
  // a real AWS account.  Leave unset in production.
  if (process.env.SSM_ENDPOINT) {
    clientConfig.endpoint = process.env.SSM_ENDPOINT;
  }

  const client = new SSMClient(clientConfig);
  const parameters = [];
  let nextToken;

  // GetParametersByPath is paginated — collect every page before proceeding.
  do {
    const command = new GetParametersByPathCommand({
      Path:           prefix,
      WithDecryption: true,  // decrypts SecureString parameters
      Recursive:      false, // only immediate children of the prefix path
      ...(nextToken ? { NextToken: nextToken } : {}),
    });

    const response = await client.send(command);
    parameters.push(...(response.Parameters || []));
    nextToken = response.NextToken;
  } while (nextToken);

  // Zero parameters = misconfiguration.  Fail loudly rather than starting
  // with empty secrets that would silently break every downstream call.
  if (parameters.length === 0) {
    throw new Error(
      `[config] No parameters found under SSM prefix "${prefix}". ` +
      'Verify SSM_PARAMETER_PREFIX is correct and the IAM role has ssm:GetParametersByPath permission.',
    );
  }

  // Strip the prefix and write each parameter into process.env.
  // /outbox-pattern/production/SALESFORCE_CLIENT_SECRET → SALESFORCE_CLIENT_SECRET
  for (const param of parameters) {
    const name = param.Name.slice(prefix.length).replace(/^\//, '');
    if (name && param.Value !== undefined) {
      process.env[name] = param.Value;
    }
  }

  loaded = true;
  console.log(`[config] Loaded ${parameters.length} parameter(s) from SSM prefix "${prefix}"`);
}

module.exports = { loadConfig };
