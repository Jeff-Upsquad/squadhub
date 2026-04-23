import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';

// Cloudflare R2 uses the S3-compatible API
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

// File size limits in bytes
export const FILE_SIZE_LIMITS: Record<string, number> = {
  image: 20 * 1024 * 1024,    // 20 MB
  audio: 50 * 1024 * 1024,    // 50 MB
  video: 500 * 1024 * 1024,   // 500 MB
  file: 100 * 1024 * 1024,    // 100 MB
};

// Generate a pre-signed URL for direct browser upload to R2
export async function generatePresignedUploadUrl(
  workspaceId: string,
  channelOrDmId: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; objectKey: string; publicUrl: string }> {
  const timestamp = Date.now();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `${workspaceId}/${channelOrDmId}/${timestamp}_${safeFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 }); // 1 hour
  const publicUrl = `${config.r2PublicUrl}/${objectKey}`;

  return { uploadUrl, objectKey, publicUrl };
}

// Generate a pre-signed URL for LMS content-block media uploads.
// Path: lms/<item_id>/<lesson_id>/<timestamp>_<filename>
export async function generateLmsUploadUrl(
  itemId: string,
  lessonId: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; objectKey: string; publicUrl: string }> {
  const timestamp = Date.now();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `lms/${itemId}/${lessonId}/${timestamp}_${safeFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  const publicUrl = `${config.r2PublicUrl}/${objectKey}`;

  return { uploadUrl, objectKey, publicUrl };
}

// Generate a pre-signed URL for Squad Chat media uploads.
// Path: chat/<conversation_type>/<conversation_id>/<timestamp>_<filename>
export async function generateChatUploadUrl(
  conversationType: 'group' | 'dm',
  conversationId: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; objectKey: string; publicUrl: string }> {
  const timestamp = Date.now();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `chat/${conversationType}/${conversationId}/${timestamp}_${safeFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  const publicUrl = `${config.r2PublicUrl}/${objectKey}`;

  return { uploadUrl, objectKey, publicUrl };
}

// Generate a pre-signed URL for cash book receipt/check photo uploads
export async function generateCashBookUploadUrl(
  clientId: string,
  entryType: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; objectKey: string; publicUrl: string }> {
  const timestamp = Date.now();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `cashbook/${clientId}/${entryType}/${timestamp}_${safeFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  const publicUrl = `${config.r2PublicUrl}/${objectKey}`;

  return { uploadUrl, objectKey, publicUrl };
}

// Generate a short-lived signed GET URL for any R2 object. Used for serving
// cash book receipts to clients without exposing the bucket publicly.
// When `filename` is provided, the signed URL includes a response
// Content-Disposition header so the browser downloads the file under that
// name instead of rendering it inline.
export async function generateR2DownloadUrl(
  objectKey: string,
  expiresInSeconds = 3600,
  filename?: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.r2BucketName,
    Key: objectKey,
    ...(filename
      ? { ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"` }
      : {}),
  });
  return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}
