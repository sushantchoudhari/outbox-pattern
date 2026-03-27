#!/bin/bash
# scripts/deploy-lambda-local.sh
#
# Packages the Lambda function, deploys it to LocalStack, and wires the
# SQS queue as its event-source.
#
# All configurable values are read from environment variables.
# Copy .env.example → .env in the project root and edit as needed.
#
# Prerequisites:
#   - LocalStack is running  (docker compose up localstack)
#   - awslocal CLI installed (pip install awscli-local)
#   - zip / node / npm available
#
# Usage:
#   chmod +x scripts/deploy-lambda-local.sh
#   ./scripts/deploy-lambda-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Load .env from project root if present ───────────────────
# This lets you override any value without editing this script.
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
  echo "Loaded config from .env"
fi

# ── Config (from env, with safe defaults) ────────────────────
REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-salesforce-integration-consumer}"
QUEUE_NAME="${SQS_QUEUE_NAME:-salesforce-integration-queue}"
DLQ_NAME="${SQS_DLQ_NAME:-salesforce-integration-dlq}"
LAMBDA_TIMEOUT_VAL="${LAMBDA_TIMEOUT:-30}"
LAMBDA_BATCH_SIZE_VAL="${LAMBDA_BATCH_SIZE:-5}"
SF_INSTANCE_URL="${SALESFORCE_INSTANCE_URL:-https://your-instance.my.salesforce.com}"
SF_CLIENT_ID="${SALESFORCE_CLIENT_ID:-your-client-id}"
SF_CLIENT_SECRET="${SALESFORCE_CLIENT_SECRET:-your-client-secret}"
SF_TOKEN_URL="${SALESFORCE_TOKEN_URL:-https://login.salesforce.com/services/oauth2/token}"
ROLE_ARN=arn:aws:iam::000000000000:role/lambda-role     # LocalStack accepts any ARN
ZIP_PATH=/tmp/lambda-deploy.zip
LAMBDA_DIR="$SCRIPT_DIR/../lambda"

echo "=== Deploy Lambda to LocalStack ==="
echo "    Region      : $REGION"
echo "    Function    : $FUNCTION_NAME"
echo "    Queue       : $QUEUE_NAME"
echo "    DLQ         : $DLQ_NAME"
echo "    Timeout     : ${LAMBDA_TIMEOUT_VAL}s"
echo "    Batch size  : $LAMBDA_BATCH_SIZE_VAL"

# ── 1. Install dependencies & package ────────────────────────
echo "[1/4] Packaging Lambda…"
cd "$LAMBDA_DIR"
npm ci --only=production --silent
rm -f "$ZIP_PATH"
zip -r "$ZIP_PATH" src/ node_modules/ package.json > /dev/null
echo "    Created $ZIP_PATH ($(du -sh "$ZIP_PATH" | cut -f1))"

# ── 2. Create (or update) the Lambda function ─────────────────
echo "[2/4] Deploying to LocalStack…"
if awslocal lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" > /dev/null 2>&1; then
  echo "    Updating existing function…"
  awslocal lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_PATH" \
    --region "$REGION" > /dev/null
else
  echo "    Creating new function…"
  awslocal lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs20.x \
    --handler src/handler.handler \
    --zip-file "fileb://$ZIP_PATH" \
    --role "$ROLE_ARN" \
    --region "$REGION" \
    --timeout "$LAMBDA_TIMEOUT_VAL" \
    --environment "Variables={ \
      SALESFORCE_INSTANCE_URL=${SF_INSTANCE_URL}, \
      SALESFORCE_CLIENT_ID=${SF_CLIENT_ID}, \
      SALESFORCE_CLIENT_SECRET=${SF_CLIENT_SECRET}, \
      SALESFORCE_TOKEN_URL=${SF_TOKEN_URL} \
    }" > /dev/null
fi

# ── 3. Wire SQS as event source ───────────────────────────────
echo "[3/4] Configuring SQS event-source mapping…"

QUEUE_URL=$(awslocal sqs get-queue-url \
  --queue-name "$QUEUE_NAME" --region "$REGION" \
  --query 'QueueUrl' --output text)

QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" --attribute-names QueueArn \
  --region "$REGION" --query 'Attributes.QueueArn' --output text)

DLQ_URL=$(awslocal sqs get-queue-url \
  --queue-name "$DLQ_NAME" --region "$REGION" \
  --query 'QueueUrl' --output text)

# Only create the mapping if it doesn't already exist
EXISTING=$(awslocal lambda list-event-source-mappings \
  --function-name "$FUNCTION_NAME" \
  --event-source-arn "$QUEUE_ARN" \
  --region "$REGION" \
  --query 'EventSourceMappings[0].UUID' --output text 2>/dev/null || echo "None")

if [[ "$EXISTING" == "None" || -z "$EXISTING" ]]; then
  awslocal lambda create-event-source-mapping \
    --function-name "$FUNCTION_NAME" \
    --event-source-arn "$QUEUE_ARN" \
    --batch-size "$LAMBDA_BATCH_SIZE_VAL" \
    --function-response-types ReportBatchItemFailures \
    --region "$REGION" > /dev/null
  echo "    Event source mapping created"
else
  echo "    Event source mapping already exists (UUID=$EXISTING)"
fi

# ── 4. Summary ────────────────────────────────────────────────
echo "[4/4] Done!"
echo ""
echo "==========================================="
echo "  Lambda : $FUNCTION_NAME"
echo "  Source : $QUEUE_ARN"
echo "  DLQ    : $DLQ_URL"
echo "==========================================="
echo ""
echo "Quick smoke-test (simulates SNS→SQS delivery):"
echo ""
echo "  awslocal sqs send-message \\"
echo "    --queue-url $QUEUE_URL \\"
echo "    --message-body '{\"Type\":\"Notification\",\"Message\":\"{\\\"applicationId\\\":\\\"test-123\\\",\\\"applicantName\\\":\\\"Jane Doe\\\",\\\"applicantEmail\\\":\\\"jane@example.com\\\",\\\"data\\\":{}}\" }'"

