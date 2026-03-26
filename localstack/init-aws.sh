#!/bin/bash
# LocalStack initialisation script.
# Runs inside the LocalStack container when it reaches "ready" state.
# Creates: DLQ → SQS Queue (with redrive) → SNS Topic → SNS→SQS subscription
set -euo pipefail

REGION=us-east-1

echo "=== LocalStack init: creating SNS + SQS resources ==="

# ── 1. Dead Letter Queue ─────────────────────────────────────
echo "[1/5] Creating Dead Letter Queue..."
DLQ_URL=$(awslocal sqs create-queue \
  --queue-name salesforce-integration-dlq \
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
  --queue-name salesforce-integration-queue \
  --region "$REGION" \
  --query 'QueueUrl' --output text)

# Set VisibilityTimeout and RedrivePolicy separately to avoid CLI quoting issues
REDRIVE_JSON="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"3\"}"
awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --region "$REGION" \
  --attributes VisibilityTimeout=30

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
  --name application-events \
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
