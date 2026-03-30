# Codex CLI as Alternative Coding Harness

## Context

Dobby's issues pipeline and agent runner currently hardcode Claude CLI as the coding harness. We want to support OpenAI's Codex CLI as an alternative, selectable via:
- A UI setting for the default harness
- Per-message `--codex`/`--claude` flags in Slack/Telegram
- Per-issue tracking in the database

Codex CLI doesn't support worktrees natively, but the orchestrator already creates worktrees itself via `git worktree add` — we just pass the worktree dir to Codex via `-C <DIR>`.

## New Files

| File | Purpose |
|------|---------|
| `src/lib/harness/types.ts` | `HarnessType`, `HarnessPhaseOpts`, `HarnessPhaseResult` |
| `src/lib/harness/claude-harness.ts` | Claude CLI adapter (extracted from `claude-runner.ts`) |
| `src/lib/harness/codex-harness.ts` | Codex CLI adapter with JSONL parsing |
| `src/lib/harness/run-phase.ts` | Unified `runPhase()` dispatching to correct adapter |
| `src/lib/harness/resolve-codex-path.ts` | Resolve `codex` binary path |
| `src/components/settings/coding-harness-section.tsx` | Settings UI for default harness |

## Modified Files

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `harness` column to `issues` table |
| `src/lib/issues/pipeline/orchestrator.ts` | Use `runPhase()` instead of `runClaudePhase()` |
| `src/lib/issues/pipeline/helpers.ts` | Accept `harness` param in `createFreshPlanningSession()` |
| `src/lib/issues/pipeline/claude-runner.ts` | Keep `buildClaudeEnv()` + `isResumeSupported()`; re-export `runClaudePhase` from harness |
| `src/lib/issues/telegram-poller.ts` | Parse `--codex`/`--claude` flag; pass harness to DB insert |
| `src/lib/issues/slack-socket.ts` | Parse `--codex`/`--claude` flag; pass harness to DB insert |
| `src/lib/runner/agent-runner.ts` | Harness-aware CLI dispatch + JSONL parsing |
| `src/lib/runner/agent-conversation.ts` | Accept `harness` param in `resumeSession()` |
| `src/app/api/claude/prompt/route.ts` | Accept `harness` in body, dispatch to correct CLI |
| `src/app/api/issues/route.ts` | Accept `harness` in POST body |
| `src/app/api/settings/route.ts` | Add `default_coding_harness` validator |
| `src/app/(app)/settings/page.tsx` | Add `<CodingHarnessSection />` |
| `src/lib/validations/issue.ts` | Add optional `harness` to `createIssueSchema` |

## Implementation

### Task 1: Harness Types (`src/lib/harness/types.ts`)

```typescript
export const HARNESS_TYPES = ["claude", "codex"] as const;
export type HarnessType = typeof HARNESS_TYPES[number];

export interface HarnessPhaseOpts {
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  sessionId?: string;        // Claude: --session-id; Codex: ignored (auto-generated)
  resumeSessionId?: string;  // Claude: --resume; Codex: codex exec resume <thread_id>
  envOverrides?: Record<string, string>;
}

export interface HarnessPhaseResult {
  success: boolean;
  output: string;
  sessionId?: string;  // Claude: input UUID; Codex: thread_id from stream
  hasQuestions?: boolean;
  questions?: string;
  timedOut?: boolean;
}
```

### Task 2: Codex Path Resolution (`src/lib/harness/resolve-codex-path.ts`)

Mirror `resolve-claude-path.ts` pattern: check `~/.nvm/versions/node/*/bin/codex`, `/usr/local/bin/codex`, then `which codex`.

### Task 3: Claude Adapter (`src/lib/harness/claude-harness.ts`)

Extract `runClaudePhase()` body from `src/lib/issues/pipeline/claude-runner.ts`. Takes `HarnessPhaseOpts`, returns `HarnessPhaseResult`. Spawns `claude -p --verbose --output-format stream-json --dangerously-skip-permissions` with `--session-id`/`--resume`/`--append-system-prompt`.

Keep `buildClaudeEnv()` and `isResumeSupported()` in the original `claude-runner.ts` for backward compat, but the main `runClaudePhase` re-exports from the harness.

### Task 4: Codex Adapter (`src/lib/harness/codex-harness.ts`)

Spawns `codex exec --json --dangerously-bypass-approvals-and-sandbox -C <workdir> --skip-git-repo-check -`.

Key differences handled:
- **System prompt**: Prepended to user prompt as `[System Instructions]\n...\n\n[User Request]\n...`
- **Session ID**: Extracted from `thread.started` event's `thread_id`
- **Resume**: `codex exec resume <thread_id> --json ...`
- **JSONL parsing**: `item.completed` → text output, `turn.completed` → token usage
- **Env**: Allowlist includes `OPENAI_API_KEY` instead of `ANTHROPIC_API_KEY`

### Task 5: Unified Dispatcher (`src/lib/harness/run-phase.ts`)

```typescript
export function getDefaultHarness(): HarnessType {
  const setting = getSetting("default_coding_harness");
  return setting === "codex" ? "codex" : "claude";
}

export async function runPhase(
  opts: HarnessPhaseOpts & { harness?: HarnessType }
): Promise<HarnessPhaseResult> {
  const harness = opts.harness || getDefaultHarness();
  return harness === "codex" ? runCodexHarness(opts) : runClaudeHarness(opts);
}
```

### Task 6: DB Migration

Add `harness text DEFAULT 'claude'` to `issues` table.

Schema change in `src/lib/db/schema.ts`:
```typescript
harness: text("harness").default("claude"),
```

Generate migration: `bun run db:generate`

### Task 7: Settings UI & API

Add `default_coding_harness` to `SETTINGS_VALIDATORS` in `src/app/api/settings/route.ts`.

Create `CodingHarnessSection` component — radio buttons for Claude/Codex, fetches from `GET /api/settings`, saves via `PATCH /api/settings`.

Add to settings page.

### Task 8: Message Parsing

Update `parseIssueMessage()` (Telegram) and `parseSlackIssueMessage()` (Slack) to extract `--codex`/`--claude` flag from end of description. Return `harness?: HarnessType` in result.

Update issue creation in both handlers to pass `parsed.harness` to `db.insert(issues)`.

Update `createIssueSchema` with optional `harness` field.

### Task 9: Pipeline Integration

In `orchestrator.ts`:
1. Read `issue.harness` from DB at pipeline start
2. Replace all `runClaudePhase()` calls with `runPhase({...opts, harness})`
3. Resume check: `const resumeSupported = harness === "codex" ? true : await isResumeSupported()`
4. Pass harness to `createFreshPlanningSession()`

### Task 10: Agent Runner

In `agent-runner.ts`:
- Read harness from agent config or default setting
- Build args and spawn binary based on harness type
- Parse Codex JSONL events in `processStreamEvent()`: `thread.started` → sessionId, `item.completed` → text, `turn.completed` → tokens

### Task 11: Agent Conversation Resume

In `agent-conversation.ts`:
- Add `harness?: HarnessType` to `resumeSession()` signature
- For codex: spawn `codex exec resume <sessionId> --json ...` instead of `claude -p --resume`
- Parse Codex JSONL (`item.completed` → text)

Update callers in `telegram-poller.ts` and `slack-socket.ts` to pass `issue.harness`.

### Task 12: Direct Prompt API

In `src/app/api/claude/prompt/route.ts`:
- Accept optional `harness` in request body
- For codex: spawn codex with `--json`, parse `item.completed` events to SSE
- For claude: existing behavior unchanged

## Verification

1. `bun run tsc --noEmit` — type check passes
2. `bun run db:generate` — migration generated
3. `bun run dev` — app starts, settings page shows harness selector
4. Test with Claude (default): `/issue dobby: test issue` via Telegram → pipeline runs as before
5. Test with Codex: `/issue dobby: test issue --codex` → pipeline uses Codex CLI
6. Test settings: change default to Codex in UI → new issues default to Codex
7. Test agent runner: create agent, verify it can use Codex
8. Test resume: reply to completed issue → correct CLI resumes session
