# Testing Guide — Transactional Outbox Pattern

This guide walks through every layer of the system with concrete commands you can copy-paste to verify the application is working correctly end-to-end.

---

## Table of Contents

1. [Test Environment Setup](#1-test-environment-setup)
2. [Layer 1 — Infrastructure Health Checks](#2-layer-1--infrastructure-health-checks)
3. [Layer 2 — Database Verification](#3-layer-2--database-verification)
4. [Layer 3 — API Tests](#4-layer-3--api-tests)
5. [Layer 4 — Outbox Worker Tests](#5-layer-4--outbox-worker-tests)
6. [Layer 5 — SNS Production-Level Tests](#6-layer-5--sns-production-level-tests)
7. [Layer 6 — SQS Production-Level Tests](#7-layer-6--sqs-production-level-tests)
8. [Layer 7 — DLQ (Dead-Letter Queue) Production-Level Tests](#8-layer-7--dlq-dead-letter-queue-production-level-tests)
9. [Layer 8 — Lambda Deployment & Trigger Test](#9-layer-8--lambda-deployment--trigger-test)
10. [Layer 9 — End-to-End Happy Path](#10-layer-9--end-to-end-happy-path)
11. [Negative / Edge Case Tests](#11-negative--edge-case-tests)
12. [Expected Log Output Reference](#12-expected-log-output-reference)
13. [Quick Test Checklist](#13-quick-test-checklist)

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

## 6. Layer 5 — SNS Production-Level Tests

These tests validate the SNS topic configuration, message structure, delivery attributes, and failure behaviour to the level expected in a production system.

---

### Test 6.1 — Confirm SNS topic exists and ARN is correct

```bash
docker compose exec localstack awslocal sns list-topics \
  --region us-east-1 \
  --query 'Topics[].TopicArn' \
  --output table
```

**Expected:**

```
arn:aws:sns:us-east-1:000000000000:application-events
```

---

### Test 6.2 — Inspect full topic attributes

```bash
docker compose exec localstack awslocal sns get-topic-attributes \
  --region us-east-1 \
  --topic-arn "arn:aws:sns:us-east-1:000000000000:application-events"
```

**Expected fields to verify:**

| Attribute | Expected Value |
|-----------|----------------|
| `TopicArn` | `arn:aws:sns:us-east-1:000000000000:application-events` |
| `SubscriptionsConfirmed` | `"1"` (the SQS subscription) |
| `SubscriptionsPending` | `"0"` |
| `SubscriptionsDeleted` | `"0"` |

---

### Test 6.3 — Confirm SQS subscription details

```bash
docker compose exec localstack awslocal sns list-subscriptions-by-topic \
  --region us-east-1 \
  --topic-arn "arn:aws:sns:us-east-1:000000000000:application-events" \
  --query 'Subscriptions[].{Protocol:Protocol,Endpoint:Endpoint,SubscriptionArn:SubscriptionArn}' \
  --output table
```

**Expected:**

| Protocol | Endpoint | SubscriptionArn |
|----------|----------|-----------------|
| `sqs` | `arn:aws:sqs:us-east-1:000000000000:salesforce-integration-queue` | `arn:aws:sns:us-east-1:000000000000:application-events:<uuid>` |

> In production this confirms the subscription is not in `PendingConfirmation` state and the delivery endpoint is the correct queue ARN (not the DLQ).

---

### Test 6.4 — Confirm subscription delivery policy (raw message delivery off)

```bash
docker compose exec localstack awslocal sns get-subscription-attributes \
  --region us-east-1 \
  --subscription-arn "$(docker compose exec localstack awslocal sns list-subscriptions-by-topic \
      --region us-east-1 \
      --topic-arn 'arn:aws:sns:us-east-1:000000000000:application-events' \
      --query 'Subscriptions[0].SubscriptionArn' \
      --output text)"
```

**Expected:** `RawMessageDelivery` is `"false"` — SNS wraps messages in the standard notification envelope (`Type`, `MessageId`, `TopicArn`, `Message`, `Timestamp`). This envelope is what the Lambda parses from the SQS `body`.

---

### Test 6.5 — Publish a test message directly to SNS (bypass the worker)

Use this to verify SNS → SQS delivery in isolation, without needing the full API + worker stack:

```bash
docker compose exec localstack awslocal sns publish \
  --region us-east-1 \
  --topic-arn "arn:aws:sns:us-east-1:000000000000:application-events" \
  --message '{"applicationId":"00000000-0000-0000-0000-000000000099","applicantName":"SNS Direct","applicantEmail":"direct@example.com","status":"submitted","data":{}}' \
  --message-attributes '{"eventType":{"DataType":"String","StringValue":"ApplicationSubmitted"}}'
```

**Expected:**

```json
{
  "MessageId": "<uuid>"
}
```

Then verify the message arrived in the SQS queue:

```bash
docker compose exec localstack awslocal sqs receive-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --max-number-of-messages 1 \
  --attribute-names All \
  --message-attribute-names All
```

**Verify in the response:**
- `Body` contains `"Type":"Notification"` and `"TopicArn":"arn:aws:sns:..."`
- `Body.Message` contains the JSON payload you published
- `Attributes.ApproximateReceiveCount` is `"1"`

---

### Test 6.6 — SNS publish with missing topic ARN (error handling)

```bash
docker compose exec localstack awslocal sns publish \
  --region us-east-1 \
  --topic-arn "arn:aws:sns:us-east-1:000000000000:nonexistent-topic" \
  --message '{"test":true}'
```

**Expected:** error `NotFoundException` — confirms the worker's SNS client would surface this as a publish failure and leave the outbox row with `published = FALSE` for retry.

---

### Test 6.7 — Verify no orphaned subscriptions exist

```bash
docker compose exec localstack awslocal sns list-subscriptions \
  --region us-east-1 \
  --query 'Subscriptions[].{Protocol:Protocol,TopicArn:TopicArn,SubscriptionArn:SubscriptionArn}' \
  --output table
```

**Expected:** exactly one subscription. In a production environment multiple orphaned subscriptions can cause duplicate message delivery — this check catches misconfiguration from repeated deployments.

---

## 7. Layer 6 — SQS Production-Level Tests

These tests validate queue configuration, message visibility, redrive policy linkage, and throughput behaviour.

---

### Test 7.1 — Confirm both queues exist

```bash
docker compose exec localstack awslocal sqs list-queues \
  --region us-east-1 \
  --query 'QueueUrls[]' \
  --output table
```

**Expected:**

```
http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue
http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq
```

---

### Test 7.2 — Inspect full main queue attributes

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --attribute-names All
```

**Expected attribute values to verify:**

| Attribute | Expected Value | Why it matters |
|-----------|----------------|----------------|
| `VisibilityTimeout` | `"30"` (seconds) | Messages stay invisible for 30s during processing; prevents duplicate delivery |
| `MessageRetentionPeriod` | `"345600"` (4 days) | Messages not consumed within 4 days are dropped |
| `MaximumMessageSize` | `"262144"` (256 KB) | Maximum SNS notification envelope size |
| `ReceiveMessageWaitTimeSeconds` | any | `"0"` = short poll; `"20"` = long poll (lower cost in production) |
| `RedrivePolicy` | contains `"salesforce-integration-dlq"` and `"maxReceiveCount"` | Confirms DLQ routing is configured |
| `ApproximateNumberOfMessages` | `"0"` on an idle system | Messages are drained by Lambda |

---

### Test 7.3 — Inspect DLQ attributes

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --attribute-names All
```

**Expected:**

| Attribute | Expected Value |
|-----------|----------------|
| `MessageRetentionPeriod` | `"1209600"` (14 days) — DLQ retains messages longer for investigation |
| `ApproximateNumberOfMessages` | `"0"` — healthy system has no failed messages |

> **Production Note:** The DLQ retention period should always be longer than the source queue retention period. This guarantees you can inspect failed messages before they expire.

---

### Test 7.4 — Confirm the SQS resource policy (only SNS can send)

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --attribute-names Policy \
  --query 'Attributes.Policy'
```

**Expected:** a JSON policy string containing:

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "sns.amazonaws.com" },
  "Action": "sqs:SendMessage",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:sns:us-east-1:000000000000:application-events"
    }
  }
}
```

> **Why this matters (production):** Without this policy, any AWS principal could inject arbitrary messages into the queue. The `aws:SourceArn` condition locks delivery to only the specific SNS topic — this is a required security control.

---

### Test 7.5 — Confirm message arrives in the queue after worker publish

Submit an application and wait for the worker, then peek at the queue before Lambda consumes it:

```bash
# Submit
export APP_ID=$(curl -s -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"applicantName":"SQS Test","applicantEmail":"sqs@example.com"}' | jq -r '.id')

# Wait for worker
sleep 7

# Peek (does not delete the message — peek only)
docker compose exec localstack awslocal sqs receive-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --max-number-of-messages 1 \
  --visibility-timeout 0 \
  --attribute-names All | jq '{MessageId: .Messages[0].MessageId, ApproximateReceiveCount: .Messages[0].Attributes.ApproximateReceiveCount, SentTimestamp: .Messages[0].Attributes.SentTimestamp}'
```

> `--visibility-timeout 0` returns the message to the queue immediately after receipt, so this is a non-destructive peek.

**Expected:**
- `MessageId` — non-null UUID
- `ApproximateReceiveCount` — `"1"` (first delivery attempt)
- `SentTimestamp` — epoch milliseconds matching the time of publish

---

### Test 7.6 — Message count metrics (queue depth monitoring)

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed
```

**Expected on a healthy idle system:**

| Attribute | Expected | Meaning |
|-----------|----------|---------|
| `ApproximateNumberOfMessages` | `"0"` | Visible messages ready for consumers |
| `ApproximateNumberOfMessagesNotVisible` | `"0"` | In-flight (being processed) — should drain to 0 quickly |
| `ApproximateNumberOfMessagesDelayed` | `"0"` | Delayed due to delivery delay — should always be 0 here |

> **Production alert threshold:** raise a `CloudWatch` alarm when `ApproximateNumberOfMessages` exceeds your SLA batch size and remains elevated for more than 2 poll cycles.

---

### Test 7.7 — Send and receive a raw message directly (queue isolation test)

This test exercises the queue in complete isolation from SNS and the worker:

```bash
# Send
docker compose exec localstack awslocal sqs send-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --message-body '{"test":"isolation-check","ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
  --message-attributes '{"source":{"DataType":"String","StringValue":"manual-test"}}'
```

**Expected:**

```json
{
  "MD5OfMessageBody": "...",
  "MessageId": "<uuid>"
}
```

Then receive it back:

```bash
docker compose exec localstack awslocal sqs receive-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --max-number-of-messages 1 \
  --message-attribute-names All | jq
```

Delete the test message with the receipt handle to keep the queue clean:

```bash
export RECEIPT=$(docker compose exec localstack awslocal sqs receive-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --max-number-of-messages 1 | jq -r '.Messages[0].ReceiptHandle')

docker compose exec localstack awslocal sqs delete-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --receipt-handle "$RECEIPT"
```

**Expected:** HTTP `200` with empty body — message deleted successfully.

---

## 8. Layer 7 — DLQ (Dead-Letter Queue) Production-Level Tests

The DLQ is the safety net for messages the Lambda cannot process. These tests validate its configuration, redrive linkage, message routing behaviour, and operational runbook procedures.

---

### Test 8.1 — Confirm DLQ is empty on a healthy system

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --query 'Attributes'
```

**Expected:**

```json
{
  "ApproximateNumberOfMessages": "0",
  "ApproximateNumberOfMessagesNotVisible": "0"
}
```

> A non-zero DLQ depth in production means at least one message has exhausted all retry attempts and requires manual investigation.

---

### Test 8.2 — Confirm redrive policy links main queue to DLQ

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --attribute-names RedrivePolicy \
  --query 'Attributes.RedrivePolicy'
```

**Expected:** a JSON string (may be escaped) containing:

```json
{
  "deadLetterTargetArn": "arn:aws:sqs:us-east-1:000000000000:salesforce-integration-dlq",
  "maxReceiveCount": 3
}
```

> **Production Note:** `maxReceiveCount: 3` means a message is moved to the DLQ after 3 failed delivery attempts. Choose this value based on your Lambda's expected transient failure rate — too low causes premature DLQ routing, too high delays alerting on genuine bugs.

---

### Test 8.3 — Simulate message routing to DLQ (controlled failure test)

This test manually forces a message over the receive count threshold to verify DLQ routing works:

```bash
# Step 1: Send a deliberately malformed message
docker compose exec localstack awslocal sqs send-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --message-body '{"malformed":true,"missing_required_fields":true}'

# Step 2: Receive it 3 times without deleting (simulates Lambda failures)
for i in 1 2 3; do
  echo "--- Receive attempt $i ---"
  docker compose exec localstack awslocal sqs receive-message \
    --region us-east-1 \
    --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
    --max-number-of-messages 1 \
    --visibility-timeout 1 | jq '.Messages[0].Attributes.ApproximateReceiveCount'
  sleep 3
done

# Step 3: After maxReceiveCount is exhausted, confirm DLQ received the message
sleep 5
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages'
```

**Expected after step 3:** `"1"` — the malformed message has been routed to the DLQ.

> **Note:** LocalStack may handle redrive differently from AWS in some versions. In production AWS, exceed the `maxReceiveCount` by receiving without deleting and SQS moves the message automatically.

---

### Test 8.4 — Inspect a DLQ message without consuming it

When a message appears in the DLQ in production, you must read it to diagnose the failure without accidentally deleting it:

```bash
docker compose exec localstack awslocal sqs receive-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --max-number-of-messages 1 \
  --visibility-timeout 0 \
  --attribute-names All | jq '{
    MessageId: .Messages[0].MessageId,
    Body: (.Messages[0].Body | fromjson),
    ApproximateReceiveCount: .Messages[0].Attributes.ApproximateReceiveCount,
    SentTimestamp: .Messages[0].Attributes.SentTimestamp,
    DeadLetterQueueSourceArn: .Messages[0].Attributes.DeadLetterQueueSourceArn
  }'
```

**Expected fields:**

| Field | Value |
|-------|-------|
| `Body` | The original malformed JSON payload |
| `ApproximateReceiveCount` | `"1"` (first read from DLQ) |
| `DeadLetterQueueSourceArn` | `arn:aws:sqs:us-east-1:000000000000:salesforce-integration-queue` |

> `--visibility-timeout 0` is critical for non-destructive inspection — it returns the message to the DLQ immediately.

---

### Test 8.5 — Redrive (replay) a DLQ message back to the main queue

After fixing the root cause, replay the DLQ message:

```bash
# Step 1: Read the message from DLQ
export DLQ_RECEIPT=$(docker compose exec localstack awslocal sqs receive-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --max-number-of-messages 1 | jq -r '.Messages[0].ReceiptHandle')

export DLQ_BODY=$(docker compose exec localstack awslocal sqs receive-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --max-number-of-messages 1 \
  --visibility-timeout 0 | jq -r '.Messages[0].Body')

# Step 2: Re-inject the message into the main queue
docker compose exec localstack awslocal sqs send-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-queue" \
  --message-body "$DLQ_BODY"

# Step 3: Delete the original from the DLQ
docker compose exec localstack awslocal sqs delete-message \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --receipt-handle "$DLQ_RECEIPT"

# Step 4: Confirm DLQ is empty again
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages'
```

**Expected after step 4:** `"0"` — DLQ is clear; the replayed message will be processed by the Lambda on the next poll cycle.

> **Production Runbook:** Always fix the underlying bug before replaying. Replaying into a broken Lambda re-routes the message back to the DLQ within minutes and wastes retry budget.

---

### Test 8.6 — Purge the DLQ (emergency drain — destructive)

```bash
# WARNING: This permanently deletes all messages in the DLQ
# Only use this after you have recorded/archived all DLQ messages

docker compose exec localstack awslocal sqs purge-queue \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq"
```

**Expected:** HTTP `200` with empty body.

Confirm it is empty:

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages'
```

**Expected:** `"0"`

> **Production Note:** AWS enforces a 60-second cool-down between `purge-queue` calls on the same queue. Plan accordingly in operational runbooks.

---

### Test 8.7 — DLQ alarm threshold (monitoring validation)

In production this translates to a CloudWatch alarm. Simulate the condition locally:

```bash
# Send 3 test messages directly to the DLQ (simulating 3 failed events)
for i in 1 2 3; do
  docker compose exec localstack awslocal sqs send-message \
    --region us-east-1 \
    --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
    --message-body "{\"failedMessageIndex\":$i,\"reason\":\"simulated-failure\"}"
done

# Check depth
docker compose exec localstack awslocal sqs get-queue-attributes \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages'
```

**Expected:** `"3"` — if this were production, your alerting pipeline (CloudWatch → SNS → PagerDuty/Slack) would fire.

**Production Alarm Definition (IaC reference):**

```json
{
  "AlarmName": "salesforce-integration-dlq-not-empty",
  "MetricName": "ApproximateNumberOfMessagesVisible",
  "Namespace": "AWS/SQS",
  "Dimensions": [{ "Name": "QueueName", "Value": "salesforce-integration-dlq" }],
  "Statistic": "Maximum",
  "Period": 60,
  "EvaluationPeriods": 1,
  "Threshold": 1,
  "ComparisonOperator": "GreaterThanOrEqualToThreshold",
  "TreatMissingData": "notBreaching"
}
```

Purge the test messages after:

```bash
docker compose exec localstack awslocal sqs purge-queue \
  --region us-east-1 \
  --queue-url "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq"
```

---

## 9. Layer 8 — Lambda Deployment & Trigger Test

### Test 9.1 — Deploy the Lambda to LocalStack

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

### Test 9.2 — Confirm Lambda was registered

```bash
docker compose exec localstack awslocal lambda list-functions \
  --region us-east-1 \
  --query 'Functions[].FunctionName' \
  --output table
```

**Expected:**

```
salesforce-integration-consumer
```

---

### Test 9.3 — Confirm SQS event-source mapping is enabled

```bash
docker compose exec localstack awslocal lambda list-event-source-mappings \
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

### Test 9.4 — Manually invoke the Lambda with a test event

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
docker compose exec localstack awslocal lambda invoke \
  --function-name salesforce-integration-consumer \
  --region us-east-1 \
  --payload file:///tmp/test-event.json \
  --log-type Tail \
  /tmp/lambda-response.json && docker compose exec localstack cat /tmp/lambda-response.json
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

## 10. Layer 9 — End-to-End Happy Path

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

## 11. Negative / Edge Case Tests

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

## 12. Expected Log Output Reference

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

## 13. Quick Test Checklist

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

SNS (Production)
[ ] SNS topic arn:aws:sns:us-east-1:000000000000:application-events exists
[ ] Topic SubscriptionsConfirmed = 1, SubscriptionsPending = 0
[ ] Subscription Protocol = sqs pointing to salesforce-integration-queue ARN
[ ] RawMessageDelivery = false (SNS envelope wrapping active)
[ ] Direct SNS publish delivers message to SQS queue
[ ] Publish to nonexistent topic returns NotFoundException
[ ] No orphaned subscriptions (exactly one subscription exists)

SQS (Production)
[ ] salesforce-integration-queue exists
[ ] salesforce-integration-dlq exists
[ ] Main queue VisibilityTimeout = 30 seconds
[ ] RedrivePolicy links to DLQ with maxReceiveCount = 3
[ ] SQS resource policy restricts SendMessage to SNS topic ARN only
[ ] Message arrives in queue after worker publish (SNS → SQS delivery verified)
[ ] ApproximateNumberOfMessages = 0 on idle system
[ ] ApproximateNumberOfMessagesNotVisible = 0 on idle system
[ ] Raw send/receive/delete cycle on main queue succeeds

DLQ (Production)
[ ] DLQ ApproximateNumberOfMessages = 0 on healthy system
[ ] DLQ MessageRetentionPeriod >= source queue retention (14 days vs 4 days)
[ ] Redrive policy confirmed: deadLetterTargetArn + maxReceiveCount = 3
[ ] Simulated failure routes message to DLQ after maxReceiveCount exhausted
[ ] DLQ message inspectable non-destructively (--visibility-timeout 0)
[ ] DLQ message replayed to main queue successfully
[ ] Purge DLQ works and returns queue to depth 0
[ ] DLQ alarm threshold simulation sends 3 messages and depth = 3

Lambda
[ ] deploy-lambda-local.sh completes without errors
[ ] Lambda salesforce-integration-consumer appears in list-functions
[ ] SQS event-source mapping State = Enabled, BatchSize = 5
[ ] Manual invoke returns batchItemFailures for bad credentials (expected)

Security
[ ] SQL injection in POST body stored as literal text (tables still exist)
[ ] SQL injection in GET path returns 400 (UUID guard fires)
[ ] Worker restart does not lose unpublished events
[ ] SQS resource policy rejects SendMessage from non-SNS principals
```