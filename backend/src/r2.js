import { DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { DEFAULT_ASSET_TYPE, getSupportedExtension } from "./asset-types.js";

export function isR2Configured() {
  return Boolean(
    config.r2.accountId
    && config.r2.accessKeyId
    && config.r2.secretAccessKey
    && config.r2.bucket
  );
}

export function getR2Client() {
  if (!isR2Configured()) {
    throw new Error("Cloudflare R2 is not configured. Add CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey
    }
  });
}

export function getExtension(filename = "", assetType = DEFAULT_ASSET_TYPE) {
  return getSupportedExtension(filename, assetType);
}

export function sanitizeFilename(filename = "") {
  return filename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

export function buildModelKey({ userId, filename, stage = "original", projectId = null, assetType = DEFAULT_ASSET_TYPE }) {
  const safeFilename = sanitizeFilename(filename);
  const extension = getExtension(safeFilename, assetType);
  if (!extension) throw new Error("Unsupported file type for the selected data category.");

  const prefix = userId ? `users/${userId}` : "demo";
  const projectPart = projectId ? `/projects/${projectId}/${assetType}` : "";
  return `${prefix}${projectPart}/${stage}/${Date.now()}-${nanoid(10)}-${safeFilename}`;
}

export async function createPresignedUpload({ key, contentType = "application/octet-stream" }) {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    ContentType: contentType
  });

  return getSignedUrl(client, command, {
    expiresIn: Math.min(config.r2.signedUrlExpiresSeconds, 3600)
  });
}

export async function createPresignedDownload({ key, expiresIn = config.r2.signedUrlExpiresSeconds } = {}) {
  if (config.r2.publicBaseUrl) return `${config.r2.publicBaseUrl}/${key}`;

  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: config.r2.bucket,
    Key: key
  });

  return getSignedUrl(client, command, {
    expiresIn
  });
}

export async function getObjectInfo(key) {
  const client = getR2Client();
  const result = await client.send(new HeadObjectCommand({
    Bucket: config.r2.bucket,
    Key: key
  }));

  return {
    key,
    size: result.ContentLength,
    contentType: result.ContentType,
    updatedAt: result.LastModified?.toISOString()
  };
}

export async function getObjectStream(key) {
  const client = getR2Client();
  const result = await client.send(new GetObjectCommand({
    Bucket: config.r2.bucket,
    Key: key
  }));

  return {
    body: result.Body,
    contentType: result.ContentType || "application/octet-stream",
    contentLength: result.ContentLength,
    updatedAt: result.LastModified?.toISOString()
  };
}

export async function deleteObject(key) {
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({
    Bucket: config.r2.bucket,
    Key: key
  }));
}

export async function listBucketSample() {
  const client = getR2Client();
  const result = await client.send(new ListObjectsV2Command({
    Bucket: config.r2.bucket,
    MaxKeys: 10
  }));

  return {
    bucket: config.r2.bucket,
    keyCount: result.KeyCount || 0,
    objects: (result.Contents || []).map((item) => ({
      key: item.Key,
      size: item.Size,
      updatedAt: item.LastModified?.toISOString()
    }))
  };
}
