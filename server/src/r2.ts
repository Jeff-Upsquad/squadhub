import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';

// Cloudflare R2 uses the S3-compatible API
//
// `requestChecksumCalculation: 'WHEN_REQUIRED'` reverts the AWS SDK's newer
// (>=3.7xx) default of adding `x-amz-sdk-checksum-algorithm=CRC32` query
// params to every presigned PUT URL. R2's bucket CORS config doesn't allow
// those new query params during the OPTIONS preflight, so browser uploads
// fail with "No Access-Control-Allow-Origin header" without this opt-out.
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
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

// Task attachments share a single 100 MB cap regardless of MIME — videos,
// audio, images, PDFs, docs all flow through the same path.
export const TASK_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

// Path: tasks/<task_id>/<timestamp>_<filename>
export async function generateTaskUploadUrl(
  taskId: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; objectKey: string; publicUrl: string }> {
  const timestamp = Date.now();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `tasks/${taskId}/${timestamp}_${safeFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  const publicUrl = `${config.r2PublicUrl}/${objectKey}`;

  return { uploadUrl, objectKey, publicUrl };
}

// Generate a pre-signed URL for SquadNotes media/file uploads.
// Path: notes/<note_id>/<timestamp>_<filename>
export async function generateNoteUploadUrl(
  noteId: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; objectKey: string; publicUrl: string }> {
  const timestamp = Date.now();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `notes/${noteId}/${timestamp}_${safeFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  const publicUrl = `${config.r2PublicUrl}/${objectKey}`;

  return { uploadUrl, objectKey, publicUrl };
}

// Confirms an object exists in R2 and returns its size. Used post-upload to
// re-validate client-reported file size before inserting a DB row.
export async function headR2Object(objectKey: string): Promise<{ contentLength: number; contentType: string | undefined } | null> {
  try {
    const result = await r2Client.send(
      new HeadObjectCommand({ Bucket: config.r2BucketName, Key: objectKey }),
    );
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType,
    };
  } catch {
    return null;
  }
}

// Best-effort delete. Caller logs failures and moves on — orphan blobs are
// recoverable later.
export async function deleteR2Object(objectKey: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: config.r2BucketName, Key: objectKey }));
}

// Fetch an R2 object's bytes as a base64 string. Used by the cash book
// receipt analyzer to feed images directly into Anthropic's vision API
// without going through a public URL.
export async function fetchR2ObjectAsBase64(
  objectKey: string,
): Promise<{ base64: string; contentType: string }> {
  const result = await r2Client.send(
    new GetObjectCommand({ Bucket: config.r2BucketName, Key: objectKey }),
  );
  const bytes = await result.Body!.transformToByteArray();
  return {
    base64: Buffer.from(bytes).toString('base64'),
    contentType: result.ContentType || 'image/jpeg',
  };
}
