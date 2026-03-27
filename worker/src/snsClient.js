'use strict';

/**
 * snsClient.js — SNS Client Factory
 * ───────────────────────────────────
 * Responsibility: create and export a single, shared SNS client instance.
 *
 * ONE INSTANCE PER PROCESS
 * ────────────────────────
 * Creating an SNS client is not free — it involves TLS setup and SDK
 * initialisation.  We create it once at startup and share it everywhere.
 *
 * LOCAL vs PRODUCTION
 * ───────────────────
 * LOCAL:      SNS_ENDPOINT → LocalStack (http://localstack:4566)
 * PRODUCTION: SNS_ENDPOINT unset → SDK auto-routes to real AWS SNS.
 *
 * CREDENTIALS
 * ───────────
 * In production the ECS/EC2 task role provides credentials automatically.
 * The AWS SDK picks them up via its default credential chain — no explicit
 * keys needed.  In local/dev the placeholder "test" values satisfy LocalStack.
 */

const { SNSClient } = require('@aws-sdk/client-sns');

const snsClient = new SNSClient({
  region:   process.env.AWS_REGION || 'us-east-1',

  // undefined in production — the SDK connects to real AWS automatically.
  // http://localstack:4566 in Docker Compose local dev.
  endpoint: process.env.SNS_ENDPOINT || undefined,

  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

module.exports = snsClient;
