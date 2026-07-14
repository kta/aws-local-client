import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface BucketSummary {
  name: string;
  createdAt: string | null;
}

export interface ObjectSummary {
  key: string;
  size: number;
  lastModified: string | null;
}

export interface ObjectPage {
  prefixes: string[];
  objects: ObjectSummary[];
  nextToken: string | null;
}

export interface ObjectDetail {
  key: string;
  size: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  metadata: Record<string, string>;
}

export const s3 = {
  listBuckets: (profile: ConnectionProfile) => invoke<BucketSummary[]>("s3_list_buckets", { profile }),
  createBucket: (profile: ConnectionProfile, name: string) =>
    invoke<void>("s3_create_bucket", { profile, name }),
  deleteBucket: (profile: ConnectionProfile, name: string) =>
    invoke<void>("s3_delete_bucket", { profile, name }),
  listObjects: (profile: ConnectionProfile, bucket: string, prefix: string, nextToken?: string) =>
    invoke<ObjectPage>("s3_list_objects", { profile, bucket, prefix, nextToken }),
  headObject: (profile: ConnectionProfile, bucket: string, key: string) =>
    invoke<ObjectDetail>("s3_head_object", { profile, bucket, key }),
  putObject: (
    profile: ConnectionProfile,
    bucket: string,
    key: string,
    bodyBase64: string,
    contentType?: string,
  ) => invoke<void>("s3_put_object", { profile, bucket, key, bodyBase64, contentType }),
  downloadObject: (profile: ConnectionProfile, bucket: string, key: string, destPath: string) =>
    invoke<void>("s3_download_object", { profile, bucket, key, destPath }),
  deleteObject: (profile: ConnectionProfile, bucket: string, key: string) =>
    invoke<void>("s3_delete_object", { profile, bucket, key }),
};
