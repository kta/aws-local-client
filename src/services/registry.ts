import type { ServiceDefinition } from "./types";
import { dynamodbService } from "../features/dynamodb/service";
import { sqsService } from "../features/sqs/service";
import snsIcon from "../assets/aws/icon-sns.svg";
import s3Icon from "../assets/aws/icon-s3.svg";
import ec2Icon from "../assets/aws/icon-ec2.svg";
import eksIcon from "../assets/aws/icon-eks.svg";

// Placeholder entries for services that are not yet implemented. They render as
// grayed-out "coming soon" cards on Home and expose no nav/routes. Replacing one
// with a real ServiceDefinition (e.g. sqsService) is the only edit needed here.
const comingSoon = (id: string, name: string, icon: string): ServiceDefinition => ({
  id,
  name,
  description: "coming soon",
  icon,
  basePath: `/${id}`,
  enabled: false,
  home: "",
  nav: [],
  routes: [],
});

export const SERVICES: ServiceDefinition[] = [
  dynamodbService,
  sqsService,
  comingSoon("sns", "SNS", snsIcon),
  comingSoon("s3", "S3", s3Icon),
  comingSoon("ec2", "EC2", ec2Icon),
  comingSoon("eks", "EKS", eksIcon),
];

export const serviceForPath = (pathname: string): ServiceDefinition | undefined =>
  SERVICES.find((s) => s.enabled && pathname.startsWith(s.basePath));
