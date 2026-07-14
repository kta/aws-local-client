// Official AWS Architecture Icons (Service icons, 64px) sourced from the
// `aws-svg-icons` npm package (ISC-licensed packaging of the icons published at
// https://aws.amazon.com/architecture/icons/). Vite resolves each `.svg` import
// to a URL string, assigned to `ServiceDefinition.icon` in registry.ts.
//
// The 2021 icon set predates a handful of newer services (Bedrock, MemoryDB,
// Billing, Cloud Control API, Resource Groups); those intentionally have no
// entry in SERVICE_ICONS and fall back to the abbreviation tile rendered by
// Home.tsx.
//
// A few ids reuse a parent service's icon where AWS ships no dedicated glyph and
// the console is a sub-feature: EventBridge Scheduler/Pipes -> EventBridge,
// CloudWatch Logs -> CloudWatch, S3 Vectors -> S3, OpenSearch -> Elasticsearch
// (its predecessor service).

import dynamodb from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-DynamoDB_64.svg";
import sqs from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-Simple-Queue-Service_64.svg";
import sns from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-Simple-Notification-Service_64.svg";
import s3 from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg";
import rds from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-RDS_64.svg";
import lambda from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_AWS-Lambda_64.svg";
import ec2 from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_Amazon-EC2_64.svg";
import ecs from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Containers/64/Arch_Amazon-Elastic-Container-Service_64.svg";
import ecr from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Containers/64/Arch_Amazon-Elastic-Container-Registry_64.svg";
import eks from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Containers/64/Arch_Amazon-EKS-Cloud_64.svg";
import stepFunctions from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_AWS-Step-Functions_64.svg";
import eventbridge from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-EventBridge_64.svg";
import kinesis from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_Amazon-Kinesis_64.svg";
import firehose from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_Amazon-Kinesis-Firehose_64.svg";
import cloudwatch from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Management-Governance/64/Arch_Amazon-CloudWatch_64.svg";
import secretsManager from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Security-Identity-Compliance/64/Arch_AWS-Secrets-Manager_64.svg";
import ssm from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Management-Governance/64/Arch_AWS-Systems-Manager_64.svg";
import kms from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Security-Identity-Compliance/64/Arch_AWS-Key-Management-Service_64.svg";
import iam from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Security-Identity-Compliance/64/Arch_AWS-Identity-and-Access-Management_64.svg";
import cognito from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Security-Identity-Compliance/64/Arch_Amazon-Cognito_64.svg";
import cloudformation from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Management-Governance/64/Arch_AWS-CloudFormation_64.svg";
import apiGateway from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-API-Gateway_64.svg";
import appsync from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_AWS-AppSync_64.svg";
import ses from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Business-Applications/64/Arch_Amazon-Simple-Email-Service_64.svg";
import route53 from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Networking-Content-Delivery/64/Arch_Amazon-Route-53_64.svg";
import cloudfront from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Networking-Content-Delivery/64/Arch_Amazon-CloudFront_64.svg";
import elb from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Networking-Content-Delivery/64/Arch_Elastic-Load-Balancing_64.svg";
import autoScaling from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Management-Governance/64/Arch_AWS-Auto-Scaling_64.svg";
import elasticBeanstalk from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_AWS-Elastic-Beanstalk_64.svg";
import lightsail from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_Amazon-Lightsail_64.svg";
import athena from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_Amazon-Athena_64.svg";
import glue from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_AWS-Glue_64.svg";
import opensearch from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_Amazon-Elasticsearch-Service_64.svg";
import emr from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_Amazon-EMR_64.svg";
import msk from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_Amazon-Managed-Streaming-for-Apache-Kafka_64.svg";
import mq from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-MQ_64.svg";
import elasticache from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-ElastiCache_64.svg";
import neptune from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-Neptune_64.svg";
import documentdb from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-DocumentDB_64.svg";
import backup from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Storage/64/Arch_AWS-Backup_64.svg";
import transfer from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Migration-Transfer/64/Arch_AWS-Transfer-Family_64.svg";
import acm from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Security-Identity-Compliance/64/Arch_AWS-Certificate-Manager_64.svg";
import waf from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Security-Identity-Compliance/64/Arch_AWS-WAF_64.svg";
import cloudtrail from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Management-Governance/64/Arch_AWS-CloudTrail_64.svg";
import config from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Management-Governance/64/Arch_AWS-Config_64.svg";
import cloudMap from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Networking-Content-Delivery/64/Arch_AWS-Cloud-Map_64.svg";
import appconfig from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Management-Governance/64/Arch_AWS-AppConfig_64.svg";
import codebuild from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Developer-Tools/64/Arch_AWS-CodeBuild_64.svg";
import codedeploy from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Developer-Tools/64/Arch_AWS-CodeDeploy_64.svg";
import codepipeline from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Developer-Tools/64/Arch_AWS-CodePipeline_64.svg";
import batch from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_AWS-Batch_64.svg";
import iot from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Internet-of-Things/64/Arch_AWS-IoT-Core_64.svg";
import textract from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Machine-Learning/64/Arch_Amazon-Textract_64.svg";
import transcribe from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Machine-Learning/64/Arch_Amazon-Transcribe_64.svg";
import costExplorer from "aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_AWS-Cost-Management/64/Arch_AWS-Cost-Explorer_64.svg";

// Service id -> official AWS icon URL. Ids without an entry render an
// abbreviation tile (see Home.tsx). Keep keys aligned with registry.ts ids.
export const SERVICE_ICONS: Record<string, string> = {
  dynamodb,
  sqs,
  sns,
  s3,
  rds,
  lambda,
  ec2,
  ecs,
  ecr,
  eks,
  "step-functions": stepFunctions,
  eventbridge,
  scheduler: eventbridge,
  pipes: eventbridge,
  kinesis,
  firehose,
  cloudwatch,
  "cloudwatch-logs": cloudwatch,
  "secrets-manager": secretsManager,
  ssm,
  kms,
  iam,
  cognito,
  cloudformation,
  "api-gateway": apiGateway,
  appsync,
  ses,
  route53,
  cloudfront,
  elb,
  "auto-scaling": autoScaling,
  "elastic-beanstalk": elasticBeanstalk,
  lightsail,
  athena,
  glue,
  opensearch,
  emr,
  msk,
  mq,
  elasticache,
  neptune,
  documentdb,
  "s3-vectors": s3,
  backup,
  transfer,
  acm,
  waf,
  cloudtrail,
  config,
  "cloud-map": cloudMap,
  appconfig,
  codebuild,
  codedeploy,
  codepipeline,
  batch,
  iot,
  textract,
  transcribe,
  "cost-explorer": costExplorer,
};
