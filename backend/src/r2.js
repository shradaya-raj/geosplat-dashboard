import { HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { config } from "./config.js";

const supportedExtensions = new Set([".ply", ".splat", ".ksplat", ".spz"]);

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

export function getExtension(filename = "") {
  const lower = filename.split("?")[0].split("#")[0].toLowerCase();
  return [...supportedExtensions].find((extension) => lower.endsWith(extension));
}

export function sanitizeFilename(filename = "") {
  return filename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

export function buildModelKey({ userId, filename, stage = "original" }) {
  const safeFilename = sanitizeFilename(filename);
  const extension = getExtension(safeFilename);
  if (!extension) throw new Error("Unsupported Gaussian model file type.");

  const prefix = userId ? `users/${userId}` : "demo";
  return `${prefix}/${stage}/${Date.now()}-${nanoid(10)}-${safeFilename}`;
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

export async function createPresignedDownload({ key }) {
  if (config.r2.publicBaseUrl) return `${config.r2.publicBaseUrl}/${key}`;

  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: config.r2.bucket,
    Key: key
  });

  return getSignedUrl(client, command, {
    expiresIn: config.r2.signedUrlExpiresSeconds
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
