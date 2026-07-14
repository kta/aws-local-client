import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface QueueSummary {
  queueUrl: string;
  name: string;
  fifo: boolean;
  approximateMessages: number;
  approximateNotVisible: number;
}

export interface QueueDetail extends QueueSummary {
  arn: string;
  visibilityTimeout: number;
  retentionPeriod: number;
  delaySeconds: number;
  maxMessageSize: number;
  redrivePolicy: string | null;
  createdAt: string | null;
}

export interface CreateQueueRequest {
  name: string;
  fifo: boolean;
  visibilityTimeout?: number;
  retentionPeriod?: number;
  delaySeconds?: number;
  redrivePolicy?: string;
}

export interface QueueAttributesUpdate {
  visibilityTimeout: number;
  retentionPeriod: number;
  delaySeconds: number;
  redrivePolicy?: string;
}

export interface SendMessageRequest {
  body: string;
  delaySeconds?: number;
  attributes?: Record<string, { dataType: string; stringValue: string }>;
  groupId?: string;
  dedupId?: string;
}

export interface QueueTag {
  key: string;
  value: string;
}

export interface DlqSourceInfo {
  redrivePolicy: string | null;
  sources: string[];
  supported: boolean;
}

export interface SqsMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, unknown>;
  sentAt: string | null;
}

export const sqs = {
  listQueues: (profile: ConnectionProfile) => invoke<QueueSummary[]>("sqs_list_queues", { profile }),
  getQueue: (profile: ConnectionProfile, queueUrl: string) =>
    invoke<QueueDetail>("sqs_get_queue", { profile, queueUrl }),
  createQueue: (profile: ConnectionProfile, req: CreateQueueRequest) =>
    invoke<void>("sqs_create_queue", { profile, req }),
  deleteQueue: (profile: ConnectionProfile, queueUrl: string) =>
    invoke<void>("sqs_delete_queue", { profile, queueUrl }),
  setQueueAttributes: (profile: ConnectionProfile, queueUrl: string, req: QueueAttributesUpdate) =>
    invoke<void>("sqs_set_queue_attributes", { profile, queueUrl, req }),
  sendMessage: (profile: ConnectionProfile, queueUrl: string, req: SendMessageRequest) =>
    invoke<void>("sqs_send_message", { profile, queueUrl, req }),
  receiveMessages: (profile: ConnectionProfile, queueUrl: string) =>
    invoke<SqsMessage[]>("sqs_receive_messages", { profile, queueUrl }),
  deleteMessage: (profile: ConnectionProfile, queueUrl: string, receiptHandle: string) =>
    invoke<void>("sqs_delete_message", { profile, queueUrl, receiptHandle }),
  purgeQueue: (profile: ConnectionProfile, queueUrl: string) =>
    invoke<void>("sqs_purge_queue", { profile, queueUrl }),
  listQueueTags: (profile: ConnectionProfile, queueUrl: string) =>
    invoke<QueueTag[]>("sqs_list_queue_tags", { profile, queueUrl }),
  tagQueue: (profile: ConnectionProfile, queueUrl: string, key: string, value: string) =>
    invoke<void>("sqs_tag_queue", { profile, queueUrl, key, value }),
  untagQueue: (profile: ConnectionProfile, queueUrl: string, key: string) =>
    invoke<void>("sqs_untag_queue", { profile, queueUrl, key }),
  listDlqSources: (profile: ConnectionProfile, queueUrl: string) =>
    invoke<DlqSourceInfo>("sqs_list_dlq_sources", { profile, queueUrl }),
};
