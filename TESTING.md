# Testing Guide — Transactional Outbox Pattern

This guide walks through every layer of the system with concrete commands you can copy-paste to verify the application is working correctly end-to-end.

---

## Table of Contents

1. [Test Environment Setup](#1-test-environment-setup)
2. [Layer 1 — Infrastructure Health Checks](#2-layer-1--infrastructure-health-checks)
3. [Layer 2 — Database Verification](#3-layer-2--database-verification)
4. [Layer 3 — API Tests](#4-layer-3--api-tests)
5. [Layer 4 — Outbox Worker Tests](#5-layer-4--outbox-worker-tests)
6. [Layer 5 — SNS / SQS Verification](#6-layer-5--sns--sqs-verification)
7. [Layer 6 — Lambda Deployment & Trigger Test](#7-layer-6--lambda-deployment--trigger-test)
8. [Layer 7 — End-to-End Happy Path](#8-layer-7--end-to-end-happy-path)
9. [Negative / Edge Case Tests](#9-negative--edge-case-tests)
10. [Expected Log Output Reference](#10-expected-log-output-reference)
11. [Quick Test Checklist](#11-quick-test-checklist)

---

## 1. Test Environment Setup

### Start the full stack

```bash
docker compose up --build
```

Wait until you see all three of these lines before running any tests:

```
localstack   | Ready.
api          | [api] Server listening on port 3000
worker       | [worker] Outbox publisher started
```

### Verify all containers are running

```bash
docker compose ps
```

Expected output — all services should be `running` (or `exited 0` for the `migrate` service):

```
NAME                    STATUS
outbox-pattern-postgres-1     running (healthy)
outbox-pattern-localstack-1   running (healthy)
outbox-pattern-migrate-1      exited (0)
outbox-pattern-api-1          running
outbox-pattern-worker-1       running
```

If `migrate` shows a non-zero exit code, the schema was not applied — see the [Troubleshooting](#troubleshooting) section in the README.

---

## 2. Layer 1 — Infrastructure Health Checks

Run these before any application tests to confirm every dependency is reachable.

### 2.1 PostgreSQL

```bash
docker compose exec postgres pg_isready -U postgres -d appdb
```

**Expected:** `localhost:5432 - accepting connections`

### 2.2 LocalStack

```bash
curl -s http://localhost:4566/_localstack/health | jq .services
```

**Expected:** all relevant services show `"running"` or `"available"`:

```json
{
  "sns": "running",
  "sqs": "running",
  "lambda": "running"
}
```

### 2.3 API liveness

```bash
curl -s http://localhost:3000/health
```

**Expected:**

```json
{"status":"ok"}
```

### 2.4 LocalStack AWS resources

```bash
chmod +x aws/verify-localstack.sh
./aws/verify-localstack.sh
```

**Expected — SNS Topics:**
```
arn:aws:sns:us-east-1:000000000000:application-events
```

**Expected — SQS Queues:**
```
http://localhost:4566/000000000000/salesforce-integration-queue
http://localhost:4566/000000000000/salesforce-integration-dlq
```

---

## 3. Layer 2 — Database Verification

### 3.1 Confirm the tables were created by the migration

```bash
docker compose exec postgres psql -U postgres -d appdb -c "\dt"
```

**Expected:**

```
          List of relations
 Schema |     Name      | Type  |  Owner
--------+---------------+-------+----------
 public | applications  | table | postgres
 public | outbox_events | table | postgres
```

### 3.2 Confirm the partial index exists

```bash
docker compose exec postgres psql -U postgres -d appdb -c "\di idx_outbox_unpublished"
```

**Expected:**

```
                     List of relations
 Schema |          Name           | Type  |  Owner  |    Table
--------+-------------------------+-------+---------+--------------
 public | idx_outbox_unpublished  | index | postgres | outbox_events
```

### 3.3 Confirm tables are empty on a fresh start

```bash
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT COUNT(*) FROM applications;" \
  -c "SELECT COUNT(*) FROM outbox_events;"
```

**Expected:** both counts are `0`.

---

## 4. Layer 3 — API Tests

### Test 4.1 — Submit a valid application (happy path)

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{
    "applicantName": "Jane Smith",
    "applicantEmail": "jane@example.com",
    "data": { "position": "Software Engineer", "yearsExperience": 5 }
  }' | jq
```

**Expected:** HTTP `201 Created`

```json
{
  "id": "<uuid>",
  "applicant_name": "Jane Smith",
  "applicant_email": "jane@example.com",
  "status": "submitted",
  "data": { "position": "Software Engineer", "yearsExperience": 5 },
  "created_at": "<timestamp>",
  "updated_at": "<timestamp>"
}
```

Save the returned `id` for downstream tests:

```bash
export APP_ID=$(curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"Test User","applicantEmail":"test@example.com"}' \
  | jq -r '.id')
echo "Application ID: $APP_ID"
```

---

### Test 4.2 — Retrieve an application by ID

```bash
curl -s http://localhost:3000/applications/$APP_ID | jq
```

**Expected:** HTTP `200 OK` — same object returned from the POST.

---

### Test 4.3 — Missing required field (`applicantName`)

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantEmail":"test@example.com"}' | jq
```

**Expected:** HTTP `400 Bad Request`

```json
{
  "error": "applicantName (string) and applicantEmail (string) are required"
}
```

---

### Test 4.4 — Missing required field (`applicantEmail`)

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"John Doe"}' | jq
```

**Expected:** HTTP `400 Bad Request`

```json
{
  "error": "applicantName (string) and applicantEmail (string) are required"
}
```

---

### Test 4.5 — Empty body

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

**Expected:** HTTP `400 Bad Request`

---

### Test 4.6 — GET with a non-existent ID

```bash
curl -s http://localhost:3000/applications/00000000-0000-0000-0000-000000000000 | jq
```

**Expected:** HTTP `404 Not Found`

```json
{ "error": "Not found" }
```

---

### Test 4.7 — GET with an invalid UUID format

```bash
curl -s http://localhost:3000/applications/not-a-uuid | jq
```

**Expected:** HTTP `400 Bad Request`

```json
{ "error": "Invalid id format" }
```

---

### Test 4.8 — Submit with no `data` field (optional field defaults to `{}`)

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"Minimal User","applicantEmail":"min@example.com"}' | jq .data
```

**Expected:** `{}`

---

## 5. Layer 4 — Outbox Worker Tests

After submitting an application (Test 4.1), the worker should pick it up within `POLL_INTERVAL_MS` (5 seconds by default).

### Test 5.1 — Confirm outbox event was written atomically

Run immediately after submitting:

```bash
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT id, aggregate_type, event_type, published, created_at FROM outbox_events ORDER BY created_at DESC LIMIT 5;"
```

**Expected:** one row with `published = f` (false), `event_type = ApplicationSubmitted`.

---

### Test 5.2 — Confirm worker published the event

Wait 6+ seconds, then run:

```bash
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT id, event_type, published, published_at, sns_message_id FROM outbox_events ORDER BY created_at DESC LIMIT 5;"
```

**Expected:** the same row now shows:
- `published = t` (true)
- `published_at` — a timestamp
- `sns_message_id` — a non-null string (the SNS message ID returned by LocalStack)

---

### Test 5.3 — Confirm worker logs

```bash
docker compose logs worker --tail 20
```

**Expected:**

```
[worker] Processing 1 outbox event(s)…
[worker] event=<uuid> type=ApplicationSubmitted → SNS msgId=<msgId>
[worker] Cycle complete — published 1 event(s)
```

---

### Test 5.4 — Confirm no unpublished events remain

```bash
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT COUNT(*) FROM outbox_events WHERE published = FALSE;"
```

**Expected:** `0`

---

### Test 5.5 — Batch processing (submit 5 applications quickly)

```bash
for i in {1..5}; do
  curl -s -X POST http://localhost:3000/applications \
    -H "Content-Type: application/json" \
    -d "{\"applicantName\":\"Batch User $i\",\"applicantEmail\":\"batch$i@example.com\"}" \
    > /dev/null
done
echo "Submitted 5 applications"
```

Wait 6 seconds, then check:

```bash
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT COUNT(*) FROM outbox_events WHERE published = TRUE;" \
  -c "SELECT COUNT(*) FROM outbox_events WHERE published = FALSE;"
```

**Expected:** `published = TRUE` count equals the total submitted; `published = FALSE` count is `0`.

Worker log should show:

```
[worker] Processing 5 outbox event(s)…
[worker] Cycle complete — published 5 event(s)
```

---

## 6. Layer 5 — SNS / SQS Verification

### Test 6.1 — Confirm the SNS message landed in the SQS queue

After submitting an application and waiting 6 seconds for the worker to publish:

```bash
aws sqs receive-message \
  --endpoint-url http://localhost:4566 \
  --region us-east-1 \
  --queue-url http://localhost:4566/000000000000/salesforce-integration-queue \
  --max-number-of-messages 1 \
  --profile localstack | jq
```

**Expected:** a message object containing the SNS envelope. The `Body` field is a JSON string with a `Message` field containing the outbox event payload:

```json
{
  "Messages": [
    {
      "MessageId": "...",
      "Body": "{\"Type\":\"Notification\",\"Message\":\"{\\\"applicationId\\\":\\\"...\\\",\\\"applicantName\\\":\\\"...\\\"}\",...}"
    }
  ]
}
```

> **Note:** If the Lambda is already deployed and consuming messages this queue may be empty (messages are deleted after successful processing). See Layer 6.

---

### Test 6.2 — Confirm SNS topic ARN

```bash
aws sns list-topics \
  --endpoint-url http://localhost:4566 \
  --region us-east-1 \
  --profile localstack \
  --query 'Topics[].TopicArn' \
  --output table
```

**Expected:**

```
arn:aws:sns:us-east-1:000000000000:application-events
```

---

### Test 6.3 — Confirm SQS subscription to SNS

```bash
aws sns list-subscriptions \
  --endpoint-url http://localhost:4566 \
  --region us-east-1 \
  --profile localstack | jq '.Subscriptions[] | {Protocol, Endpoint, SubscriptionArn}'
```

**Expected:** one subscription with `Protocol: "sqs"` pointing to the queue ARN.

---

### Test 6.4 — Confirm DLQ is empty (healthy system)

```bash
aws sqs get-queue-attributes \
  --endpoint-url http://localhost:4566 \
  --region us-east-1 \
  --queue-url http://localhost:4566/000000000000/salesforce-integration-dlq \
  --attribute-names ApproximateNumberOfMessages \
  --profile localstack \
  --query 'Attributes.ApproximateNumberOfMessages'
```

**Expected:** `"0"`

---

## 7. Layer 6 — Lambda Deployment & Trigger Test

### Test 7.1 — Deploy the Lambda to LocalStack

```bash
chmod +x scripts/deploy-lambda-local.sh
./scripts/deploy-lambda-local.sh
```

**Expected final output:**

```
===========================================
  Lambda : salesforce-integration-consumer
  Source : arn:aws:sqs:us-east-1:000000000000:salesforce-integration-queue
===========================================
```

---

### Test 7.2 — Confirm Lambda was registered

```bash
aws lambda list-functions \
  --endpoint-url http://localhost:4566 \
  --region us-east-1 \
  --profile localstack \
  --query 'Functions[].FunctionName' \
  --output table
```

**Expected:**

```
salesforce-integration-consumer
```

---

### Test 7.3 — Confirm SQS event-source mapping is enabled

```bash
awslocal lambda list-event-source-mappings \
  --function-name salesforce-integration-consumer \
  --region us-east-1 \
  --query 'EventSourceMappings[0].{State:State,BatchSize:BatchSize,Source:EventSourceArn}' \
  --output table
```

**Expected:**

```
State   | BatchSize | Source (SQS ARN)
Enabled | 5         | arn:aws:sqs:us-east-1:000000000000:salesforce-integration-queue
```

---

### Test 7.4 — Manually invoke the Lambda with a test event

Save the following to `/tmp/test-event.json`:

```bash
cat > /tmp/test-event.json << 'EOF'
{
  "Records": [
    {
      "messageId": "test-msg-001",
      "body": "{\"Type\":\"Notification\",\"Message\":\"{\\\"applicationId\\\":\\\"00000000-0000-0000-0000-000000000001\\\",\\\"applicantName\\\":\\\"Test User\\\",\\\"applicantEmail\\\":\\\"test@example.com\\\",\\\"status\\\":\\\"submitted\\\",\\\"data\\\":{}}\"}"
    }
  ]
}
EOF
```

Invoke the Lambda:

```bash
awslocal lambda invoke \
  --function-name salesforce-integration-consumer \
  --region us-east-1 \
  --payload file:///tmp/test-event.json \
  --log-type Tail \
  /tmp/lambda-response.json && cat /tmp/lambda-response.json | jq
```

**Expected response** (without real Salesforce credentials):

```json
{
  "batchItemFailures": [
    { "itemIdentifier": "test-msg-001" }
  ]
}
```

The failure is expected because `SALESFORCE_INSTANCE_URL` is a placeholder. The Lambda correctly reports the failure via `batchItemFailures` rather than throwing, which is the correct partial-failure behaviour.

---

## 8. Layer 7 — End-to-End Happy Path

This is the complete test that covers all layers together.

```bash
# Step 1: Confirm stack is up
curl -s http://localhost:3000/health

# Step 2: Submit an application and capture the ID
export APP_ID=$(curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"E2E Test","applicantEmail":"e2e@example.com","data":{"source":"e2e-test"}}' \
  | jq -r '.id')
echo "Created: $APP_ID"

# Step 3: Verify the outbox event was created (unpublished)
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT event_type, published FROM outbox_events WHERE aggregate_id = '$APP_ID';"

# Step 4: Wait for the worker to publish
echo "Waiting 7 seconds for worker poll cycle..."
sleep 7

# Step 5: Verify the outbox event is now published
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT event_type, published, sns_message_id FROM outbox_events WHERE aggregate_id = '$APP_ID';"

# Step 6: Retrieve the application via the API
curl -s http://localhost:3000/applications/$APP_ID | jq '{id, applicant_name, status}'

# Step 7: Confirm no unpublished events remain
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT COUNT(*) AS unpublished FROM outbox_events WHERE published = FALSE;"
```

### Pass Criteria

| Step | Check | Pass Condition |
|------|-------|----------------|
| 1 | Health endpoint | `{"status":"ok"}` |
| 2 | POST /applications | Returns object with UUID, `status: "submitted"` |
| 3 | DB after write | Row exists with `published = f` |
| 4 | Worker poll | Logs show `Processing 1 outbox event(s)` |
| 5 | DB after publish | `published = t`, `sns_message_id` is non-null |
| 6 | GET /applications/:id | Returns same application |
| 7 | Unpublished count | `0` |

---

## 9. Negative / Edge Case Tests

### 9.1 — Wrong Content-Type

```bash
curl -s -X POST http://localhost:3000/applications \
  -d '{"applicantName":"Test","applicantEmail":"t@t.com"}'
```

**Expected:** HTTP `400` — body is not parsed without `Content-Type: application/json`.

---

### 9.2 — Numeric values for string fields

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":123,"applicantEmail":"test@example.com"}' | jq
```

**Expected:** HTTP `400 Bad Request` (type guard rejects non-string `applicantName`).

---

### 9.3 — SQL injection attempt (should be harmless due to parameterised queries)

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"Robert\"); DROP TABLE applications;--","applicantEmail":"x@x.com"}' | jq
```

**Expected:** HTTP `201 Created` — the malicious string is safely stored as literal text. Verify:

```bash
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT applicant_name FROM applications ORDER BY created_at DESC LIMIT 1;"
```

The name should be stored verbatim, and the `applications` table should still exist.

---

### 9.4 — GET with SQL injection in path

```bash
curl -s "http://localhost:3000/applications/'; DROP TABLE applications;--"
```

**Expected:** HTTP `400 Bad Request` — UUID format guard catches this before it reaches the database.

---

### 9.5 — Large payload in `data`

```bash
curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d "{\"applicantName\":\"Big Data\",\"applicantEmail\":\"big@example.com\",\"data\":$(python3 -c 'import json; print(json.dumps({str(i): "x"*100 for i in range(100)}))')}" | jq .id
```

**Expected:** HTTP `201 Created` — JSONB handles arbitrary objects.

---

### 9.6 — Simulate worker restart (events are not lost)

```bash
# 1. Submit an application
export TEST_ID=$(curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"Restart Test","applicantEmail":"r@r.com"}' | jq -r '.id')

# 2. Restart the worker before it can poll
docker compose restart worker

# 3. Wait for the worker to come back up and poll
sleep 10

# 4. Verify the event was published after restart
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT published, sns_message_id FROM outbox_events WHERE aggregate_id = '$TEST_ID';"
```

**Expected:** `published = t` — events survive a worker restart because they remain in the database until explicitly marked published.

---

### 9.7 — Concurrent submissions (race condition safety)

```bash
# Submit 10 applications in parallel
for i in {1..10}; do
  curl -s -X POST http://localhost:3000/applications \
    -H "Content-Type: application/json" \
    -d "{\"applicantName\":\"Concurrent $i\",\"applicantEmail\":\"c$i@example.com\"}" \
    > /dev/null &
done
wait
echo "All 10 submitted"

# Wait for worker
sleep 10

# Verify counts match
docker compose exec postgres psql -U postgres -d appdb \
  -c "SELECT COUNT(*) AS total_apps FROM applications;" \
  -c "SELECT COUNT(*) AS published FROM outbox_events WHERE published = TRUE;" \
  -c "SELECT COUNT(*) AS unpublished FROM outbox_events WHERE published = FALSE;"
```

**Expected:** `total_apps = published` and `unpublished = 0` (assuming no prior data; add to previous counts if the DB is not fresh).

---

## 10. Expected Log Output Reference

### API logs (normal operation)

```bash
docker compose logs api --tail 20
```

```
[api] Server listening on port 3000
```

_(No per-request logs in the current implementation unless an error occurs.)_

### Worker logs (normal operation)

```bash
docker compose logs worker --tail 30
```

```
[worker] Outbox publisher started
[worker] Topic  : arn:aws:sns:us-east-1:000000000000:application-events
[worker] Poll   : every 5000ms
[worker] Batch  : up to 10 rows
[worker] Processing 1 outbox event(s)…
[worker] event=<uuid> type=ApplicationSubmitted → SNS msgId=<id>
[worker] Cycle complete — published 1 event(s)
```

### Worker logs (idle — no events to process)

The worker produces **no output** when there are no unpublished events. This is normal behaviour — silence between cycles means the queue is empty.

### Worker logs (error — SNS unreachable)

```
[worker] Publish cycle error: connect ECONNREFUSED ...
```

The row remains `published = FALSE` and will be retried on the next cycle.

---

## 11. Quick Test Checklist

Copy this checklist to track your testing progress:

```
Infrastructure
[ ] docker compose ps — all services running
[ ] PostgreSQL healthcheck passes
[ ] LocalStack healthcheck passes (SNS + SQS + Lambda = running)
[ ] API /health returns {"status":"ok"}
[ ] verify-localstack.sh shows SNS topic + both SQS queues

Database
[ ] applications table exists
[ ] outbox_events table exists
[ ] idx_outbox_unpublished partial index exists
[ ] Both tables empty on fresh start

API
[ ] POST /applications (valid) → 201 with UUID
[ ] GET /applications/:id → 200 with correct data
[ ] POST (missing applicantName) → 400
[ ] POST (missing applicantEmail) → 400
[ ] POST (empty body) → 400
[ ] GET (non-existent UUID) → 404
[ ] GET (invalid UUID format) → 400
[ ] POST (no data field) → 201 with data: {}

Outbox Worker
[ ] outbox_events row created with published=false after POST
[ ] Row updated to published=true within 10 seconds
[ ] published_at and sns_message_id are non-null after publish
[ ] Worker logs show Processing N outbox event(s)
[ ] 0 unpublished events after worker cycle completes

SNS / SQS
[ ] SNS topic arn:aws:sns:us-east-1:000000000000:application-events exists
[ ] SQS queue salesforce-integration-queue exists
[ ] SQS DLQ salesforce-integration-dlq exists
[ ] DLQ depth is 0

Lambda
[ ] deploy-lambda-local.sh completes without errors
[ ] Lambda salesforce-integration-consumer appears in list-functions
[ ] SQS event-source mapping State = Enabled
[ ] Manual invoke returns batchItemFailures for bad credentials (expected)

Security
[ ] SQL injection in POST body stored as literal text (tables still exist)
[ ] SQL injection in GET path returns 400 (UUID guard fires)
[ ] Worker restart does not lose unpublished events
```