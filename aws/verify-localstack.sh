#!/bin/bash
# aws/verify-localstack.sh
# Quick sanity-check: lists all SNS/SQS/Lambda resources created by LocalStack init.
# Usage: ./aws/verify-localstack.sh
#
# No AWS CLI required — uses awslocal inside the LocalStack container via
# docker compose exec, with a curl fallback for the health check.
set -euo pipefail

ENDPOINT=http://localhost:4566
REGION=us-east-1

echo "=== LocalStack resource check ==="

echo ""
echo "── LocalStack Health ──────────────────────"
curl -s "$ENDPOINT/_localstack/health" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for svc in ['sns','sqs','lambda']:
    print(f'  {svc:10s}: {d[\"services\"].get(svc, \"n/a\")}')
"

echo ""
echo "── SNS Topics ─────────────────────────────"
docker compose exec localstack \
  awslocal sns list-topics --region "$REGION" \
  --query 'Topics[].TopicArn' --output table

echo ""
echo "── SQS Queues ─────────────────────────────"
docker compose exec localstack \
  awslocal sqs list-queues --region "$REGION" --output table

echo ""
echo "── Lambda Functions ───────────────────────"
docker compose exec localstack \
  awslocal lambda list-functions --region "$REGION" \
  --query 'Functions[].FunctionName' --output table

echo ""
echo "── DLQ depth ──────────────────────────────"
docker compose exec localstack \
  awslocal sqs get-queue-attributes \
  --region "$REGION" \
  --queue-url "http://sqs.$REGION.localhost.localstack.cloud:4566/000000000000/salesforce-integration-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes' --output table
