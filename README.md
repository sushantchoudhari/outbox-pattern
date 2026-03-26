# Transactional Outbox Pattern

A production-grade reference implementation of the **Transactional Outbox Pattern** using Node.js, PostgreSQL, AWS SNS/SQS (via LocalStack), and AWS Lambda with a Salesforce integration consumer.

---

## Table of Contents

1. [What Is the Outbox Pattern?](#1-what-is-the-outbox-pattern)
2. [Architecture Overview](#2-architecture-overview)
3. [Component Breakdown](#3-component-breakdown)
4. [Data Model](#4-data-model)
5. [Event Flow — Step by Step](#5-event-flow--step-by-step)
6. [Prerequisites](#6-prerequisites)
7. [Quick Start (Local)](#7-quick-start-local)
8. [Verifying the Stack](#8-verifying-the-stack)
9. [Deploying the Lambda Locally](#9-deploying-the-lambda-locally)
10. [API Reference](#10-api-reference)
11. [Configuration Reference](#11-configuration-reference)
12. [Production Deployment Guide](#12-production-deployment-guide)
13. [Reliability & Safety Guarantees](#13-reliability--safety-guarantees)
14. [Troubleshooting](#14-troubleshooting)
15. [Project Structure](#15-project-structure)

---

## 1. What Is the Outbox Pattern?

Distributed systems face a fundamental problem: writing to a database and publishing a message to a broker (SNS, Kafka, RabbitMQ, etc.) are two separate I/O operations. A crash between them leaves the system in an inconsistent state — the database row exists but the event is never published, or vice versa.

The **Transactional Outbox Pattern** solves this by:

1. Writing both the business data **and** an event record to the **same database** in a **single ACID transaction**.
2. Having a separate **worker process** poll the `outbox_events` table and relay pending events to the message broker.
3. Because the database write is atomic, the two records are always consistent. The worst case is the worker publishes an event twice — consumers handle this via idempotency keys.

```
┌─────────────────────────────────────────────────────────────────┐
│                       Single DB Transaction                      │
│                                                                  │
│   INSERT INTO applications (...)                                 │
│   INSERT INTO outbox_events (published = FALSE, ...)             │
└─────────────────────────────────────────────────────────────────┘
         ↓  (atomic commit or full rollback)
┌────────────────────────┐       ┌──────────────────────────────┐
│   applications table   │       │      outbox_events table      │
│   id | name | status   │       │  id | payload | published=F   │
└────────────────────────┘       └──────────────────────────────┘
                                          ↓  (worker polls)
                                   ┌─────────────────┐
                                   │   AWS SNS Topic  │
                                   └─────────────────┘
                                          ↓
                                   ┌─────────────────┐
                                   │   AWS SQS Queue  │
                                   └─────────────────┘
                                          ↓
                                   ┌─────────────────┐
                                   │  Lambda Function │
                                   │  → Salesforce    │
                                   └─────────────────┘
```

---

## 2. Architecture Overview

```
┌──────────────┐   POST /applications   ┌──────────────────────────┐
│   Client     │ ─────────────────────▶ │        API Service        │
│  (curl/app)  │                        │  Node.js + Express        │
└──────────────┘                        │  Port 3000                │
                                        └────────────┬─────────────┘
                                                     │  BEGIN TX
                                                     │  INSERT applications
                                                     │  INSERT outbox_events
                                                     │  COMMIT
                                        ┌────────────▼─────────────┐
                                        │       PostgreSQL 15        │
                                        │  applications             │
                                        │  outbox_events            │
                                        └────────────┬─────────────┘
                                                     │  SELECT … FOR UPDATE SKIP LOCKED
                                        ┌────────────▼─────────────┐
                                        │     Worker Service        │
                                        │  Polls every 5 s          │
                                        │  Batch size: 10           │
                                        └────────────┬─────────────┘
                                                     │  Publish
                                        ┌────────────▼─────────────┐
                                        │  SNS Topic                │
                                        │  application-events       │
                                        └────────────┬─────────────┘
                                                     │  Fan-out
                                        ┌────────────▼─────────────┐
                                        │  SQS Queue                │
                                        │  salesforce-integration   │
                                        │  (DLQ: maxReceiveCount=3) │
                                        └────────────┬─────────────┘
                                                     │  Trigger
                                        ┌────────────▼─────────────┐
                                        │  Lambda Function          │
                                        │  salesforce-integration   │
                                        │  -consumer                │
                                        └────────────┬─────────────┘
                                                     │  PATCH upsert
                                        ┌────────────▼─────────────┐
                                        │  Salesforce CRM           │
                                        │  Case (External_ID__c)    │
                                        └──────────────────────────┘
```

All AWS resources (SNS, SQS, Lambda) run locally via **LocalStack** for development and testing.

---

## 3. Component Breakdown

### `api/` — Applicant API

| Item | Detail |
|------|--------|
| Runtime | Node.js 20, Express 4 |
| Port | 3000 |
| Responsibility | Accept application submissions; write `applications` + `outbox_events` atomically |
| Key guarantee | If either INSERT fails, the whole transaction rolls back — no orphaned events |

### `worker/` — Outbox Publisher

| Item | Detail |
|------|--------|
| Runtime | Node.js 20 |
| Responsibility | Poll `outbox_events WHERE published = FALSE`, publish each to SNS, mark as published |
| Concurrency safety | `FOR UPDATE SKIP LOCKED` — multiple worker replicas never compete for the same row |
| Poll interval | `POLL_INTERVAL_MS` env var (default: 5 000 ms) |
| Batch size | `BATCH_SIZE` env var (default: 10) |
| Error handling | On any SNS failure the DB transaction rolls back; the row stays unpublished and is retried next cycle |

### `lambda/` — Salesforce Integration Consumer

| Item | Detail |
|------|--------|
| Runtime | Node.js 20 (Lambda) |
| Trigger | SQS event source mapping (batch size: 5) |
| Responsibility | Unpack SNS envelope → upsert Salesforce Case via REST API |
| Idempotency | Uses `PATCH /sobjects/Case/External_ID__c/<applicationId>` — duplicate deliveries update the same Case instead of creating duplicates |
| Partial failures | Returns `{ batchItemFailures }` — only failed messages are retried, not the whole batch |
| Dead-letter | After 3 failed attempts the message moves to `salesforce-integration-dlq` |

### `localstack/` — Local AWS Infrastructure

Runs inside the LocalStack container at startup (`ready.d` hook).

Creates:
- SQS Dead Letter Queue: `salesforce-integration-dlq`
- SQS Queue: `salesforce-integration-queue` (redrive to DLQ after 3 failures, visibility timeout 30 s)
- SNS Topic: `application-events`
- SNS → SQS subscription (raw message delivery: **off** — SNS envelope is preserved)
- SQS resource policy allowing SNS to deliver

### `migrations/` — Database Schema

Single migration file (`001_init.sql`) applied once by the `migrate` Docker Compose service.

---

## 4. Data Model

### `applications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `applicant_name` | VARCHAR(255) NOT NULL | |
| `applicant_email` | VARCHAR(255) NOT NULL | |
| `status` | VARCHAR(50) NOT NULL | Default: `submitted` |
| `data` | JSONB NOT NULL | Arbitrary metadata |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `outbox_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `aggregate_type` | VARCHAR(100) NOT NULL | e.g. `Application` |
| `aggregate_id` | UUID NOT NULL | FK to `applications.id` |
| `event_type` | VARCHAR(100) NOT NULL | e.g. `ApplicationSubmitted` |
| `payload` | JSONB NOT NULL | Full event payload |
| `published` | BOOLEAN NOT NULL | Default: `FALSE` |
| `published_at` | TIMESTAMPTZ | Set when marked published |
| `sns_message_id` | VARCHAR(255) | Returned by SNS |
| `created_at` | TIMESTAMPTZ | Used for ORDER BY in poll query |

**Index:** `idx_outbox_unpublished` — partial index on `created_at ASC WHERE published = FALSE`. This keeps the worker's poll query fast even with millions of published rows.

---

## 5. Event Flow — Step by Step

```
 1.  Client          POST /applications  { applicantName, applicantEmail, data }
 2.  API             BEGIN TRANSACTION
 3.  API             INSERT INTO applications → returns new UUID
 4.  API             INSERT INTO outbox_events (published=FALSE, payload=…)
 5.  API             COMMIT
 6.  API             201 Created → application JSON
         ─── up to POLL_INTERVAL_MS later ───
 7.  Worker          SELECT … FROM outbox_events WHERE published=FALSE FOR UPDATE SKIP LOCKED
 8.  Worker          sns.publish(TopicArn, message, messageAttributes)
 9.  Worker          UPDATE outbox_events SET published=TRUE, sns_message_id=…
10.  Worker          COMMIT
         ─── AWS fan-out ───
11.  SNS             Delivers SNS envelope to SQS queue
12.  Lambda          Triggered by SQS event source mapping
13.  Lambda          Parse SNS envelope → extract payload
14.  Lambda          GET Salesforce OAuth2 token (cached 115 min)
15.  Lambda          PATCH Salesforce Case upsert (External_ID__c = applicationId)
16.  Lambda          Return { batchItemFailures: [] }  ← success
         ─── on failure ───
17.  SQS             Message becomes visible again (up to 3 times)
18.  SQS             After 3 failures → moves to DLQ
```

---

## 6. Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Docker | 24+ | Run all services |
| Docker Compose | 2.20+ | Orchestrate containers |
| Node.js | 20+ | Local Lambda packaging |
| npm | 9+ | Lambda dependency install |
| AWS CLI | 2+ | Running `verify-localstack.sh` |
| `awslocal` | latest | Lambda deploy script |

Install `awslocal`:
```bash
pip install awscli-local
```

Verify Docker is running:
```bash
docker info
```

---

## 7. Quick Start (Local)

### Step 1 — Clone and enter the project

```bash
git clone <repo-url> outbox-pattern
cd outbox-pattern
```

### Step 2 — Start the full stack

```bash
docker compose up --build
```

This single command will:
1. Start **PostgreSQL 15** and wait until it is healthy.
2. Run the **migration** container to apply `001_init.sql`.
3. Start **LocalStack** and execute `localstack/init-aws.sh` to create SNS/SQS resources.
4. Build and start the **API** service (port 3000).
5. Build and start the **Worker** service (polls every 5 s).

Expected healthy output:
```
localstack   | Ready.
api          | [api] Server listening on port 3000
worker       | [worker] Outbox publisher started
worker       | [worker] Topic  : arn:aws:sns:us-east-1:000000000000:application-events
worker       | [worker] Poll   : every 5000ms
worker       | [worker] Batch  : up to 10 rows
```

### Step 3 — Submit a test application

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{
    "applicantName": "Jane Smith",
    "applicantEmail": "jane@example.com",
    "data": { "position": "Software Engineer", "yearsExperience": 5 }
  }' | jq
```

Expected response (`201 Created`):
```json
{
  "id": "a1b2c3d4-...-uuid",
  "applicant_name": "Jane Smith",
  "applicant_email": "jane@example.com",
  "status": "submitted",
  "data": { "position": "Software Engineer", "yearsExperience": 5 },
  "created_at": "2026-03-26T10:00:00.000Z",
  "updated_at": "2026-03-26T10:00:00.000Z"
}
```

### Step 4 — Watch the worker publish the event

Within 5 seconds you should see in the worker logs:
```
[worker] Processing 1 outbox event(s)…
[worker] event=a1b2c3d4-… type=ApplicationSubmitted → SNS msgId=abc123
[worker] Cycle complete — published 1 event(s)
```

### Step 5 — Retrieve the application

```bash
curl http://localhost:3000/applications/<id-from-step-3> | jq
```

### Step 6 — Check the health endpoint

```bash
curl http://localhost:3000/health
# → {"status":"ok"}
```

---

## 8. Verifying the Stack

Use the provided verification script to confirm all AWS resources were created correctly:

```bash
chmod +x aws/verify-localstack.sh
./aws/verify-localstack.sh
```

Expected output:
```
=== LocalStack resource check ===

── SNS Topics ─────────────────────────────
arn:aws:sns:us-east-1:000000000000:application-events

── SQS Queues ─────────────────────────────
http://localhost:4566/000000000000/salesforce-integration-queue
http://localhost:4566/000000000000/salesforce-integration-dlq

── Lambda Functions ───────────────────────
(empty until you run the deploy script)

── DLQ depth ──────────────────────────────
ApproximateNumberOfMessages: 0
```

### Manually inspect the SQS queue

```bash
# Receive up to 1 message from the queue (peek)
aws sqs receive-message \
  --endpoint-url http://localhost:4566 \
  --region us-east-1 \
  --queue-url http://localhost:4566/000000000000/salesforce-integration-queue \
  --profile localstack
```

### Query outbox events directly in PostgreSQL

```bash
docker compose exec postgres psql -U postgres -d appdb -c \
  "SELECT id, event_type, published, published_at, sns_message_id FROM outbox_events ORDER BY created_at DESC LIMIT 10;"
```

---

## 9. Deploying the Lambda Locally

The Lambda is **not** started automatically by `docker compose up`. Deploy it manually after the stack is running:

```bash
chmod +x scripts/deploy-lambda-local.sh
./scripts/deploy-lambda-local.sh
```

The script will:
1. Run `npm ci --only=production` inside `lambda/`.
2. Zip `src/`, `node_modules/`, and `package.json` into `/tmp/lambda-deploy.zip`.
3. Create (or update) the `salesforce-integration-consumer` Lambda in LocalStack.
4. Create the SQS event-source mapping (batch size: 5, `ReportBatchItemFailures` enabled).

After deployment, run the verify script again to confirm the Lambda appears:
```bash
./aws/verify-localstack.sh
```

> **Note:** The Lambda in LocalStack will attempt to call the real Salesforce API. For local end-to-end testing without Salesforce credentials, you can mock or stub the Lambda handler.

---

## 10. API Reference

### `POST /applications`

Create a new application. Atomically writes to `applications` and `outbox_events`.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `applicantName` | string | Yes | Full name of the applicant |
| `applicantEmail` | string | Yes | Email address |
| `data` | object | No | Arbitrary JSON metadata (defaults to `{}`) |

**Responses**

| Status | Body | Meaning |
|--------|------|---------|
| `201 Created` | Application object | Successful submission |
| `400 Bad Request` | `{ "error": "..." }` | Missing or invalid `applicantName` / `applicantEmail` |
| `500 Internal Server Error` | `{ "error": "Failed to submit application" }` | Transaction failed |

**Example**
```bash
curl -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"John Doe","applicantEmail":"john@example.com"}'
```

---

### `GET /applications/:id`

Retrieve an application by its UUID.

**Path Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `id` | UUID | Application UUID |

**Responses**

| Status | Body | Meaning |
|--------|------|---------|
| `200 OK` | Application object | Found |
| `400 Bad Request` | `{ "error": "Invalid id format" }` | Malformed UUID |
| `404 Not Found` | `{ "error": "Not found" }` | No record with that ID |
| `500 Internal Server Error` | `{ "error": "Internal server error" }` | DB query failed |

**Example**
```bash
curl http://localhost:3000/applications/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### `GET /health`

Liveness check. Returns `200 OK` if the process is running.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

---

## 11. Configuration Reference

### API Service (`api/`)

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL hostname |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `appdb` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `PORT` | `3000` | HTTP server port |

### Worker Service (`worker/`)

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL hostname |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `appdb` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `SNS_ENDPOINT` | *(unset)* | Override SNS endpoint — set to `http://localstack:4566` locally; **unset in production** to use real AWS |
| `SNS_TOPIC_ARN` | *(required)* | Full ARN of the SNS topic |
| `AWS_REGION` | `us-east-1` | AWS region |
| `AWS_ACCESS_KEY_ID` | `test` | AWS credentials (real key in production) |
| `AWS_SECRET_ACCESS_KEY` | `test` | AWS credentials (real secret in production) |
| `POLL_INTERVAL_MS` | `5000` | Milliseconds between polling cycles |
| `BATCH_SIZE` | `10` | Max outbox events per cycle |

### Lambda Function (`lambda/`)

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `SALESFORCE_INSTANCE_URL` | Yes | e.g. `https://myorg.my.salesforce.com` |
| `SALESFORCE_CLIENT_ID` | Yes | Connected App consumer key |
| `SALESFORCE_CLIENT_SECRET` | Yes | Connected App consumer secret |
| `SALESFORCE_TOKEN_URL` | No | Defaults to `https://login.salesforce.com/services/oauth2/token` (use sandbox URL for non-prod) |

---

## 12. Production Deployment Guide

### Infrastructure Checklist

- [ ] **PostgreSQL** — managed service (RDS, Cloud SQL, etc.) with SSL enabled and connection pooling (PgBouncer or RDS Proxy)
- [ ] **API** — containerised (ECS, Kubernetes, Cloud Run) with horizontal scaling; CPU/memory limits set
- [ ] **Worker** — containerised; run **at least 2 replicas** — `FOR UPDATE SKIP LOCKED` ensures safe concurrency
- [ ] **SNS Topic** — create real topic; note the ARN
- [ ] **SQS Queue** — create with redrive policy pointing to a DLQ; set `VisibilityTimeout` ≥ Lambda timeout
- [ ] **Lambda** — deployed via CI/CD (SAM, Serverless Framework, Terraform, CDK); configure SQS event source mapping
- [ ] **Secrets** — store all credentials in AWS Secrets Manager or Parameter Store; **never commit secrets**
- [ ] **Monitoring** — CloudWatch alarms on DLQ depth, Lambda error rate, worker lag

### Removing the LocalStack Endpoint

In production, remove `SNS_ENDPOINT` from the worker environment. The AWS SDK defaults to the real AWS endpoints.

**docker-compose.yml change (production override):**
```yaml
worker:
  environment:
    SNS_ENDPOINT: ""          # unset — use real AWS
    AWS_ACCESS_KEY_ID: ""     # inject from secrets manager
    AWS_SECRET_ACCESS_KEY: "" # inject from secrets manager
```

### Scaling the Worker

The worker uses `FOR UPDATE SKIP LOCKED`, so it is safe to run multiple replicas:

```yaml
worker:
  deploy:
    replicas: 3
```

Each replica will pick up different batches from the outbox without overlap.

### Worker Lag Monitoring

Add a CloudWatch (or Datadog/Grafana) metric for outbox lag:

```sql
SELECT COUNT(*) AS unpublished_count,
       EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) AS lag_seconds
FROM outbox_events
WHERE published = FALSE;
```

Alert if `unpublished_count > 100` or `lag_seconds > 60`.

### Salesforce Connected App Setup

1. In Salesforce Setup → App Manager → New Connected App.
2. Enable OAuth, add scope: `api`.
3. Enable **client credentials flow** (OAuth 2.0 client credentials).
4. Note the **Consumer Key** (`SALESFORCE_CLIENT_ID`) and **Consumer Secret** (`SALESFORCE_CLIENT_SECRET`).
5. Add the custom field `External_ID__c` (type: Text, External ID: ✓) to the **Case** object.

### Security Hardening

- Use IAM roles (not static credentials) for production — attach an IAM role to ECS tasks / Lambda.
- Restrict the SNS topic policy to only allow publish from the worker's IAM role.
- Restrict the SQS queue policy to only allow `ReceiveMessage`/`DeleteMessage` from Lambda's execution role.
- Enable SQS server-side encryption (SSE) with KMS.
- Rotate Salesforce credentials via Secrets Manager rotation.
- Set `DB_PASSWORD` from a secret, never as a plain environment variable in production.

---

## 13. Reliability & Safety Guarantees

| Concern | Mechanism |
|---------|-----------|
| **Dual-write atomicity** | Single PostgreSQL transaction covers both `applications` and `outbox_events`; either both rows commit or neither does |
| **At-least-once delivery** | Worker retries unpublished rows on the next poll cycle if SNS publish fails |
| **Concurrency safety** | `FOR UPDATE SKIP LOCKED` prevents multiple worker replicas from processing the same event |
| **Idempotent consumer** | Lambda uses `PATCH` upsert with `External_ID__c` — duplicate events update the same Salesforce record |
| **Partial batch failures** | Lambda returns `batchItemFailures` — only failing messages are retried, not the entire SQS batch |
| **Dead-letter queue** | Poison-pill messages that fail 3 times are isolated in a DLQ for manual inspection |
| **Fast poll queries** | Partial index `idx_outbox_unpublished` covers only unpublished rows |
| **Token caching** | Lambda caches the Salesforce OAuth token for 115 minutes, avoiding unnecessary token refreshes |

---

## 14. Troubleshooting

### `docker compose up` hangs at migration

The `migrate` service waits for PostgreSQL to pass its healthcheck. If it hangs more than 60 s:
```bash
docker compose logs postgres
```
Look for `database system is ready to accept connections`. If absent, increase `retries` in the healthcheck.

### Worker logs `[worker] Publish cycle error: ...`

1. Confirm LocalStack is healthy: `curl http://localhost:4566/_localstack/health`
2. Confirm SNS topic exists: `./aws/verify-localstack.sh`
3. Check `SNS_TOPIC_ARN` matches exactly what LocalStack created.

### Lambda not triggering after deployment

```bash
# Check event-source mapping state
awslocal lambda list-event-source-mappings \
  --function-name salesforce-integration-consumer \
  --region us-east-1
```
The `State` field should be `Enabled`. If it shows `Creating`, wait a few seconds and retry.

### `403 Forbidden` from Salesforce

- Confirm the Connected App has the **client_credentials** flow enabled.
- Confirm the `SALESFORCE_INSTANCE_URL` does not have a trailing slash.
- For sandbox orgs, set `SALESFORCE_TOKEN_URL=https://test.salesforce.com/services/oauth2/token`.

### Outbox events stuck as unpublished

```sql
-- Check for events older than 1 minute still unpublished
SELECT id, event_type, created_at
FROM outbox_events
WHERE published = FALSE
  AND created_at < NOW() - INTERVAL '1 minute';
```
If rows appear here, the worker is not running or cannot reach SNS.

### DLQ is growing

```bash
# Check DLQ depth
aws sqs get-queue-attributes \
  --endpoint-url http://localhost:4566 \
  --region us-east-1 \
  --queue-url http://localhost:4566/000000000000/salesforce-integration-dlq \
  --attribute-names ApproximateNumberOfMessages \
  --profile localstack
```
Inspect DLQ messages to understand the root cause, fix the Lambda, then redrive messages back to the main queue.

---

## 15. Project Structure

```
outbox-pattern/
├── docker-compose.yml              # Full local stack definition
│
├── api/                            # Applicant API service
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js                # Express app entry point
│       ├── db.js                   # PostgreSQL connection pool
│       └── routes/
│           └── applications.js     # POST /applications, GET /applications/:id
│
├── worker/                         # Outbox publisher worker
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js                # Poll loop entry point
│       ├── db.js                   # PostgreSQL connection pool
│       └── outboxPublisher.js      # Core publish logic (FOR UPDATE SKIP LOCKED)
│
├── lambda/                         # Salesforce integration consumer
│   ├── package.json
│   └── src/
│       └── handler.js              # SQS-triggered Lambda; upserts Salesforce Cases
│
├── migrations/
│   └── 001_init.sql                # Creates applications + outbox_events tables + index
│
├── localstack/
│   └── init-aws.sh                 # Creates SNS topic, SQS queues, subscription on LocalStack ready
│
├── scripts/
│   └── deploy-lambda-local.sh      # Packages and deploys Lambda to LocalStack
│
└── aws/
    ├── config                      # AWS CLI profile for LocalStack
    ├── credentials                 # LocalStack dummy credentials
    └── verify-localstack.sh        # Sanity-check script for SNS/SQS/Lambda resources
```

---

## License

MIT
