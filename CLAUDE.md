# Jarvis - Personal AI Agent

Local-first personal AI agent with web chat UI. No auth, no billing, single user.
Uses MCP (Model Context Protocol) for external service integrations and supports multiple LLM providers.

## Quick Start

```bash
bun run dev          # Start dev server (Next.js 16 + Turbopack)
bun run tsc --noEmit # Type check
```

## Tech Stack

- **Framework**: Next.js 16 App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4 (uses `@theme inline` in globals.css, NOT v3 config files)
- **Database**: SQLite via `better-sqlite3` + `drizzle-orm` (local file at `data/jarvis.db`)
- **LLM Providers**: Gemini (default: `gemini-3-flash-preview`), OpenAI, Anthropic
- **Tools**: MCP servers (STDIO transport) + built-in filesystem/time tools
- **Runtime**: Bun (package manager, script runner, production server)

## Architecture

```
Chat UI → API Routes → Agent Core (agentic loop)
                         ├── LLM Router (Gemini/OpenAI/Anthropic)
                         ├── Built-in Tools (filesystem, time)
                         └── MCP Client Manager → MCP Servers (subprocesses)

Cron Runner → scripts/run-agents.ts → Agent Runner
                ├── Reads agents/{name}/{soul.md, skill.md, config.json}
                ├── Calls LLM provider directly
                ├── Logs runs to agent_runs table (SQLite)
                └── Sends result to per-agent Telegram bot
```

The agent core (`src/lib/agent/core.ts`) implements an agentic loop:
1. Gather tools (built-in + MCP)
2. Send messages + tools to LLM
3. If LLM returns tool_calls → execute tools → loop back to step 2
4. If LLM returns text → return to user

## Project Structure

```
agents/                                # Autonomous agent definitions
  food-facts/                          # Example agent
    soul.md                            # Agent personality/system prompt
    skill.md                           # Task instructions per run
    config.json                        # Schedule, telegram, model config
  _template/                           # Template for new agents
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
    runner/
      types.ts                        # AgentConfig, AgentDefinition, RunResult
      config-loader.ts                # Reads agents/ dir, resolves env vars
      agent-runner.ts                 # Headless agentic loop for cron agents
      telegram-sender.ts              # Sends results to per-agent Telegram bot
      run-log.ts                      # Logs runs to agent_runs table
    mcp/
      client.ts                       # MCPClientManager singleton (STDIO transport, 120s connect timeout)
      config.ts                       # Loads enabled MCP server configs from DB
      types.ts                        # MCPServerConfig, MCPToolDefinition, MCPToolResult
    db/
      index.ts                        # SQLite connection (better-sqlite3, WAL mode)
      schema.ts                       # Drizzle schema: conversations, messages, agent_tasks, mcp_servers, llm_configs, agent_runs
  components/
    ui/                               # Button, Card (shadcn-style primitives)
    chat/                             # ChatInput, ChatMessage, ChatMessagesList
    layout/sidebar.tsx                # Navigation sidebar
scripts/
    run-agents.ts                     # CLI: bun run scripts/run-agents.ts [agent-name]
    install-cron.sh                   # Generate crontab entries from agent configs
data/
    jarvis.db                         # SQLite database (gitignored)
```

## Database

SQLite via `better-sqlite3`. Schema defined in `src/lib/db/schema.ts`. DB file at `data/jarvis.db` (auto-created).

**Tables**: `conversations`, `messages`, `agent_tasks`, `mcp_servers`, `llm_configs`, `notification_configs`, `agent_runs`

Schema changes:
```bash
bun run drizzle-kit push   # Apply schema to local SQLite
```

## Agent Runner

Autonomous agents run on a cron schedule via `scripts/run-agents.ts`:

```bash
bun run run-agents              # Run all enabled agents
bun run run-agents food-facts   # Run specific agent
bun run run-agents --list       # List configured agents
```

Each agent lives in `agents/{name}/` with:
- `soul.md` - personality/system prompt
- `skill.md` - task instructions for each run
- `config.json` - schedule, Telegram bot config, LLM model

Telegram secrets use `${ENV_VAR}` syntax in config.json, resolved at runtime.

## Key Design Decisions

- **Bun runtime**: Bun is used as the package manager, script runner, and production server. `better-sqlite3` is kept (instead of `bun:sqlite`) because Next.js build workers run Node.js internally and can't load Bun-only built-in modules.
- **Built-in tools are a temporary workaround**: `list_directory`, `read_file`, `write_file`, `get_file_info` in `src/lib/agent/builtin-tools.ts` exist only because `npx` can't download the filesystem MCP server on this network. Once the network issue is resolved (or the MCP server package is pre-installed), remove all built-in tools and replace them with the `@modelcontextprotocol/server-filesystem` MCP server. The only built-in tool that should remain is `get_current_time`.
- **MCP failure cache**: Failed MCP server connections are cached for 5 minutes to avoid blocking every request with a 120s timeout.
- **Provider parts preservation**: Gemini 3+ models require "thought signatures" on function call parts. Raw Gemini response parts are stored in `_providerParts` on `LLMMessage` and persisted via `provider_data` JSON column. The Gemini provider replays these verbatim to avoid thought signature errors.
- **LLM model passed via constructor**: Each provider accepts `(apiKey?, model?)`. The router passes `config.model` from DB or defaults.
- **Agent runner is stateless**: Each cron run is independent. Recent run outputs are queried from `agent_runs` table to inject context (e.g., topic dedup).

## Environment Variables

```
DATABASE_PATH=data/jarvis.db          # SQLite path (optional, defaults to data/jarvis.db)
GEMINI_API_KEY=...                    # Google Gemini (required for default provider)
JARVIS_PASSWORD=...                   # Web UI password (optional, no auth if unset)
JARVIS_API_SECRET=...                 # API bearer token for hooks/scripts (optional)
OPENAI_API_KEY=...                    # OpenAI (optional)
ANTHROPIC_API_KEY=...                 # Anthropic (optional)

# Per-agent Telegram bots (used by agent runner)
FOOD_FACTS_TELEGRAM_BOT_TOKEN=...    # Food facts agent bot token
FOOD_FACTS_TELEGRAM_CHAT_ID=...      # Food facts agent chat ID
```

## Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json`).
