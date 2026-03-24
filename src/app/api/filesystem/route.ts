import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { withErrorHandler } from "@/lib/api/utils";

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get("path") || homedir();
  const path = resolve(rawPath);

  const entries: { name: string; path: string; isGitRepo: boolean }[] = [];

  try {
    const items = await readdir(path, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith(".") || item.name === "node_modules") continue;
      if (!item.isDirectory()) continue;

      const fullPath = join(path, item.name);
      let isGitRepo = false;
      try {
        await stat(join(fullPath, ".git"));
        isGitRepo = true;
      } catch { /* not a git repo */ }

      entries.push({ name: item.name, path: fullPath, isGitRepo });
    }
  } catch {
    return NextResponse.json({ error: "Cannot read directory" }, { status: 400 });
  }

  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({
    current: path,
    parent: dirname(path) !== path ? dirname(path) : null,
    entries,
  });
});
