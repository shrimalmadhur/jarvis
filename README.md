# Dobby

A local-first personal AI agent with a web chat interface. Single-user, self-hosted, no external databases. Dobby connects to multiple LLM providers (Gemini, OpenAI, Anthropic), extends its capabilities through MCP (Model Context Protocol) servers, and can run autonomous scheduled agents with Telegram notifications.

## Features

- **Web chat UI** with conversation history and streaming responses
- **Multi-provider LLM support** -- Gemini (default), OpenAI, Anthropic
- **MCP integration** -- extend Dobby with any MCP-compatible tool server
- **Autonomous agents** -- scheduled tasks organized into projects, managed via UI
- **SQLite database** -- no external database setup required
- **Telegram notifications** -- per-agent bot notifications for scheduled runs
- **System service** -- runs as systemd (Linux) or launchd (macOS)

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Framework** | Next.js 16 App Router, React 19, TypeScript |
| **Styling** | Tailwind CSS v4 |
| **Database** | SQLite via `bun:sqlite` + `drizzle-orm` |
| **LLM Providers** | Gemini (default), OpenAI, Anthropic |
| **Tools** | MCP servers + built-in filesystem/time tools |
| **Runtime** | Bun |

## Installation

The production install handles all dependencies automatically (git, curl, sqlite3, build tools, Bun). You only need `curl` and `sudo` to get started.

**Supported platforms:** Linux (apt, dnf, pacman, apk) and macOS.

### Quick Install (Recommended)

A single command to install or upgrade Dobby to the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash
```

This installs the latest released version. If no releases exist yet, it falls back to the `main` branch.

To inspect the script before running:

```bash
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh -o get-dobby.sh
less get-dobby.sh
sudo bash get-dobby.sh
```

Advanced options:

```bash
# Install from the main branch (latest development)
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --branch main

# Install from a specific branch
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --branch dev

# Install a specific version tag
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --version v0.2.0
```

### Manual Install (From Cloned Repo)

If you prefer to clone the repository yourself:

```bash
git clone https://github.com/shrimalmadhur/dobby.git
cd dobby
make install    # requires sudo
```

This installs Dobby to `/usr/local/lib/dobby/` and registers it as a system service. The production database at `/usr/local/lib/dobby/data/dobby.db` is preserved across upgrades.

### Configuration

After installation, edit the environment file at `/etc/dobby/env`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | Yes (if using Gemini) | Google Gemini API key |
| `OPENAI_API_KEY` | No | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | Anthropic API key |
| `DOBBY_PASSWORD` | No | Password to protect the web UI |
| `DOBBY_API_SECRET` | No | Bearer token for API hooks and scripts |
| `DATABASE_PATH` | No | Custom database path (default: `data/dobby.db`) |

Then restart the service (see [Managing the Service](#managing-the-service) below).

### Upgrading

Use the same method you used to install:

- **Curl-installed** (no local clone): re-run the curl command — it upgrades to the latest release:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash
  ```
  To track the `main` branch instead, pass `--branch main` explicitly:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --branch main
  ```
- **Clone-installed** (local repo): pull the latest code and run:
  ```bash
  cd dobby
  make upgrade
  ```

Both paths back up the database, rebuild, and restart the service.

### Managing the Service

The production server runs on **port 7749** and binds to all interfaces (`0.0.0.0`), so it is accessible from the network at `http://<your-server>:7749`. Set `DOBBY_PASSWORD` in `/etc/dobby/env` if the machine is reachable by others.

**Linux (systemd):**

```bash
sudo systemctl status dobby      # Check status
sudo systemctl restart dobby     # Restart
sudo systemctl stop dobby        # Stop
sudo journalctl -u dobby -f      # Follow logs
```

**macOS (launchd):**

```bash
launchctl print gui/$(id -u)/com.dobby.agent                  # Check status
launchctl kickstart -k gui/$(id -u)/com.dobby.agent            # Restart
launchctl kill SIGTERM gui/$(id -u)/com.dobby.agent             # Stop
tail -f /var/log/dobby/dobby.log                                # Follow logs
```

## Development

For contributors who want to run Dobby locally.

### Prerequisites

- **[Bun](https://bun.sh/)** -- install with `curl -fsSL https://bun.sh/install | bash`
- A **Gemini API key** (or OpenAI/Anthropic key)

### Setup

```bash
git clone https://github.com/shrimalmadhur/dobby.git
cd dobby
bun install
```

Create a `.env.local` file:

```env
GEMINI_API_KEY=your-gemini-api-key-here

# Optional
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
DOBBY_PASSWORD=your-password
```

Start the dev server:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server (Turbopack) |
| `bun run build` | Create production build |
| `bun run tsc --noEmit` | Type-check the codebase |
| `bun run lint` | Lint the codebase |
| `bun test` | Run tests |
| `bun run db:generate` | Generate a new migration after schema changes |
| `bun run db:studio` | Open Drizzle Studio to inspect the database |
| `bun run run-agents` | Run all scheduled autonomous agents |
| `bun run run-agents --list` | List configured agents |

## Architecture

Dobby uses an **agentic loop** -- it sends messages to the LLM, executes any requested tool calls, and loops until the LLM produces a final text response.

```
  User
    |
    v
  Chat UI  -->  API Routes  -->  Agent Core (agentic loop)
                                    |-- LLM Router (Gemini / OpenAI / Anthropic)
                                    |-- Built-in Tools (filesystem, time)
                                    +-- MCP Client Manager --> MCP Servers
```

1. You send a message through the chat UI
2. The agent gathers available tools (built-in + MCP servers)
3. The LLM processes the message and available tools
4. If the LLM requests tool calls, the agent executes them and loops back for further instructions
5. When the LLM returns a text response, it is delivered to the user

### Projects & Agents

Dobby supports **autonomous agents** that run on a schedule:

- **Projects** are containers that organize agents by purpose
- **Agents** belong to projects and have a **soul** (personality prompt), **skill** (task instructions), a cron schedule, and optional Telegram notifications
- Managed entirely through the web UI under **Projects**

## MCP Servers

Extend Dobby's capabilities by adding MCP (Model Context Protocol) servers:

1. Navigate to **Settings** in the web UI
2. Add an MCP server with its command and arguments
3. Dobby connects to the server and makes its tools available in conversations

## Slack Issue Setup

Dobby can create and continue issues from Slack threads using **Slack Socket Mode**. The Slack integration lives under **Issues > Config** in the web UI and expects two tokens:

- A **bot token** starting with `xoxb-`
- An **app-level token** starting with `xapp-`

Before configuring Slack, add at least one repository in **Issues > Config**. Slack issue creation uses the repository name from your message, for example `@bot repo-name: fix login redirect`.

### What Slack Can Do

Once configured:

- Mention the bot in a channel to create an issue
- Keep replying in that same Slack thread as the issue progresses
- Continue a completed issue by replying in the same thread later

Issue creation format:

```text
@bot repo-name: short or detailed description
```

The `repo-name` must match a repository you added in **Issues > Config**.

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app for your workspace.
2. Open **Socket Mode** and enable it.
3. Create an **App-Level Token** with the scope `connections:write`.
4. Save that token. This is the `xapp-...` token you will paste into Dobby.

### 2. Add Bot Scopes

Open **OAuth & Permissions** and add these bot token scopes:

- `app_mentions:read`
- `channels:history`
- `groups:history`
- `chat:write`

Then install or reinstall the app to the workspace and copy the **Bot User OAuth Token**. This is the `xoxb-...` token you will paste into Dobby.

Notes:

- `channels:history` is required for public channels.
- `groups:history` is required for private channels.
- `chat:write` lets Dobby reply in the issue thread.
- The app must be invited to each channel you want it to work in.

### 3. Add Event Subscriptions

Because this integration uses Socket Mode, Slack events are delivered over the app socket instead of a public HTTP webhook. In **Event Subscriptions**, enable events and subscribe to these bot events:

- `app_mention`
- `message.channels`
- `message.groups`

These are used for:

- `app_mention`: create a new issue from `@bot repo-name: description`
- `message.channels` / `message.groups`: capture replies inside the issue thread

If you only plan to use public channels, `message.channels` is the important one. If you want private channels too, keep `message.groups` and make sure the bot is invited.

### 4. Invite the Bot to the Channel

In Slack, invite the app to the channel where you want issues to be created:

```text
/invite @your-bot-name
```

If you want Dobby to accept issue mentions from any joined channel, stop here. If you want to restrict issue creation to a single channel, copy that channel's ID and enter it in Dobby.

### 5. Configure Dobby

In Dobby, open **Issues > Config** and fill in:

- **Bot token**: the `xoxb-...` token
- **App token**: the `xapp-...` token
- **Channel ID (optional)**: a Slack channel ID like `C0123456789`

Then click **Save & Test**.

Dobby immediately validates:

- the bot token with Slack `auth.test`
- the optional channel ID with `conversations.info`
- the app token by opening a Socket Mode connection

If the test passes, Dobby stores the config and starts the Slack socket listener automatically.

### 6. Usage and Behavior

- Start a new issue by mentioning the bot in a top-level channel message, not inside an existing thread.
- Reply in the created thread to answer follow-up questions or continue the conversation.
- Leave **Channel ID** blank if you want the bot to work in any channel it has joined.
- File-only thread replies are not supported yet; include text in the reply.

Example:

```text
@dobby-api web-app: the settings page crashes when saving profile changes
```

### Troubleshooting

- `Invalid Slack bot token format`: the bot token must start with `xoxb-`.
- `Invalid Slack app token format`: the app token must start with `xapp-`.
- `channel_not_found` or channel test failures: confirm the channel ID is correct and the bot has been invited.
- Mentions do nothing: make sure Socket Mode is enabled, the app is installed, and `app_mention` is subscribed.
- Thread replies do nothing: make sure `message.channels` or `message.groups` is subscribed for the channel type you're using.
- `Repository "..." not found`: add that repository name in **Issues > Config** or use the correct configured name in the Slack mention.

## Contributing

1. Fork the repository and create a feature branch
2. Make your changes
3. Run checks before submitting:
   ```bash
   bun run tsc --noEmit
   bun run lint
   bun test
   ```
4. Open a pull request

## License

MIT License
