# Jarvis - Personal AI Agent

Local-first personal AI agent with web chat UI. No auth, no billing, single user.
Uses MCP (Model Context Protocol) for external service integrations and supports multiple LLM providers.

## Quick Start

```bash
pnpm dev          # Start dev server (Next.js 16 + Turbopack)
npx tsc --noEmit  # Type check
```

## Tech Stack

- **Framework**: Next.js 16 App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4 (uses `@theme inline` in globals.css, NOT v3 config files)
- **Database**: PostgreSQL via Neon serverless (`@neondatabase/serverless` + `drizzle-orm`)
- **LLM Providers**: Gemini (default: `gemini-3-flash-preview`), OpenAI, Anthropic
- **Tools**: MCP servers (STDIO transport) + built-in filesystem/time tools
- **Package Manager**: pnpm

## Architecture

```
Chat UI → API Routes → Agent Core (agentic loop)
                         ├── LLM Router (Gemini/OpenAI/Anthropic)
                         ├── Built-in Tools (filesystem, time)
                         └── MCP Client Manager → MCP Servers (subprocesses)
```

The agent core (`src/lib/agent/core.ts`) implements an agentic loop:
1. Gather tools (built-in + MCP)
2. Send messages + tools to LLM
3. If LLM returns tool_calls → execute tools → loop back to step 2
4. If LLM returns text → return to user

## Project Structure

```
src/
  app/
    page.tsx                          # Redirect to /chat
    layout.tsx                        # Root layout (DM Sans + JetBrains Mono fonts)
    globals.css                       # Dark theme, CSS custom properties, Tailwind v4 @theme
    (app)/
      layout.tsx                      # Sidebar + main area
      chat/page.tsx                   # New chat
      chat/[id]/page.tsx              # Conversation view
      settings/page.tsx               # MCP servers + LLM config
    api/
      agent/chat/route.ts             # POST - send message, get response
      agent/conversations/route.ts    # GET - list conversations
      agent/conversations/[id]/route.ts # GET - conversation with messages
      mcp/servers/route.ts            # GET/POST - list/add MCP servers
      mcp/servers/[id]/route.ts       # PATCH/DELETE - update/remove server
      mcp/tools/route.ts              # GET - list available tools
  lib/
    agent/
      core.ts                         # Agentic loop, tool dispatch, MCP connection management
      builtin-tools.ts                # Built-in tools: list_directory, read_file, write_file, get_file_info, get_current_time
      system-prompt.ts                # Jarvis system prompt
      conversation-store.ts           # CRUD for conversations/messages
      types.ts                        # AgentRequest, AgentResponse
    ai/
      index.ts                        # Re-exports
      types.ts                        # LLMProvider interface, LLMMessage, LLMToolCall, etc.
      router.ts                       # Resolves LLM config from DB, selects provider
      providers/
        gemini.ts                     # Gemini provider (handles thought signatures for Gemini 3+)
        openai.ts                     # OpenAI provider
        anthropic.ts                  # Anthropic provider
    mcp/
      client.ts                       # MCPClientManager singleton (STDIO transport, 120s connect timeout)
      config.ts                       # Loads enabled MCP server configs from DB
      types.ts                        # MCPServerConfig, MCPToolDefinition, MCPToolResult
    db/
      index.ts                        # Neon connection (uses node-fetch with IPv4 agent for network compatibility)
      schema.ts                       # Drizzle schema: conversations, messages, agent_tasks, mcp_servers, llm_configs
  components/
    ui/                               # Button, Card (shadcn-style primitives)
    chat/                             # ChatInput, ChatMessage, ChatMessagesList
    layout/sidebar.tsx                # Navigation sidebar
```

## Database

PostgreSQL on Neon. Schema defined in `src/lib/db/schema.ts`.

**Tables**: `conversations`, `messages`, `agent_tasks`, `mcp_servers`, `llm_configs`

`drizzle-kit push` does NOT work on this network (IPv6 timeout). Schema changes must be applied via curl to Neon's SQL-over-HTTP endpoint:

```bash
curl -s "https://<neon-host>/sql" \
  -H "Neon-Connection-String: $DATABASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"query": "ALTER TABLE ...", "params": []}'
```

## Known Network Issue

Node.js on this machine has IPv6 connectivity problems to AWS/Cloudflare hosts. This affects:
- **Neon DB**: Fixed with `node-fetch` + `https.Agent({ family: 4 })` in `src/lib/db/index.ts`
- **npm/npx**: Broken. `npx` cannot download packages (ETIMEDOUT). MCP servers that need `npx` to install will fail to connect.
- **MCP servers**: The filesystem MCP server was replaced with built-in tools (`src/lib/agent/builtin-tools.ts`) to avoid the npm dependency.
- **Gemini API**: Works (Google's API endpoints resolve correctly)

## Key Design Decisions

- **Built-in tools are a temporary workaround**: `list_directory`, `read_file`, `write_file`, `get_file_info` in `src/lib/agent/builtin-tools.ts` exist only because `npx` can't download the filesystem MCP server on this network. Once the network issue is resolved (or the MCP server package is pre-installed), remove all built-in tools and replace them with the `@modelcontextprotocol/server-filesystem` MCP server. The only built-in tool that should remain is `get_current_time`.
- **MCP failure cache**: Failed MCP server connections are cached for 5 minutes to avoid blocking every request with a 120s timeout.
- **Provider parts preservation**: Gemini 3+ models require "thought signatures" on function call parts. Raw Gemini response parts are stored in `_providerParts` on `LLMMessage` and persisted via `provider_data` JSONB column. The Gemini provider replays these verbatim to avoid thought signature errors.
- **LLM model passed via constructor**: Each provider accepts `(apiKey?, model?)`. The router passes `config.model` from DB or defaults.

## Environment Variables

```
DATABASE_URL=postgresql://...        # Neon PostgreSQL (required)
GEMINI_API_KEY=...                   # Google Gemini (required for default provider)
OPENAI_API_KEY=...                   # OpenAI (optional)
ANTHROPIC_API_KEY=...                # Anthropic (optional)
```

## Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json`).
