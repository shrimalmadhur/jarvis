import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@/lib/db";
import { issueAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAttachmentsDir } from "@/lib/issues/attachments";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) {
  try {
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
      },
    });
  } catch (error) {
    console.error("Attachment serve error:", error);
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }
}
