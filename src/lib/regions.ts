// AWS commercial regions (as of 2026). Used by the header region selector
// (Layout) and the connection editor (ConnectionsPage) so both share one list.
//
// Ordering: the four most frequently used regions come first (usage order), then
// every remaining region in alphabetical order. Keep ap-northeast-1 and
// us-east-1 near the top — they are the app's common defaults.

// Most-used regions, in usage order (kept ahead of the alphabetical tail).
const PRIORITY_REGIONS = ["ap-northeast-1", "us-east-1", "us-west-2", "ap-northeast-3"] as const;

// Remaining commercial regions (alphabetical). Excludes GovCloud/China partitions.
const OTHER_REGIONS = [
  "af-south-1",
  "ap-east-1",
  "ap-east-2",
  "ap-northeast-2",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-7",
  "ca-central-1",
  "ca-west-1",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "mx-central-1",
  "sa-east-1",
  "us-east-2",
  "us-west-1",
] as const;

export const AWS_REGIONS: string[] = [...PRIORITY_REGIONS, ...OTHER_REGIONS];
