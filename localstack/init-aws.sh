#!/bin/bash
# LocalStack initialisation script.
# Runs inside the LocalStack container when it reaches "ready" state.
# Creates: DLQ → SQS Queue (with redrive) → SNS Topic → SNS→SQS subscription
#
# All values are read from environment variables injected by docker-compose.
# Defaults match .env.example so the script works even without explicit config.
set -euo pipefail

# ── Config (from env, with safe defaults) ────────────────────
REGION="${AWS_REGION:-us-east-1}"
QUEUE_NAME="${SQS_QUEUE_NAME:-salesforce-integration-queue}"
DLQ_NAME="${SQS_DLQ_NAME:-salesforce-integration-dlq}"
VISIBILITY_TIMEOUT="${SQS_VISIBILITY_TIMEOUT:-30}"
MAX_RECEIVE_COUNT="${SQS_MAX_RECEIVE_COUNT:-3}"
TOPIC_NAME="${SNS_TOPIC_NAME:-application-events}"

echo "=== LocalStack init: creating SNS + SQS resources ==="
echo "    Region            : $REGION"
echo "    SNS topic         : $TOPIC_NAME"
echo "    Queue             : $QUEUE_NAME"
echo "    DLQ               : $DLQ_NAME"
echo "    VisibilityTimeout : ${VISIBILITY_TIMEOUT}s"
echo "    MaxReceiveCount   : $MAX_RECEIVE_COUNT"

# ── 1. Dead Letter Queue ─────────────────────────────────────
echo "[1/5] Creating Dead Letter Queue..."
DLQ_URL=$(awslocal sqs create-queue \
  --queue-name "$DLQ_NAME" \
  --region "$REGION" \
  --query 'QueueUrl' --output text)

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --region "$REGION" \
  --query 'Attributes.QueueArn' --output text)

echo "    DLQ URL : $DLQ_URL"
echo "    DLQ ARN : $DLQ_ARN"

# ── 2. Main SQS Queue with redrive policy ────────────────────
echo "[2/5] Creating main SQS Queue..."
QUEUE_URL=$(awslocal sqs create-queue \
  --queue-name "$QUEUE_NAME" \
  --region "$REGION" \
  --query 'QueueUrl' --output text)

# Set VisibilityTimeout and RedrivePolicy separately to avoid CLI quoting issues
REDRIVE_JSON="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"${MAX_RECEIVE_COUNT}\"}"
awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --region "$REGION" \
  --attributes "VisibilityTimeout=${VISIBILITY_TIMEOUT}"

printf '%s' "$REDRIVE_JSON" > /tmp/redrive.json
awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --region "$REGION" \
  --attributes "$(printf '{"RedrivePolicy":"%s"}' "$(cat /tmp/redrive.json | sed 's/"/\\"/g')")" 2>/dev/null || \
awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --region "$REGION" \
  --attributes "{\"RedrivePolicy\":\"$(cat /tmp/redrive.json | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))')\"}"

QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names QueueArn \
  --region "$REGION" \
  --query 'Attributes.QueueArn' --output text)

echo "    Queue URL : $QUEUE_URL"
echo "    Queue ARN : $QUEUE_ARN"

# ── 3. SNS Topic ─────────────────────────────────────────────
echo "[3/5] Creating SNS Topic..."
SNS_TOPIC_ARN=$(awslocal sns create-topic \
  --name "$TOPIC_NAME" \
  --region "$REGION" \
  --query 'TopicArn' --output text)

echo "    SNS Topic ARN : $SNS_TOPIC_ARN"

# ── 4. Subscribe SQS to SNS ───────────────────────────────────
echo "[4/5] Subscribing SQS queue to SNS topic..."
awslocal sns subscribe \
  --topic-arn "$SNS_TOPIC_ARN" \
  --protocol sqs \
  --notification-endpoint "$QUEUE_ARN" \
  --attributes RawMessageDelivery=false \
  --region "$REGION"

# ── 5. Set SQS resource policy to allow SNS delivery ─────────
echo "[5/5] Setting SQS policy to allow SNS to send messages..."
python3 - <<PYEOF
import subprocess, json
policy = json.dumps({
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "sqs:SendMessage",
    "Resource": "$QUEUE_ARN",
    "Condition": {"ArnEquals": {"aws:SourceArn": "$SNS_TOPIC_ARN"}}
  }]
})
attrs = json.dumps({"Policy": policy})
subprocess.run(
  ["awslocal","sqs","set-queue-attributes","--queue-url","$QUEUE_URL","--region","$REGION","--attributes", attrs],
  check=True
)
PYEOF

echo ""
echo "==========================================="
echo "  LocalStack setup complete!"
echo "  SNS_TOPIC_ARN = $SNS_TOPIC_ARN"
echo "  QUEUE_URL     = $QUEUE_URL"
echo "  DLQ_URL       = $DLQ_URL"
echo "==========================================="
