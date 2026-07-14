import type { ServiceDefinition } from "./types";
import { dynamodbService } from "../features/dynamodb/service";
import { sqsService } from "../features/sqs/service";
import { snsService } from "../features/sns/service";
import { s3Service } from "../features/s3/service";
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
  snsService,
  s3Service,
  comingSoon("ec2", "EC2", ec2Icon),
  comingSoon("eks", "EKS", eksIcon),
];

export const serviceForPath = (pathname: string): ServiceDefinition | undefined =>
  SERVICES.find((s) => s.enabled && pathname.startsWith(s.basePath));
