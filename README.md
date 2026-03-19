# Dobby

> *"Dobby is a free elf!"*

A local-first personal AI agent with a web chat interface. No masters, no Ministry oversight, no Gringotts billing -- just a loyal house-elf devoted to a single wizard. Give Dobby a sock (an API key), and Dobby shall serve you faithfully.

Dobby wields MCP (Model Context Protocol) to connect with external magical services, and speaks through multiple LLM providers (Gemini, OpenAI, Anthropic) -- choose your wand core wisely.

## The Spellbook (Tech Stack)

| Artifact | Enchantment |
|----------|-------------|
| **Framework** | Next.js 16 App Router, React 19, TypeScript |
| **Styling** | Tailwind CSS v4 -- robes tailored to perfection |
| **Database** | SQLite via `better-sqlite3` + `drizzle-orm` -- Dobby's Pensieve |
| **LLM Providers** | Gemini (default), OpenAI, Anthropic -- three wand cores |
| **Tools** | MCP servers + built-in filesystem/time tools -- Dobby's toolkit |
| **Runtime** | Bun -- swift as a Nimbus 2000 |

## Summoning Dobby (Getting Started)

Every great wizard needs a house-elf. Here is how you call upon Dobby.

### Prerequisites

Before you begin, gather these magical artifacts from Diagon Alley:

- **[Bun](https://bun.sh/)** -- the enchanted runtime that powers Dobby's spells
- **A Gemini API key** -- your sock of freedom (or an OpenAI/Anthropic key if you prefer a different wand)

### Step 1: Retrieve the Enchanted Tome

```bash
git clone https://github.com/shrimalmadhur/dobby.git
cd dobby
```

### Step 2: Gather the Ingredients

Like a proper Potions class, you'll need all your ingredients before you begin:

```bash
bun install
```

### Step 3: Whisper Your Secrets

Create a `.env.local` file -- think of it as your personal Marauder's Map, revealing secrets only to you:

```env
GEMINI_API_KEY=your-gemini-api-key-here

# Optional wand cores
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key

# Optional: cast a Protego charm on the web UI
DOBBY_PASSWORD=your-password
```

### Step 4: Cast the Summoning Charm

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) -- the Room of Requirement awaits. Dobby is ready to serve.

## Useful Incantations

Every spell in Dobby's repertoire, ready for you to cast:

| Incantation | Effect |
|-------------|--------|
| `bun run dev` | *Lumos!* -- Ignite the development server (Turbopack) |
| `bun run build` | Forge the production build |
| `bun run start` | Awaken the production server |
| `bun run tsc --noEmit` | *Revelio!* -- Reveal type errors lurking in the codebase |
| `bun run lint` | *Scourgify!* -- Clean up code lint |
| `bun run db:generate` | Inscribe a new migration scroll after schema changes |
| `bun run db:studio` | Open the Pensieve (Drizzle Studio) to inspect your data |
| `bun run run-agents` | Dispatch all scheduled autonomous agents |
| `bun run run-agents --list` | Summon the roll call of configured agents |
| `bun test` | Put your spells to the test |

## How Dobby Works (The Marauder's Map)

Dobby's magic flows through an **agentic loop** -- like a tireless house-elf who keeps Apparating back to check if there's more work to be done:

```
  You (the Wizard)
      |
      v
  Chat UI  -->  API Routes  -->  Agent Core (the agentic loop)
                                    |-- LLM Router (Gemini / OpenAI / Anthropic)
                                    |-- Built-in Tools (filesystem, time)
                                    +-- MCP Client Manager --> MCP Servers
```

1. You send an owl (a message) through the chat UI
2. Dobby gathers his tools from the enchanted cupboard (built-in + MCP servers)
3. Dobby consults the Oracle (LLM) for guidance
4. If the Oracle demands spell-work (tool calls), Dobby executes them and Apparates back for further instructions
5. When the Oracle speaks its final word, Dobby delivers the answer to you on a silver platter

### Projects & Agents -- The Order of Autonomous Elves

Dobby can also command **autonomous agents** that work on a schedule -- enchanted servants carrying out tasks while you slumber in Gryffindor Tower:

- **Projects** are like Hogwarts Houses -- containers that organize your agents by purpose
- **Agents** belong to projects and each possesses a **soul** (personality prompt), a **skill** (task instructions), a schedule (their magical alarm clock), and optional Telegram owl notifications
- Managed entirely through the web UI at **Projects** -- no dark magic (command line) required

## Deploying to the Castle (Production)

Dobby can be installed as a system service, standing guard at the gates of Hogwarts even while you sleep:

```bash
# First-time installation -- the Sorting Ceremony (requires sudo)
make install

# Subsequent upgrades -- like getting new school robes each year
make upgrade
```

This installs Dobby to `/usr/local/lib/dobby/` and creates a systemd service (Linux) or launchd service (macOS). The Pensieve (production database) lives at `/usr/local/lib/dobby/data/dobby.db` and is preserved across upgrades -- no memories lost.

Environment variables for production are sealed in `/etc/dobby/env` -- guarded more carefully than a Gringotts vault.

## Magical Secrets (Environment Variables)

| Secret | Required | Purpose |
|--------|----------|---------|
| `GEMINI_API_KEY` | Yes (if using Gemini) | The sock that frees Dobby to use Gemini |
| `OPENAI_API_KEY` | No | Alternative wand core -- OpenAI |
| `ANTHROPIC_API_KEY` | No | Alternative wand core -- Anthropic |
| `DOBBY_PASSWORD` | No | Protego charm for the web UI |
| `DOBBY_API_SECRET` | No | Bearer token for API hooks and scripts |
| `DATABASE_PATH` | No | Custom Pensieve location (default: `data/dobby.db`) |

## MCP Servers (Extending Dobby's Powers)

Dobby's abilities grow when you give him new magical items -- MCP servers are like enchanted objects from the Room of Requirement. Each one grants Dobby new powers:

1. Navigate to **Settings** in the web UI
2. Add an MCP server -- its command and arguments, like an incantation and wand movement
3. Dobby will bond with the server and wield its tools in your conversations

*"Dobby can do all sorts of magic, sir!"*

## License

Dobby has no master. Dobby is a free elf.
