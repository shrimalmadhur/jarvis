import { NextResponse } from "next/server";
import { db, mcpServers } from "@/lib/db";

export async function GET() {
  try {
    const servers = await db.query.mcpServers.findMany({
      orderBy: [mcpServers.createdAt],
    });
    return NextResponse.json(servers);
  } catch (error) {
    console.error("Error listing MCP servers:", error);
    return NextResponse.json(
      { error: "Failed to list servers" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    console.error("Error creating MCP server:", error);
    return NextResponse.json(
      { error: "Failed to create server" },
      { status: 500 }
    );
  }
}
