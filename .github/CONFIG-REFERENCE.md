# Configuration Reference

This document explains every environment variable and configuration file used across
all services in this repository. Read this before running the project locally or
deploying to any environment.

---

## Table of Contents

1. [How configuration works](#1-how-configuration-works)
2. [Database (PostgreSQL)](#2-database-postgresql)
3. [SNS — Application Events Topic](#3-sns--application-events-topic)
4. [SQS — Queue and Dead Letter Queue](#4-sqs--queue-and-dead-letter-queue)
5. [Worker — Outbox Publisher](#5-worker--outbox-publisher)
6. [Lambda — Salesforce Integration Consumer](#6-lambda--salesforce-integration-consumer)
7. [API (express-ts-api)](#7-api-express-ts-api)
8. [Docker Compose environment values](#8-docker-compose-environment-values)
9. [AWS CLI / LocalStack credentials](#9-aws-cli--localstack-credentials)
10. [Environment-by-environment summary](#10-environment-by-environment-summary)
11. [How to add or change a variable](#11-how-to-add-or-change-a-variable)

---

## 1. How configuration works

Each service reads its config from environment variables.
In local development those variables are set in two places:

| Source | Used by |
|--------|---------|
| `.env.example` (root) | Copy to `.env` for running services outside Docker |
| `docker-compose.yml` → `environment:` block | Applied automatically when using `docker compose up` |
| `express-ts-api/.env.<environment>` | Used by the TypeScript API only |

**Never commit real secrets.** Only `.env.example` files (with placeholder values)
are tracked in git. Real credentials must be injected at deploy time via a secrets
manager (AWS Secrets Manager, Vault, CI/CD environment variables, etc.).

---

## 2. Database (PostgreSQL)

Used by: **API**, **Worker**, **migration job**

| Variable | Example value | Description |
|----------|--------------|-------------|
| `DB_HOST` | `localhost` (local) / `postgres` (Docker) | Hostname of the Postgres server. Use `postgres` inside Docker Compose because that is the container name. |
| `DB_PORT` | `5432` | Standard Postgres port. Only change if you run Postgres on a non-default port. |
| `DB_NAME` | `appdb` | Database name. Created automatically by the Postgres Docker image. |
| `DB_USER` | `postgres` | Database user. Matches `POSTGRES_USER` in the Postgres container. |
| `DB_PASSWORD` | `postgres` (local) / secret (prod) | Database password. **Must be a strong secret in production.** |

### Database schema
Migrations live in `migrations/001_init.sql`. Two tables are created:

| Table | Purpose |
|-------|---------|
| `applications` | Stores submitted applications (id, name, email, status, data, timestamps) |
| `outbox_events` | Stores unpublished events for the outbox relay worker |

Key column in `outbox_events`:

| Column | Type | Meaning |
|--------|------|---------|
| `published` | BOOLEAN | `FALSE` = not yet sent to SNS, `TRUE` = already delivered |
| `sns_message_id` | VARCHAR | SNS MessageId returned after successful publish (for tracing) |

### Production notes
- Use a connection pool (pg Pool) — do not open a new connection per request.
- Set `DB_PASSWORD` via AWS Secrets Manager or equivalent — never hardcode.
- Run migrations as a one-off job before deploying new application code.

---

## 3. SNS — Application Events Topic

Used by: **Worker** (publishes), **LocalStack init script** (creates)

| Variable | Local value | Production value | Description |
|----------|------------|-----------------|-------------|
| `AWS_REGION` | `us-east-1` | Your AWS region | Region where the SNS topic exists. |
| `SNS_TOPIC_ARN` | `arn:aws:sns:us-east-1:000000000000:application-events` | Real ARN from AWS Console | Full ARN of the topic. LocalStack uses account `000000000000`. Real AWS uses your 12-digit account ID. |
| `SNS_ENDPOINT` | `http://localstack:4566` (Docker) / `http://localhost:4566` (local) | **leave unset** | Override endpoint for LocalStack. In production remove this variable entirely — the SDK connects to real AWS automatically. |
| `AWS_ACCESS_KEY_ID` | `test` | Not needed — use IAM role | LocalStack accepts any value. In production use an ECS/EC2 task role — no access key needed. |
| `AWS_SECRET_ACCESS_KEY` | `test` | Not needed — use IAM role | Same as above. |

### Topic details

| Property | Value |
|----------|-------|
| Topic name | `application-events` |
| Message format | JSON string (`JSON.stringify(event.payload)`) |
| MessageAttributes sent | `eventType` (String), `aggregateType` (String) |

### Why MessageAttributes?
They let downstream Lambda/SQS consumers filter messages without parsing the body.
For example, a Lambda that only processes `ApplicationSubmitted` events can add a
subscription filter policy instead of reading every message.

---

## 4. SQS — Queue and Dead Letter Queue

Used by: **LocalStack init script** (creates), **Lambda** (consumes), **deploy script** (wires)

| Resource | Name | Description |
|----------|------|-------------|
| Main queue | `salesforce-integration-queue` | Receives SNS fan-out messages. Lambda polls this queue. |
| Dead Letter Queue | `salesforce-integration-dlq` | Receives messages that failed 3 times (maxReceiveCount = 3). |

### Queue settings

| Setting | Value | Why |
|---------|-------|-----|
| `VisibilityTimeout` | `30` seconds | Message is hidden from other consumers while Lambda is processing. Set higher than your Lambda timeout. |
| `maxReceiveCount` | `3` | After 3 failed attempts the message moves to the DLQ automatically. |
| `RawMessageDelivery` | `false` | SNS wraps the message in a notification envelope. Lambda handler unwraps it. |
| Batch size (event source mapping) | `5` | Lambda receives up to 5 messages per invocation. |
| `ReportBatchItemFailures` | enabled | Failed individual records are retried without re-processing the entire batch. |

### Local ARNs (LocalStack)
```
Queue ARN : arn:aws:sqs:us-east-1:000000000000:salesforce-integration-queue
DLQ ARN   : arn:aws:sqs:us-east-1:000000000000:salesforce-integration-dlq
```

### SQS resource policy
The init script sets a resource policy on the queue that allows only the
`application-events` SNS topic to call `sqs:SendMessage`. This prevents
other services from writing directly to the queue.

---

## 5. Worker — Outbox Publisher

Service location: `worker/`
Entry point: `worker/src/index.js`

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MS` | `5000` | How often (milliseconds) the worker checks the database for unpublished events. Lower = faster delivery but more DB queries. Higher = cheaper but higher latency. |
| `BATCH_SIZE` | `10` | How many outbox_events rows to fetch and publish per poll cycle. Larger batches mean fewer DB round-trips but a bigger rollback if something fails mid-batch. |
| `DB_HOST` | — | See [Database](#2-database-postgresql) |
| `DB_PORT` | — | See [Database](#2-database-postgresql) |
| `DB_NAME` | — | See [Database](#2-database-postgresql) |
| `DB_USER` | — | See [Database](#2-database-postgresql) |
| `DB_PASSWORD` | — | See [Database](#2-database-postgresql) |
| `SNS_TOPIC_ARN` | — | See [SNS](#3-sns--application-events-topic) |
| `SNS_ENDPOINT` | — | See [SNS](#3-sns--application-events-topic) |
| `AWS_REGION` | `us-east-1` | See [SNS](#3-sns--application-events-topic) |
| `AWS_ACCESS_KEY_ID` | `test` | See [SNS](#3-sns--application-events-topic) |
| `AWS_SECRET_ACCESS_KEY` | `test` | See [SNS](#3-sns--application-events-topic) |

### How the worker poll cycle works
```
every POLL_INTERVAL_MS milliseconds:
  BEGIN transaction
    SELECT up to BATCH_SIZE unpublished events  (FOR UPDATE SKIP LOCKED)
    for each event:
      publish to SNS
      UPDATE outbox_events SET published=TRUE, sns_message_id=<id>
  COMMIT
  (on any error → ROLLBACK, events remain published=FALSE, retry next cycle)
```

`FOR UPDATE SKIP LOCKED` makes it safe to run multiple worker instances in parallel —
each instance locks different rows and they never conflict.

---

## 6. Lambda — Salesforce Integration Consumer

Service location: `lambda/`
Handler: `lambda/src/handler.js` → export `handler`
Runtime: `nodejs20.x`

### Module structure

Each file has a single responsibility:

| File | Responsibility |
|------|---------------|
| `lambda/src/handler.js` | Entry point: cold-start init, SQS record loop, batch failure reporting |
| `lambda/src/salesforce.service.js` | Salesforce OAuth2 token caching + Case upsert |
| `lambda/src/payload.validator.js` | Validate the parsed SNS message payload |
| `lambda/src/errors.js` | `NonRetryableError` class, `isRetryable()`, `salesforceErrorDetail()` |
| `lambda/src/logger.js` | Structured JSON logger (CloudWatch Logs Insights compatible) |
| `lambda/src/config.js` | SSM Parameter Store / env loader |

### Environment variables

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `SALESFORCE_INSTANCE_URL` | **Yes** | `https://yourorg.my.salesforce.com` | Base URL of your Salesforce org. Must be `https://`. |
| `SALESFORCE_CLIENT_ID` | **Yes** | `3MVG9...` | OAuth2 Connected App client ID from Salesforce Setup. |
| `SALESFORCE_CLIENT_SECRET` | **Yes** | `abc123...` | OAuth2 Connected App client secret. **Inject via Secrets Manager — never hardcode.** |
| `SALESFORCE_TOKEN_URL` | No | `https://login.salesforce.com/services/oauth2/token` | OAuth2 token endpoint. Default is production login. Override to `https://test.salesforce.com/services/oauth2/token` for sandbox. |
| `HTTP_TIMEOUT_MS` | No | `10000` | Axios HTTP timeout in milliseconds. Increase for slow sandbox environments. Default: `10000`. |
| `SSM_PARAMETER_PREFIX` | No | `/outbox-pattern/production` | When set, loads all SSM parameters under this path into `process.env` on cold start. Leave unset in local/dev. |

### Lambda deployment settings (deploy script default)

| Setting | Value | Description |
|---------|-------|-------------|
| Function name | `salesforce-integration-consumer` | Used in all AWS CLI commands |
| Timeout | `30` seconds | Lambda execution time limit. Set higher than worst-case Salesforce API call. |
| Batch size | `5` | SQS records per Lambda invocation |
| IAM Role (local) | `arn:aws:iam::000000000000:role/lambda-role` | LocalStack accepts any role ARN |

### How the Lambda processes a message
```
SQS batch arrives (up to 5 records)
  for each record:
    unwrap SNS notification envelope → extract JSON payload
    obtain Salesforce OAuth2 token (cached until 5 min before expiry)
    POST /services/apexrest/ApplicationIntegration/ to Salesforce
    on 4xx (non-retryable) → mark record in batchItemFailures
    on 5xx / network error → mark record in batchItemFailures (retried by SQS)
return { batchItemFailures: [...] }
```

Records in `batchItemFailures` stay in the queue and are retried.
After 3 total attempts (`maxReceiveCount`) they move to the DLQ.

### Token caching
The Lambda caches the Salesforce OAuth2 token in memory between invocations
(within the same warm container). The token is refreshed if it expires within
5 minutes. This avoids an extra HTTP round-trip per message.

---

## 7. API (express-ts-api)

Service location: `express-ts-api/`
Config source of truth: `express-ts-api/src/config/index.ts`

The TypeScript API uses environment-specific `.env` files loaded by `dotenv`.
The file is chosen based on `NODE_ENV`:

| NODE_ENV | File loaded |
|----------|------------|
| `development` | `.env.development` |
| `testing` | `.env.testing` |
| `preprod` | `.env.preprod` |
| `production` | `.env.production` |

### All variables

| Variable | Dev default | Test default | Preprod | Production | Description |
|----------|------------|-------------|---------|-----------|-------------|
| `NODE_ENV` | `development` | `testing` | `preprod` | `production` | Controls which `.env` file loads and which features are active |
| `PORT` | `3000` | `3001` | `3000` | `3000` | HTTP port the server listens on |
| `JWT_SECRET` | `dev-secret-key-that-is-at-least-thirty-two-characters` | `test-secret-...` | placeholder | **inject via Secrets Manager** | Signs and verifies JWT tokens. **Minimum 32 characters. Never reuse across environments.** |
| `JWT_EXPIRES_IN` | `7d` | `1h` | `1d` | `1d` | JWT token validity. Short in test to catch expiry bugs. |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | `900000` | `900000` | `900000` | Rate-limit sliding window in milliseconds |
| `RATE_LIMIT_MAX` | `1000` | `10000` | `200` | `100` | Max requests per IP per window. Relaxed in dev/test, strict in prod. |
| `CORS_ORIGIN` | `*` | `*` | `https://preprod.example.com` | `https://app.example.com` | Allowed CORS origin. Wildcard only in non-production. |
| `LOG_LEVEL` | `debug` | `silent` | `info` | `warn` | Pino log level. `silent` in tests suppresses all output. |
| `DATABASE_URL` | *(empty)* | *(empty)* | `postgresql://user:pass@host:5432/db` | **inject via Secrets Manager** | PostgreSQL connection string. Leave empty to use the in-memory Map store (no DB needed). |

### Startup validation
All variables are validated with Zod in `src/config/index.ts` on startup.
If any required variable is missing or invalid the app **exits immediately** with a clear error message listing every problem.
This prevents deploying with a broken config.

---

## 8. Docker Compose environment values

File: `docker-compose.yml`

When you run `docker compose up`, Docker injects these values directly into each container.
You do not need a `.env` file for the Docker Compose services.

### `postgres` container

| Variable | Value | Purpose |
|----------|-------|---------|
| `POSTGRES_DB` | `appdb` | Creates this database on first start |
| `POSTGRES_USER` | `postgres` | Superuser name |
| `POSTGRES_PASSWORD` | `postgres` | Superuser password |

### `localstack` container

| Variable | Value | Purpose |
|----------|-------|---------|
| `SERVICES` | `sns,sqs,lambda` | Only these three AWS services are emulated |
| `DEFAULT_REGION` | `us-east-1` | Default region for all LocalStack resources |
| `DEBUG` | `0` | Set to `1` to see verbose LocalStack logs |
| `LAMBDA_EXECUTOR` | `local` | Runs Lambda functions in the same process (no Docker-in-Docker needed) |
| `PERSISTENCE` | `0` | Resources are not persisted to disk — recreated on every start |

### `api` container

| Variable | Value |
|----------|-------|
| `DB_HOST` | `postgres` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `appdb` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | `postgres` |
| `PORT` | `3000` |

### `worker` container

| Variable | Value |
|----------|-------|
| `DB_HOST` | `postgres` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `appdb` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | `postgres` |
| `SNS_ENDPOINT` | `http://localstack:4566` |
| `SNS_TOPIC_ARN` | `arn:aws:sns:us-east-1:000000000000:application-events` |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | `test` |
| `AWS_SECRET_ACCESS_KEY` | `test` |
| `POLL_INTERVAL_MS` | `5000` |
| `BATCH_SIZE` | `10` |

---

## 9. AWS CLI / LocalStack credentials

File: `aws/credentials` and `aws/config`

These files configure the `awslocal` CLI tool used in the init and deploy scripts.
They are **only for local development** — they do not affect production.

`aws/credentials`:
```ini
[localstack]
aws_access_key_id     = test
aws_secret_access_key = test
```

`aws/config`:
```ini
[profile localstack]
region       = us-east-1
output       = json
endpoint_url = http://localhost:4566
```

Use `--profile localstack` with any `awslocal` command to target LocalStack.

---

## 10. Environment-by-environment summary

| Service | Local (outside Docker) | Local (Docker Compose) | CI / Test | Preprod | Production |
|---------|----------------------|----------------------|-----------|---------|-----------|
| **DB host** | `localhost` | `postgres` | `localhost` or test DB | managed RDS | managed RDS |
| **DB password** | `postgres` | `postgres` | CI secret | Secrets Manager | Secrets Manager |
| **SNS endpoint** | `http://localhost:4566` | `http://localstack:4566` | LocalStack in CI | *(unset)* | *(unset)* |
| **SNS_TOPIC_ARN** | `arn:…:000000000000:…` | `arn:…:000000000000:…` | `arn:…:000000000000:…` | real ARN | real ARN |
| **AWS credentials** | `test` / `test` | `test` / `test` | CI test creds | IAM task role | IAM task role |
| **JWT_SECRET** | dev placeholder | dev placeholder | test placeholder | Secrets Manager | Secrets Manager |
| **LOG_LEVEL** | `debug` | `debug` | `silent` | `info` | `warn` |
| **SALESFORCE_**** | placeholder | placeholder | mock / sandbox | sandbox | production org |

---

## 11. How to add or change a variable

### Adding a new variable to an existing service

1. Add it to `.env.example` with a placeholder value and a comment explaining what it does.
2. Add it to the relevant `environment:` block in `docker-compose.yml`.
3. If the service is the TypeScript API (`express-ts-api`):
   - Add the variable to `src/config/index.ts` inside the Zod `envSchema`.
   - Export it from the `config` object.
   - Update all four `.env.*` files with appropriate values per environment.
4. Update this document.

### Changing an existing variable's value

- For local development: edit the relevant `environment:` block in `docker-compose.yml` or your local `.env` file.
- For production: update the value in AWS Secrets Manager (or your secrets provider) and redeploy. Never change `.env.production` values in git.

### Rotating secrets (JWT_SECRET, DB_PASSWORD, Salesforce credentials)
1. Generate a new value.
2. Update the value in your secrets manager.
3. Redeploy the affected service. All new tokens will use the new secret.
4. Old tokens signed with the previous secret will become invalid — plan a maintenance window if needed.
