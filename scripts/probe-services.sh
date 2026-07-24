#!/usr/bin/env bash
#
# probe-services.sh — probe an emulator endpoint for AWS service/operation
# support. Used by service implementers to confirm the capability matrix in
# docs/superpowers/specs/2026-07-22-top20-services-design.md §2 before writing
# capability gates (never guess a gate — measure it).
#
# Usage:
#   scripts/probe-services.sh <endpoint> [service-filter]
#   scripts/probe-services.sh http://localhost:4710            # all services
#   scripts/probe-services.sh http://localhost:4710 lambda     # one service
#
# Output: one "OK <label>" / "FAIL <label> :: <first error line>" per probe.
# Note: some emulators (kumo) disambiguate shared action names via the SDK
# User-Agent `api/<service>` token; the AWS CLI does not send it, so a FAIL
# here for kumo-only ambiguity is worth re-checking with the real SDK.

set -uo pipefail

ENDPOINT="${1:?usage: probe-services.sh <endpoint> [service-filter]}"
FILTER="${2:-}"

export AWS_ACCESS_KEY_ID=dummy AWS_SECRET_ACCESS_KEY=dummy
export AWS_DEFAULT_REGION=ap-northeast-1 AWS_PAGER=""

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# Fixtures ---------------------------------------------------------------
cat > "${WORK}/index.py" <<'EOF'
def handler(event, context):
    return {"ok": True, "echo": event}
EOF
(cd "${WORK}" && zip -q fn.zip index.py)
cat > "${WORK}/cfn.json" <<'EOF'
{"Resources":{"ProbeTopic":{"Type":"AWS::SNS::Topic","Properties":{"TopicName":"nlsd-probe-cfn-topic"}}}}
EOF

A=(aws --endpoint-url "${ENDPOINT}")

run() { # run <service> <label> <cmd...>
  local svc="$1" label="$2"; shift 2
  if [ -n "${FILTER}" ] && [ "${svc}" != "${FILTER}" ]; then return 0; fi
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ ${rc} -eq 0 ]; then
    echo "OK   ${label}"
  else
    echo "FAIL ${label} :: $(echo "${out}" | head -2 | tr '\n' ' ' | cut -c1-160)"
  fi
}

echo "=== ${ENDPOINT} ${FILTER:+(filter: ${FILTER})} ==="

# lambda
run lambda lambda.list   "${A[@]}" lambda list-functions
run lambda lambda.create "${A[@]}" lambda create-function --function-name nlsd-probe-fn \
  --runtime python3.12 --role arn:aws:iam::000000000000:role/nlsd-dummy \
  --handler index.handler --zip-file "fileb://${WORK}/fn.zip"
run lambda lambda.invoke "${A[@]}" lambda invoke --function-name nlsd-probe-fn \
  --payload '{"a":1}' --cli-binary-format raw-in-base64-out "${WORK}/out.json"
run lambda lambda.layers "${A[@]}" lambda list-layers
run lambda lambda.publishlayer "${A[@]}" lambda publish-layer-version --layer-name nlsd-probe-layer \
  --zip-file "fileb://${WORK}/fn.zip"
run lambda lambda.delete "${A[@]}" lambda delete-function --function-name nlsd-probe-fn

# apigateway
run apigateway apigw.list   "${A[@]}" apigateway get-rest-apis
run apigateway apigw.create "${A[@]}" apigateway create-rest-api --name nlsd-probe-api
run apigateway apigw.apikeys "${A[@]}" apigateway get-api-keys
run apigateway apigw.createkey "${A[@]}" apigateway create-api-key --name nlsd-probe-key

# cognito
run cognito cognito.list   "${A[@]}" cognito-idp list-user-pools --max-results 10
run cognito cognito.create "${A[@]}" cognito-idp create-user-pool --pool-name nlsd-probe-pool

# eventbridge
run eventbridge events.listbus   "${A[@]}" events list-event-buses
run eventbridge events.createbus "${A[@]}" events create-event-bus --name nlsd-probe-bus
run eventbridge events.putrule   "${A[@]}" events put-rule --name nlsd-probe-rule \
  --schedule-expression "rate(5 minutes)"
run eventbridge events.listrules "${A[@]}" events list-rules
run eventbridge events.putevents "${A[@]}" events put-events \
  --entries '[{"Source":"nlsd.probe","DetailType":"probe","Detail":"{\"a\":1}"}]'

# secretsmanager
run secretsmanager secrets.list   "${A[@]}" secretsmanager list-secrets
run secretsmanager secrets.create "${A[@]}" secretsmanager create-secret \
  --name nlsd-probe-secret --secret-string '{"k":"v"}'
run secretsmanager secrets.getvalue "${A[@]}" secretsmanager get-secret-value --secret-id nlsd-probe-secret
run secretsmanager secrets.putvalue "${A[@]}" secretsmanager put-secret-value \
  --secret-id nlsd-probe-secret --secret-string '{"k":"v2"}'
run secretsmanager secrets.versions "${A[@]}" secretsmanager list-secret-version-ids --secret-id nlsd-probe-secret
run secretsmanager secrets.delete "${A[@]}" secretsmanager delete-secret \
  --secret-id nlsd-probe-secret --force-delete-without-recovery

# elasticache
run elasticache elasticache.describecc "${A[@]}" elasticache describe-cache-clusters
run elasticache elasticache.describerg "${A[@]}" elasticache describe-replication-groups
run elasticache elasticache.creatergrp "${A[@]}" elasticache create-replication-group \
  --replication-group-id nlsd-probe-rg --replication-group-description probe \
  --engine redis --cache-node-type cache.t3.micro --num-cache-clusters 1
run elasticache elasticache.createmem "${A[@]}" elasticache create-cache-cluster \
  --cache-cluster-id nlsd-probe-mc --engine memcached --cache-node-type cache.t3.micro --num-cache-nodes 1

# cloudformation
run cloudformation cfn.list   "${A[@]}" cloudformation list-stacks
run cloudformation cfn.create "${A[@]}" cloudformation create-stack \
  --stack-name nlsd-probe-stack --template-body "file://${WORK}/cfn.json"
run cloudformation cfn.resources bash -c "sleep 3; aws --endpoint-url ${ENDPOINT} cloudformation list-stack-resources --stack-name nlsd-probe-stack"
run cloudformation cfn.gettemplate "${A[@]}" cloudformation get-template --stack-name nlsd-probe-stack
run cloudformation cfn.exports "${A[@]}" cloudformation list-exports

# ecs
run ecs ecs.listclusters  "${A[@]}" ecs list-clusters
run ecs ecs.createcluster "${A[@]}" ecs create-cluster --cluster-name nlsd-probe-ecs
run ecs ecs.registertask  "${A[@]}" ecs register-task-definition --family nlsd-probe-task \
  --container-definitions '[{"name":"c","image":"public.ecr.aws/docker/library/busybox:stable","memory":128,"essential":true,"command":["sleep","60"]}]'
run ecs ecs.runtask "${A[@]}" ecs run-task --cluster nlsd-probe-ecs --task-definition nlsd-probe-task
run ecs ecs.listtasks "${A[@]}" ecs list-tasks --cluster nlsd-probe-ecs
run ecs ecs.createservice "${A[@]}" ecs create-service --cluster nlsd-probe-ecs \
  --service-name nlsd-probe-svc --task-definition nlsd-probe-task --desired-count 0

# ecr
run ecr ecr.list   "${A[@]}" ecr describe-repositories
run ecr ecr.create "${A[@]}" ecr create-repository --repository-name nlsd-probe-repo
run ecr ecr.images "${A[@]}" ecr list-images --repository-name nlsd-probe-repo

# cloudwatch (logs via CLI; metrics/alarms via raw Query protocol because
# modern CLIs speak CBOR that localstack:3 rejects)
run cloudwatch logs.listgroups  "${A[@]}" logs describe-log-groups
run cloudwatch logs.creategroup "${A[@]}" logs create-log-group --log-group-name /nlsd/probe
run cloudwatch logs.putevents bash -c "aws --endpoint-url ${ENDPOINT} logs create-log-stream --log-group-name /nlsd/probe --log-stream-name s1 && aws --endpoint-url ${ENDPOINT} logs put-log-events --log-group-name /nlsd/probe --log-stream-name s1 --log-events timestamp=$(date +%s000),message=hello"
run cloudwatch logs.getevents "${A[@]}" logs get-log-events --log-group-name /nlsd/probe --log-stream-name s1
run cloudwatch logs.filter "${A[@]}" logs filter-log-events --log-group-name /nlsd/probe --filter-pattern hello
cw_query() { # cw_query <Action> [extra form params...]
  local action="$1"; shift
  local data="Action=${action}&Version=2010-08-01"
  local p; for p in "$@"; do data="${data}&${p}"; done
  local body
  body=$(curl -s -X POST "${ENDPOINT}/" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H 'User-Agent: aws-sdk-js/3.0 api/monitoring#3.0' \
    -H 'Authorization: AWS4-HMAC-SHA256 Credential=dummy/20260101/ap-northeast-1/monitoring/aws4_request, SignedHeaders=host, Signature=dummy' \
    -d "${data}")
  if echo "${body}" | grep -qi '<Error\|__type\|not supported\|UnknownService'; then
    echo "${body}" | head -1; return 1
  fi
}
run cloudwatch cw.listmetrics.query cw_query ListMetrics
run cloudwatch cw.putmetric.query cw_query PutMetricData "Namespace=NLSD" \
  "MetricData.member.1.MetricName=probe" "MetricData.member.1.Value=1"
run cloudwatch cw.alarms.query cw_query DescribeAlarms

# step-functions
run step-functions sfn.list   "${A[@]}" stepfunctions list-state-machines
run step-functions sfn.create "${A[@]}" stepfunctions create-state-machine --name nlsd-probe-sm \
  --role-arn arn:aws:iam::000000000000:role/nlsd-dummy \
  --definition '{"StartAt":"P","States":{"P":{"Type":"Pass","End":true}}}'
run step-functions sfn.exec bash -c "arn=\$(aws --endpoint-url ${ENDPOINT} stepfunctions list-state-machines --query 'stateMachines[?name==\`nlsd-probe-sm\`].stateMachineArn' --output text); aws --endpoint-url ${ENDPOINT} stepfunctions start-execution --state-machine-arn \$arn --input '{\"hello\":\"world\"}'"
run step-functions sfn.history bash -c "arn=\$(aws --endpoint-url ${ENDPOINT} stepfunctions list-state-machines --query 'stateMachines[?name==\`nlsd-probe-sm\`].stateMachineArn' --output text); ex=\$(aws --endpoint-url ${ENDPOINT} stepfunctions list-executions --state-machine-arn \$arn --query 'executions[0].executionArn' --output text); aws --endpoint-url ${ENDPOINT} stepfunctions get-execution-history --execution-arn \$ex"

# opensearch
run opensearch opensearch.list   "${A[@]}" opensearch list-domain-names
run opensearch opensearch.create "${A[@]}" opensearch create-domain --domain-name nlsd-probe-os

# athena
run athena athena.workgroups "${A[@]}" athena list-work-groups
run athena athena.query "${A[@]}" athena start-query-execution --query-string "SELECT 1" \
  --result-configuration OutputLocation=s3://nlsd-probe-athena/
run athena athena.namedqueries "${A[@]}" athena list-named-queries

# msk
run msk kafka.list "${A[@]}" kafka list-clusters
run msk kafka.create "${A[@]}" kafka create-cluster --cluster-name nlsd-probe-msk \
  --kafka-version 3.6.0 --number-of-broker-nodes 1 \
  --broker-node-group-info '{"InstanceType":"kafka.t3.small","ClientSubnets":["subnet-1"],"SecurityGroups":[]}'

# ssm
run ssm ssm.describe "${A[@]}" ssm describe-parameters
run ssm ssm.put "${A[@]}" ssm put-parameter --name /nlsd/probe --value hello --type String --overwrite
run ssm ssm.get "${A[@]}" ssm get-parameter --name /nlsd/probe
run ssm ssm.securestring "${A[@]}" ssm put-parameter --name /nlsd/probe-secure --value s3cret --type SecureString --overwrite
run ssm ssm.getdecrypted "${A[@]}" ssm get-parameter --name /nlsd/probe-secure --with-decryption
run ssm ssm.history "${A[@]}" ssm get-parameter-history --name /nlsd/probe

# route53
run route53 route53.list   "${A[@]}" route53 list-hosted-zones
run route53 route53.create "${A[@]}" route53 create-hosted-zone \
  --name nlsd-probe.example.com --caller-reference "nlsd-${RANDOM}"
run route53 route53.records bash -c "zid=\$(aws --endpoint-url ${ENDPOINT} route53 list-hosted-zones --query 'HostedZones[0].Id' --output text); aws --endpoint-url ${ENDPOINT} route53 list-resource-record-sets --hosted-zone-id \$zid"
run route53 route53.healthchecks "${A[@]}" route53 list-health-checks
run route53 route53.createhealthcheck "${A[@]}" route53 create-health-check \
  --caller-reference "nlsd-${RANDOM}" \
  --health-check-config '{"IPAddress":"127.0.0.1","Port":80,"Type":"TCP","RequestInterval":30,"FailureThreshold":3}'
