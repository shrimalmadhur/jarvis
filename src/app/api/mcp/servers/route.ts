import { NextResponse } from "next/server";
import { db, mcpServers } from "@/lib/db";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async () => {
  const servers = await db.query.mcpServers.findMany({
    orderBy: [mcpServers.createdAt],
  });
  return NextResponse.json(servers);
});

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const { name, command, args, env } = body;

  if (!name || !command) {
    return NextResponse.json(
      { error: "Name and command are required" },
      { status: 400 }
    );
  }

  const [server] = await db
    .insert(mcpServers)
    .values({
      name,
      command,
      args: args || [],
      env: env || {},
    })
    .returning();

  return NextResponse.json(server);
});
