# Dobby - Personal AI Agent

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
- **Database**: SQLite via `better-sqlite3` + `drizzle-orm` (local file at `data/dobby.db`)
- **LLM Providers**: Gemini (default: `gemini-3-flash-preview`), OpenAI, Anthropic
- **Tools**: MCP servers (STDIO transport) + built-in filesystem/time tools
- **Runtime**: Bun (package manager, script runner, production server)

## Architecture

```
Chat UI → API Routes → Agent Core (agentic loop)
                         ├── LLM Router (Gemini/OpenAI/Anthropic)
                         ├── Built-in Tools (filesystem, time)
                         └── MCP Client Manager → MCP Servers (subprocesses)

Projects UI → API Routes → DB (projects + agents tables)
                             ├── CRUD for projects
                             ├── CRUD for agents within projects
                             └── Telegram notification config per agent

Cron Runner → scripts/run-agents.ts → Agent Runner
                ├── Loads DB agents (primary) + filesystem agents (legacy, deduped)
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
agents/                                # Legacy filesystem agent definitions (deprecated)
  food-facts/                          # Example agent
    soul.md                            # Agent personality/system prompt
    skill.md                           # Task instructions per run
    config.json                        # Schedule, telegram, model config
  _template/                           # Template for new agents
src/
  app/
    page.tsx                          # Redirect to /chat
    layout.tsx                        # Root layout (Inter + JetBrains Mono fonts)
    globals.css                       # Dark theme, CSS custom properties, Tailwind v4 @theme
    (app)/
      layout.tsx                      # Sidebar + main area
      chat/page.tsx                   # New chat
      chat/[id]/page.tsx              # Conversation view
      projects/page.tsx               # Projects list + create
      projects/[id]/page.tsx          # Project detail (agents list)
      projects/[id]/agents/new/page.tsx       # Create agent form
      projects/[id]/agents/[agentId]/page.tsx # Agent detail (edit, runs, telegram)
      agents/page.tsx                 # Redirects to /projects
      settings/page.tsx               # MCP servers + LLM config
    api/
      agent/chat/route.ts             # POST - send message, get response
      agent/conversations/route.ts    # GET - list conversations
      agent/conversations/[id]/route.ts # GET - conversation with messages
      projects/route.ts               # GET/POST - list/create projects
      projects/[id]/route.ts          # GET/PATCH/DELETE - project CRUD
      projects/[id]/agents/route.ts   # GET/POST - list/create agents in project
      agents/[agentId]/route.ts       # GET/PATCH/DELETE - agent CRUD
      agents/[agentId]/runs/route.ts  # GET - agent run history
      agents/[agentId]/telegram/route.ts       # GET/POST/DELETE - telegram config
      agents/[agentId]/telegram/setup/route.ts # POST - validate/poll telegram
      agents/[agentId]/telegram/test/route.ts  # POST - test telegram
      mcp/servers/route.ts            # GET/POST - list/add MCP servers
      mcp/servers/[id]/route.ts       # PATCH/DELETE - update/remove server
      mcp/tools/route.ts              # GET - list available tools
  lib/
    agent/
      core.ts                         # Agentic loop, tool dispatch, MCP connection management
      builtin-tools.ts                # Built-in tools: list_directory, read_file, write_file, get_file_info, get_current_time
      system-prompt.ts                # Dobby system prompt
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
      config-loader.ts                # Reads agents/ dir (legacy filesystem agents)
      db-config-loader.ts             # Reads agents from DB (primary source)
      agent-runner.ts                 # Headless agentic loop for cron agents
      telegram-sender.ts              # Sends results to per-agent Telegram bot
      run-log.ts                      # Logs runs to agent_runs table
    mcp/
      client.ts                       # MCPClientManager singleton (STDIO transport, 120s connect timeout)
      config.ts                       # Loads enabled MCP server configs from DB
      types.ts                        # MCPServerConfig, MCPToolDefinition, MCPToolResult
    db/
      index.ts                        # SQLite connection (better-sqlite3, WAL mode)
      schema.ts                       # Drizzle schema (see Database section)
    utils/
      cron.ts                         # cronToHuman() - shared cron expression formatter
    validations/
      project.ts                      # Zod schemas for project create/update
      agent.ts                        # Zod schemas for agent create/update
  components/
    ui/                               # Button, Card (shadcn-style primitives)
    chat/                             # ChatInput, ChatMessage, ChatMessagesList
    agents/agent-form.tsx             # Reusable agent create/edit form
    layout/top-nav.tsx                # Navigation bar
scripts/
    run-agents.ts                     # CLI: bun run scripts/run-agents.ts [agent-name] [--project name]
    migrate-fs-agents.ts              # One-time: migrate filesystem agents to DB
    install-cron.sh                   # Generate crontab entries from agent configs
data/
    dobby.db                          # SQLite database (gitignored)
```

## Database

SQLite via `better-sqlite3`. Schema defined in `src/lib/db/schema.ts`. DB file at `data/dobby.db` (auto-created).

**Tables**: `conversations`, `messages`, `agent_tasks`, `mcp_servers`, `llm_configs`, `notification_configs`, `projects`, `agents`, `agent_runs`, `claude_sessions`, `claude_session_timeline`, `claude_session_sub_agents`, `claude_session_tasks`

**Projects & Agents** (DB-managed):
- `projects` - top-level containers for agents (name is unique)
- `agents` - agent definitions with soul, skill, schedule, LLM config. FK to projects (cascade delete). Name must be unique within a project (enforced in API).
- `agent_runs.agentId` - optional FK to agents table (set for DB agents, null for legacy filesystem agents)

**Migrations** (auto-applied on startup via `src/lib/db/auto-migrate.ts`):

Schema changes must go through drizzle migrations — never use `drizzle-kit push` directly:
1. Edit `src/lib/db/schema.ts`
2. Run `bun run db:generate` to create a new migration file in `drizzle/`
3. Commit the migration file — it gets applied automatically on next app startup

Migration files in `drizzle/` are tracked by drizzle's `__drizzle_migrations` table. The app calls `migrate()` on every startup, so users never need to run manual migration commands after upgrading.

## Agent Runner

Autonomous agents are managed via UI (Projects → Agents) and stored in the database. Legacy filesystem agents (`agents/` dir) are still supported but deprecated.

```bash
bun run run-agents                    # Run all enabled agents (DB + filesystem, deduped)
bun run run-agents food-facts         # Run specific agent by name
bun run run-agents --project MyProj   # Run only agents from a specific project
bun run run-agents --list             # List configured agents
bun run scripts/migrate-fs-agents.ts  # One-time: migrate filesystem agents to DB
```

**DB agents** (primary): Created via UI, stored in `agents` table. Each belongs to a project.
**Filesystem agents** (legacy): Each lives in `agents/{name}/` with `soul.md`, `skill.md`, `config.json`. DB agents with the same name take precedence (dedup).

Telegram notifications are configured per-agent via the UI. Config stored in `notification_configs` table with channel key `telegram-agent:{agentId}`.

## Key Design Decisions

- **Bun runtime**: Bun is used as the package manager, script runner, and production server. `better-sqlite3` is kept (instead of `bun:sqlite`) because Next.js build workers run Node.js internally and can't load Bun-only built-in modules.
- **Built-in tools are a temporary workaround**: `list_directory`, `read_file`, `write_file`, `get_file_info` in `src/lib/agent/builtin-tools.ts` exist only because `npx` can't download the filesystem MCP server on this network. Once the network issue is resolved (or the MCP server package is pre-installed), remove all built-in tools and replace them with the `@modelcontextprotocol/server-filesystem` MCP server. The only built-in tool that should remain is `get_current_time`.
- **MCP failure cache**: Failed MCP server connections are cached for 5 minutes to avoid blocking every request with a 120s timeout.
- **Provider parts preservation**: Gemini 3+ models require "thought signatures" on function call parts. Raw Gemini response parts are stored in `_providerParts` on `LLMMessage` and persisted via `provider_data` JSON column. The Gemini provider replays these verbatim to avoid thought signature errors.
- **LLM model passed via constructor**: Each provider accepts `(apiKey?, model?)`. The router passes `config.model` from DB or defaults.
- **Agent runner is stateless**: Each cron run is independent. Recent run outputs are queried from `agent_runs` table to inject context (e.g., topic dedup).
- **Projects → Agents hierarchy**: Agents are organized into projects (DB-backed). All agent CRUD is done via UI/API. The `agents/` filesystem directory is legacy — DB agents take precedence when both exist with the same name.

## Deployment

Dobby is deployed as a system service via `make install` (first time) and `make upgrade` (updates).

- **Install dir**: `/usr/local/lib/dobby/`
- **Production DB**: `/usr/local/lib/dobby/data/dobby.db` (preserved across upgrades)
- **Env config**: `/etc/dobby/env`
- **Service**: systemd (`dobby`) on Linux, launchd (`com.dobby.agent`) on macOS

When debugging data issues, always query the **installation DB** (`/usr/local/lib/dobby/data/dobby.db`), not the repo-local `data/dobby.db`.

## Environment Variables

```
DATABASE_PATH=data/dobby.db          # SQLite path (optional, defaults to data/dobby.db)
GEMINI_API_KEY=...                    # Google Gemini (required for default provider)
DOBBY_PASSWORD=...                   # Web UI password (optional, no auth if unset)
DOBBY_API_SECRET=...                 # API bearer token for hooks/scripts (optional)
OPENAI_API_KEY=...                    # OpenAI (optional)
ANTHROPIC_API_KEY=...                 # Anthropic (optional)

# Per-agent Telegram bots (used by agent runner)
FOOD_FACTS_TELEGRAM_BOT_TOKEN=...    # Food facts agent bot token
FOOD_FACTS_TELEGRAM_CHAT_ID=...      # Food facts agent chat ID
```

## Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json`).
