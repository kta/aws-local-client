import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface TopicSummary {
  topicArn: string;
  name: string;
  fifo: boolean;
}

export interface SnsSubscription {
  subscriptionArn: string;
  protocol: string;
  endpoint: string;
  filterPolicy: string | null;
  rawDelivery: boolean;
}

export interface PublishRequest {
  message: string;
  subject?: string;
  attributes?: Record<string, { dataType: string; stringValue: string }>;
  groupId?: string;
  dedupId?: string;
}

export const sns = {
  listTopics: (profile: ConnectionProfile) => invoke<TopicSummary[]>("sns_list_topics", { profile }),
  createTopic: (profile: ConnectionProfile, name: string, fifo: boolean) =>
    invoke<void>("sns_create_topic", { profile, name, fifo }),
  deleteTopic: (profile: ConnectionProfile, topicArn: string) =>
    invoke<void>("sns_delete_topic", { profile, topicArn }),
  listSubscriptions: (profile: ConnectionProfile, topicArn: string) =>
    invoke<SnsSubscription[]>("sns_list_subscriptions", { profile, topicArn }),
  subscribeSqs: (
    profile: ConnectionProfile,
    topicArn: string,
    queueArn: string,
    filterPolicy: string | null,
    rawDelivery: boolean,
  ) => invoke<void>("sns_subscribe_sqs", { profile, topicArn, queueArn, filterPolicy, rawDelivery }),
  unsubscribe: (profile: ConnectionProfile, subscriptionArn: string) =>
    invoke<void>("sns_unsubscribe", { profile, subscriptionArn }),
  publish: (profile: ConnectionProfile, topicArn: string, req: PublishRequest) =>
    invoke<string>("sns_publish", { profile, topicArn, req }),
};
