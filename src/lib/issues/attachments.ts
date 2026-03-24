import { resolve, join, extname, dirname } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { db } from "@/lib/db";
import { issueAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getFile, downloadTelegramFile } from "@/lib/telegram/api";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

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
  const telegramFile = await getFile(botToken, fileId);
  const ext = extname(telegramFile.file_path || ".jpg") || ".jpg";
  const filename = `photo_${Date.now()}${ext}`;
  const mimeType = MIME_MAP[ext.toLowerCase()] || "image/jpeg";

  const dir = join(getAttachmentsDir(), issueId);
  await mkdir(dir, { recursive: true });

  const buffer = await downloadTelegramFile(botToken, telegramFile.file_path!);
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

/** Delete all attachment files from disk for an issue. */
export async function deleteIssueAttachmentFiles(issueId: string): Promise<void> {
  const dir = join(getAttachmentsDir(), issueId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
