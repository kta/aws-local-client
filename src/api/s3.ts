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

export interface BucketTag {
  key: string;
  value: string;
}

export interface BucketProperties {
  versioning: string | null;
  tags: BucketTag[];
  corsJson: string | null;
  policyJson: string | null;
}

export interface ObjectVersion {
  key: string;
  versionId: string;
  isLatest: boolean;
  deleteMarker: boolean;
  size: number | null;
  lastModified: string | null;
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
  getBucketProperties: (profile: ConnectionProfile, bucket: string) =>
    invoke<BucketProperties>("s3_get_bucket_properties", { profile, bucket }),
  setVersioning: (profile: ConnectionProfile, bucket: string, enabled: boolean) =>
    invoke<void>("s3_set_versioning", { profile, bucket, enabled }),
  putBucketTagging: (profile: ConnectionProfile, bucket: string, tags: BucketTag[]) =>
    invoke<void>("s3_put_bucket_tagging", { profile, bucket, tags }),
  putBucketCors: (profile: ConnectionProfile, bucket: string, corsJson: string) =>
    invoke<void>("s3_put_bucket_cors", { profile, bucket, corsJson }),
  putBucketPolicy: (profile: ConnectionProfile, bucket: string, policyJson: string) =>
    invoke<void>("s3_put_bucket_policy", { profile, bucket, policyJson }),
  listObjectVersions: (profile: ConnectionProfile, bucket: string, prefix: string) =>
    invoke<ObjectVersion[]>("s3_list_object_versions", { profile, bucket, prefix }),
  downloadObjectVersion: (
    profile: ConnectionProfile,
    bucket: string,
    key: string,
    versionId: string,
    destPath: string,
  ) => invoke<void>("s3_download_object_version", { profile, bucket, key, versionId, destPath }),
  copyObject: (profile: ConnectionProfile, bucket: string, sourceKey: string, destKey: string) =>
    invoke<void>("s3_copy_object", { profile, bucket, sourceKey, destKey }),
  createFolder: (profile: ConnectionProfile, bucket: string, prefix: string) =>
    invoke<void>("s3_create_folder", { profile, bucket, prefix }),
  uploadFile: (profile: ConnectionProfile, bucket: string, key: string, srcPath: string) =>
    invoke<void>("s3_upload_file", { profile, bucket, key, srcPath }),
};
