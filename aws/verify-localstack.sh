#!/bin/bash
# aws/verify-localstack.sh
# Quick sanity-check: lists all SNS/SQS resources created by LocalStack init.
# Usage: ./aws/verify-localstack.sh
set -euo pipefail

ENDPOINT=http://localhost:4566
REGION=us-east-1

export AWS_PROFILE=localstack
export AWS_CONFIG_FILE="$(cd "$(dirname "$0")" && pwd)/config"
export AWS_SHARED_CREDENTIALS_FILE="$(cd "$(dirname "$0")" && pwd)/credentials"

echo "=== LocalStack resource check ==="

echo ""
echo "── SNS Topics ─────────────────────────────"
aws sns list-topics \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --query 'Topics[].TopicArn' \
  --output table

echo ""
echo "── SQS Queues ─────────────────────────────"
aws sqs list-queues \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --output table

echo ""
echo "── Lambda Functions ───────────────────────"
aws lambda list-functions \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --query 'Functions[].FunctionName' \
  --output table

echo ""
echo "── DLQ depth ──────────────────────────────"
aws sqs get-queue-attributes \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --queue-url http://localhost:4566/000000000000/salesforce-integration-dlq \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes' \
  --output table
