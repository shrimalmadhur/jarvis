import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@/lib/db";
import { issueAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAttachmentsDir } from "@/lib/issues/attachments";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async (
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { attachmentId } = await params;
  const id = parseInt(attachmentId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid attachment ID" }, { status: 400 });
  }

  const [attachment] = await db
    .select()
    .from(issueAttachments)
    .where(eq(issueAttachments.id, id))
    .limit(1);

  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Path traversal protection: verify resolved path is within expected directory
  const resolvedPath = resolve(attachment.filePath);
  const expectedBase = resolve(getAttachmentsDir());
  if (!resolvedPath.startsWith(expectedBase + "/")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const buffer = await readFile(resolvedPath);
  return new Response(buffer, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
