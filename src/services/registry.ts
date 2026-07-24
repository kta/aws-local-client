import type { ServiceDefinition } from "./types";
import { dynamodbService } from "../features/dynamodb/service";
import { sqsService } from "../features/sqs/service";
import { snsService } from "../features/sns/service";
import { s3Service } from "../features/s3/service";
import { rdsService } from "../features/rds/service";
import { opensearchService } from "../features/opensearch/service";
import { SERVICE_ICONS } from "./icons";

// Placeholder entries for services that are not yet implemented. They render as
// grayed-out "coming soon" cards on Home and expose no nav/routes. Replacing one
// with a real ServiceDefinition (e.g. sqsService) is the only edit needed here.
// Icons are filled in from SERVICE_ICONS below; ids with no icon there render an
// abbreviation tile on Home.
const comingSoon = (id: string, name: string): ServiceDefinition => ({
  id,
  name,
  description: "coming soon",
  basePath: `/${id}`,
  enabled: false,
  home: "",
  nav: [],
  routes: [],
});

// Every service floci (community, 2026-07-14 実機調査) exposes a control-plane
// API for, minus the five implemented above. Sub-APIs are folded into their
// console-level service (IoT Data -> IoT Core, SES v1/v2 -> SES, ...).
const FLOCI_COMING_SOON: [string, string][] = [
  ["lambda", "Lambda"],
  ["ec2", "EC2"],
  ["ecs", "ECS"],
  ["ecr", "ECR"],
  ["eks", "EKS"],
  ["step-functions", "Step Functions"],
  ["eventbridge", "EventBridge"],
  ["scheduler", "EventBridge Scheduler"],
  ["pipes", "EventBridge Pipes"],
  ["kinesis", "Kinesis"],
  ["firehose", "Data Firehose"],
  ["cloudwatch", "CloudWatch"],
  ["secrets-manager", "Secrets Manager"],
  ["ssm", "Systems Manager"],
  ["kms", "KMS"],
  ["iam", "IAM"],
  ["cognito", "Cognito"],
  ["cloudformation", "CloudFormation"],
  ["api-gateway", "API Gateway"],
  ["appsync", "AppSync"],
  ["ses", "SES"],
  ["route53", "Route 53"],
  ["cloudfront", "CloudFront"],
  ["elb", "Elastic Load Balancing"],
  ["auto-scaling", "Auto Scaling"],
  ["elastic-beanstalk", "Elastic Beanstalk"],
  ["lightsail", "Lightsail"],
  ["athena", "Athena"],
  ["glue", "Glue"],
  ["emr", "EMR"],
  ["msk", "MSK"],
  ["mq", "Amazon MQ"],
  ["elasticache", "ElastiCache"],
  ["memorydb", "MemoryDB"],
  ["neptune", "Neptune"],
  ["documentdb", "DocumentDB"],
  ["s3-vectors", "S3 Vectors"],
  ["backup", "Backup"],
  ["transfer", "Transfer Family"],
  ["acm", "ACM"],
  ["waf", "WAF"],
  ["cloudtrail", "CloudTrail"],
  ["config", "Config"],
  ["cloud-control", "Cloud Control"],
  ["cloud-map", "Cloud Map"],
  ["appconfig", "AppConfig"],
  ["resource-groups", "Resource Groups"],
  ["codebuild", "CodeBuild"],
  ["codedeploy", "CodeDeploy"],
  ["codepipeline", "CodePipeline"],
  ["batch", "Batch"],
  ["iot", "IoT Core"],
  ["bedrock", "Bedrock"],
  ["textract", "Textract"],
  ["transcribe", "Transcribe"],
  ["cost-explorer", "Cost Explorer"],
  ["billing", "Billing and Cost Management"],
];

// Assign the official AWS Architecture Icon (SERVICE_ICONS) to every service by
// id, overriding any bespoke icon carried by an implemented service definition.
// Services with no mapping keep `icon` undefined and render an abbreviation tile.
const withOfficialIcon = (s: ServiceDefinition): ServiceDefinition => ({
  ...s,
  icon: SERVICE_ICONS[s.id] ?? s.icon,
});

export const SERVICES: ServiceDefinition[] = [
  dynamodbService,
  sqsService,
  snsService,
  s3Service,
  rdsService,
  opensearchService,
  ...FLOCI_COMING_SOON.map(([id, name]) => comingSoon(id, name)),
].map(withOfficialIcon);

export const serviceForPath = (pathname: string): ServiceDefinition | undefined =>
  SERVICES.find((s) => s.enabled && pathname.startsWith(s.basePath));
