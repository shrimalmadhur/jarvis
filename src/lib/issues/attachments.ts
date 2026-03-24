import { resolve, join, extname, dirname } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { db } from "@/lib/db";
import { issueAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getFile, downloadTelegramFile, MAX_PHOTO_SIZE_BYTES } from "@/lib/telegram/api";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const ISSUE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Base directory for issue attachment storage (always absolute).
 * Mirrors the DB module's path resolution logic in src/lib/db/index.ts.
 */
export function getAttachmentsDir(): string {
  const dbPath =
    process.env.DATABASE_PATH ||
    join(process.cwd(), "data", "dobby.db");
  return resolve(dirname(dbPath), "issue-attachments");
}

/** Download a Telegram photo and save it as an attachment for an issue. */
export async function saveTelegramPhoto(
  botToken: string,
  issueId: string,
  fileId: string,
): Promise<{ filePath: string; filename: string }> {
  if (!ISSUE_ID_RE.test(issueId)) {
    throw new Error(`Invalid issueId for attachment storage: ${issueId}`);
  }

  const telegramFile = await getFile(botToken, fileId);

  // Pre-check file_size from Telegram metadata before downloading
  if (telegramFile.file_size && telegramFile.file_size > MAX_PHOTO_SIZE_BYTES) {
    throw new Error(`File too large: ${telegramFile.file_size} bytes (max ${MAX_PHOTO_SIZE_BYTES})`);
  }

  // getFile() guarantees file_path exists (throws otherwise), so use it directly
  const remotePath = telegramFile.file_path!;
  const ext = extname(remotePath) || ".jpg";
  const filename = `photo_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
  const mimeType = MIME_MAP[ext.toLowerCase()] || "image/jpeg";

  const dir = join(getAttachmentsDir(), issueId);
  await mkdir(dir, { recursive: true });

  const buffer = await downloadTelegramFile(botToken, remotePath);
  const filePath = join(dir, filename);
  await writeFile(filePath, buffer);

  await db.insert(issueAttachments).values({
    issueId,
    filename,
    filePath,
    mimeType,
    fileSize: buffer.length,
    telegramFileId: fileId,
  });

  return { filePath, filename };
}

/** Get all attachment records for an issue. */
export async function getIssueAttachments(issueId: string) {
  return db.select().from(issueAttachments).where(eq(issueAttachments.issueId, issueId));
}

/** Delete all attachment files from disk for an issue. Must be called before DB cascade delete. */
export async function deleteIssueAttachmentFiles(issueId: string): Promise<void> {
  if (!ISSUE_ID_RE.test(issueId)) {
    throw new Error(`Invalid issueId for attachment deletion: ${issueId}`);
  }
  const dir = join(getAttachmentsDir(), issueId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
