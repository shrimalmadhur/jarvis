# Implementation Plan: Unit Tests for Dobby

## Codebase Analysis

### Existing Test Infrastructure
- **Framework:** Bun's built-in test runner (`bun:test`) — no new dependencies needed
- **Convention:** `__tests__/` directory co-located with source files
- **Existing tests:** 12 files covering `runner/`, `utils/cron`, `issues/`, `instrumentation`, `version`, `install-cron`
- **Patterns:** `mock.module()` for module mocking, temp directories for filesystem tests, `makeX()` builders for test data, env var save/restore
- **Test discovery:** `bun test` recursively discovers all `*.test.ts` files under `src/` — no `bunfig.toml` or explicit test globs configured, so new `__tests__/` directories in any `src/lib/` subdirectory will be auto-discovered

### Untested Modules (Gaps)
| Module | Lines | Pure Logic | Side Effects | Priority |
|--------|-------|-----------|-------------|----------|
| `lib/validations/*` | ~120 | Zod schemas, deny-list | None | **P0** |
| `lib/utils/format.ts` | ~10 | `formatDuration()` | None | **P0** |
| `lib/notifications/telegram.ts` | ~260 | `maskToken`, `escapeHtml`, `markdownToTelegramHtml` | Network, DB | **P0** |
| `lib/agent/system-prompt.ts` | ~40 | `buildSystemPrompt()` | None | **P0** |
| `lib/claude/utils.ts` | ~70 | `shortenModel`, `extractProjectName`, `encodeProjectDir`, `decodeProjectDir`, `parseJsonlEntries` | None | **P0** |
| `lib/runner/run-events.ts` | ~80 | In-memory pub/sub | None | **P1** |
| `lib/agent/builtin-tools.ts` | ~120 | Tool definitions, execution | Filesystem | **P1** |
| `lib/ai/providers/*.ts` | ~600 | Message/tool conversion (private) | Network | **P1** |
| `lib/ai/router.ts` | ~80 | Config resolution, caching | DB | **P1** |
| `lib/agent/conversation-store.ts` | ~140 | DB→LLMMessage conversion (private) | DB | **P1** |
| `lib/api/utils.ts` | ~50 | Error helpers | None | **P2** |
| `lib/auth.ts` | ~80 | Token create/verify | Crypto | **P2** |
| `lib/runner/telegram-sender.ts` | ~80 | Message formatting | DB, Network | **P2** |
| `lib/runner/run-log.ts` | ~40 | Direct DB insert | DB | **P3** |
| `lib/mcp/client.ts` | ~150 | Tool lookup, state | Subprocesses | **P3** |

### Key Code Patterns the Implementer Must Reference

**Mocking modules (from `db-config-loader.test.ts`):**
```typescript
mock.module("@/lib/db", () => ({
  db: { select: mockSelect },
}));
// MUST import target AFTER mock.module()
const { targetFunction } = await import("../target-module");
```

**Test data builders (from `agent-runner.test.ts`):**
```typescript
function makeDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return { config: { name: "test", enabled: true, schedule: "0 9 * * *" }, ...overrides };
}
```

**Filesystem test setup (from `agent-memory.test.ts`):**
```typescript
const TEST_DIR = join(import.meta.dir, ".tmp-test-xyz");
beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));
```

**Env var save/restore (from existing tests):**
```typescript
let savedEnv: string | undefined;
beforeEach(() => { savedEnv = process.env.SOME_VAR; });
afterEach(() => {
  if (savedEnv !== undefined) process.env.SOME_VAR = savedEnv;
  else delete process.env.SOME_VAR;
});
```

### Architecture Notes
- All LLM providers implement `LLMProvider` interface with a single `chat()` method. **Conversion logic is private/inlined:** Gemini and Anthropic have `private convertMessages()` methods; OpenAI inlines all conversion directly in `chat()`. No provider exposes `convertTools()` — tool conversion is always inlined. **Therefore, provider tests must mock the SDK client and assert correctness by inspecting the arguments passed to the API call method.**
- `conversation-store.ts` has a `dbMessageToLLM()` helper that reconstructs `LLMMessage` from DB rows, including JSON-parsed `toolCalls` and `_providerParts`. **This function is not exported** — it must be tested indirectly through `getConversation()` with a mocked DB.
- The `agent/core.ts` agentic loop has max 10 iterations — testable by mocking LLM to return tool_calls N times then stop.
- `run-events.ts` is pure in-memory state — no external dependencies, fully testable. Uses a `generation` counter to guard against race conditions when the same agentId is reused across start/end/start cycles. Uses `setTimeout(5000)` for deferred cleanup — tests should use fake timers or assert before the delay.
- Validation schemas in `validations/agent.ts` import `DENIED_ENV_KEYS` from `runner/agent-memory.ts` — there is a single source of truth (the Set in `agent-memory.ts`). The `validations/agent.ts` module does NOT re-export it.
- `run-log.ts` contains **no truncation logic** — it passes `toolInput`/`toolOutput` directly to the DB insert. Truncation of tool use data (4000 chars) happens in `agent-runner.ts`, not `run-log.ts`.
- `router.ts` uses a module-level `providerCache` Map and `run-events.ts` uses module-level `activeRuns` Map + `nextGeneration` counter. **Tests must isolate this state** between test cases (re-import the module, or call cleanup methods in `afterEach`).
- **The codebase uses two Drizzle API styles.** Some modules (`telegram-sender.ts`, `run-log.ts`) use the **builder API** (`db.select().from().where().limit()`, `db.insert().values().returning()`). Other modules (`router.ts`, `conversation-store.ts`) use the **relational query API** (`db.query.tableName.findFirst()`, `db.query.tableName.findMany()`). Mocks must match the API style used by the specific module under test.

---

## Detailed Implementation Steps

### Step 1: Pure Function Tests (No Mocking Required)

**1a. `src/lib/validations/__tests__/agent.test.ts`** — Zod schema validation
- Valid agent creation (all fields)
- Name validation: min/max length, special characters rejected, valid patterns accepted
- Schedule validation: valid 5-field cron accepted, invalid rejected
- `envVars` deny-list filtering: pass `{ PATH: "/evil", MY_VAR: "safe" }` through the schema and assert `PATH` is stripped while `MY_VAR` survives. Also test `LD_PRELOAD`, `HOME`, and other keys from `DENIED_ENV_KEYS` are filtered.
- `envVars` key validation: underscores/alphanumeric pass, special chars rejected
- `envVars` whitespace trimming
- `updateAgentSchema` allows partial fields
- Soul/skill length boundaries (1 char, 50000 chars)

**1b. `src/lib/validations/__tests__/project.test.ts`** — Project schema validation
- Valid project creation
- Name required, 1-100 chars
- Description optional, max 500 chars

**1c. `src/lib/validations/__tests__/issue.test.ts`** — Issue schema validation
- Valid issue creation
- Required fields: repositoryId, title, description
- Title max 200 chars, description max 50000 chars

**1d. `src/lib/validations/__tests__/repository.test.ts`** — Repository schema validation
- `localRepoPath` must start with `/`, valid characters only
- `defaultBranch` validation regex
- `githubRepoUrl` optional URL validation

**1e. `src/lib/utils/__tests__/format.test.ts`** — Duration formatting
- 0ms → "0ms"
- 500ms → "500ms"
- 999ms → "999ms"
- 1000ms → "1.0s"
- 1500ms → "1.5s"
- 60000ms → "60.0s"

**1f. `src/lib/agent/__tests__/system-prompt.test.ts`** — System prompt generation
- Returns a string containing tool documentation
- Contains current timestamp (ISO format)
- Stable structure (key sections present)
- **Read source first to verify exact content before asserting specific strings**

**1g. `src/lib/runner/__tests__/run-events.test.ts`** — Event pub/sub system
- `startRun()` makes run active, `endRun()` cleans up
- `isRunActive()` reflects state
- `emitRunEvent()` delivers to subscribers
- `subscribeToRun()` replays existing events + receives future ones
- **`subscribeToRun()` returns `null` when no active run exists** (distinct from the complete-event replay case which returns `() => {}`)
- Complete event stops subscription
- **Complete-event replay:** When replayed events include a `"complete"` event, `subscribeToRun()` returns a no-op unsubscribe function (does not add listener to live set — prevents memory leaks)
- Listener errors don't crash other listeners
- Max 500 events per run (overflow handling)
- Multiple concurrent runs are isolated
- **Generation guard race condition:** `startRun("a")` → `endRun("a")` → `startRun("a")` again — the 5-second cleanup timer from the first `endRun` must NOT delete the second run's state (verified via generation counter)
- **Timer handling strategy:** Either use Bun's fake timer support (`mock.module` on timers) or assert state immediately after `endRun()` before the 5s timeout fires. The deferred cleanup should be verified by checking that the run state persists for subscribers during the 5s grace window
- **Module-level state isolation:** Each test file should re-import `run-events.ts` via dynamic `await import()` in `beforeEach`, or explicitly call `endRun()` for all active runs in `afterEach` to reset module state

**1h. `src/lib/claude/__tests__/utils.test.ts`** — Claude utility functions (P0, pure functions, no mocking)
- `shortenModel()`:
  - `"claude-opus-4-6-20260101"` → `"Opus 4.6"`
  - `"claude-sonnet-4-5-20260101"` → `"Sonnet 4.5"`
  - `"claude-haiku-4-6-20260101"` → `"Haiku 4.6"`
  - All 9 versioned branches (opus-4-6, opus-4-5, sonnet-4-6, sonnet-4-5, haiku-4-6, haiku-4-5, opus-4, sonnet-4, haiku-4)
  - `"<synthetic>"` → `"synthetic"`
  - Unknown model returns model string unchanged
- `extractProjectName()`:
  - Conductor workspace path → `"workspace/project"` + workspaceName
  - Regular path → basename for both projectName and workspaceName
- `decodeProjectDir()`:
  - `"-home-user-repo"` → `"/home/user/repo"`
  - Lossy round-trip: since `/` and `.` both encode to `-`, decoding always produces `/` — test that `decodeProjectDir(encodeProjectDir("/path/.hidden"))` does NOT round-trip exactly (the `.` becomes `/`)
- `encodeProjectDir()`:
  - `"/home/user/repo"` → `"-home-user-repo"`
  - Dots are replaced: `"/path/.claude"` → `"-path--claude"`
- `parseJsonlEntries()`:
  - Valid JSONL → array of parsed objects
  - Malformed lines silently skipped
  - Empty string → empty array
  - Mixed valid/invalid lines → only valid entries returned

### Step 2: Pure Logic Extracted from Side-Effect Modules

**2a. `src/lib/notifications/__tests__/telegram.test.ts`** — Telegram utilities
- `maskToken()`: short tokens (<8 chars) fully masked, normal tokens show first 4 + last 4
- `escapeHtml()`: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;` (**Note: `"` is NOT escaped — only these three characters**)
- `markdownToTelegramHtml()`:
  - Bold (`**text**` → `<b>text</b>`)
  - Double-underscore bold (`__text__` → `<b>text</b>`)
  - Italic (`*text*` → `<i>text</i>`)
  - Strikethrough (`~~text~~` → `<s>text</s>`)
  - Code (`` `code` `` → `<code>code</code>`)
  - Code blocks (triple backtick → `<pre>`)
  - Links (`[text](url)` → `<a href="url">text</a>`)
  - Headers (`## Title` → `<b>Title</b>`)
  - Bullet lists (`- item` and `* item` → `• item`)
  - Newline collapsing (3+ consecutive newlines → 2)
  - Nested formatting
  - HTML entities in input (double-escape prevention — code blocks are extracted before escaping)

**2b. `src/lib/api/__tests__/utils.test.ts`** — API response helpers
- `jsonResponse()` returns Response with correct content-type and status
- `notFound()`, `conflict()`, `badRequest()` return correct status codes and messages
- `withErrorHandler()` catches thrown errors and returns 500

**2c. `src/lib/auth/__tests__/auth.test.ts`** — Authentication logic

**Env var management:** Save `process.env.DOBBY_PASSWORD` in `beforeEach` and restore in `afterEach` using the save/restore pattern from existing tests. Each test group sets/unsets the var as needed.

- **No-password mode (DOBBY_PASSWORD unset):**
  - `isAuthEnabled()` returns `false`
  - `verifyPassword("anything")` returns `true` (bypass)
  - `createSessionToken()` returns empty string `""`
  - `verifySessionToken("anything")` returns `true` (bypass)
- **Password mode (DOBBY_PASSWORD set):**
  - `isAuthEnabled()` returns `true`
  - `verifyPassword()` uses timing-safe comparison — correct password returns `true`, wrong returns `false`
  - `createSessionToken()` returns a non-empty token string
  - `verifySessionToken()` validates tokens created by `createSessionToken()`
  - `verifySessionToken()` rejects tampered/expired/garbage tokens
  - **Token expiration mechanism:** Tokens use `timestamp.signature` format where `timestamp` is `Math.floor(Date.now() / 1000)`. To test expiration, construct a token manually: compute a valid HMAC signature for a backdated timestamp (e.g., `Math.floor(Date.now() / 1000) - SESSION_MAX_AGE - 1`), then call `verifySessionToken()` on it — it should return `false`. No `Date.now()` mocking needed; just craft the token directly using `crypto.createHmac("sha256", password).update(oldTimestamp).digest("hex")`.

### Step 3: LLM Provider Tests (Mock SDK Client, Test Through `chat()`)

**Testing strategy for all providers:** Since conversion functions are private or inlined, tests must:
1. Mock the SDK constructor (e.g., `mock.module("@google/generative-ai", ...)`) to return a fake client
2. Capture the arguments passed to the actual API call method
3. Assert conversion correctness by inspecting the captured arguments
4. Return canned responses from the mock to test response parsing

**3a. `src/lib/ai/providers/__tests__/gemini.test.ts`** — Gemini provider

Mock `@google/generative-ai` with a three-level chain: `GoogleGenerativeAI` constructor → `.getGenerativeModel()` returns mock model → `.generateContent()` captures args and returns canned response. The mock structure:

```typescript
const mockGenerateContent = mock(() => ({ response: { /* canned */ } }));
const mockGetGenerativeModel = mock(() => ({ generateContent: mockGenerateContent }));
mock.module("@google/generative-ai", () => ({
  GoogleGenerativeAI: mock(function() { return { getGenerativeModel: mockGetGenerativeModel }; }),
  SchemaType: { OBJECT: "OBJECT" },
}));
```

- Message conversion (assert via captured `generateContent` args):
  - System messages → `systemInstruction` field (not in contents array)
  - User messages → `{role: "user", parts: [{text}]}`
  - Assistant with `_providerParts` → raw parts replayed verbatim
  - Assistant with toolCalls → reconstructed `functionCall` parts
  - Tool role → `{role: "function", parts: [{functionResponse}]}`
- Tool conversion (assert via captured `tools` arg):
  - `LLMToolDefinition` → Gemini `FunctionDeclaration` format
- Response parsing (return canned `generateContent` response):
  - Extract text from response candidates
  - Extract toolCalls with `call_{timestamp}_{i}` ID pattern
- Error handling: missing API key throws

**3b. `src/lib/ai/providers/__tests__/openai.test.ts`** — OpenAI provider

Mock `"openai"` module → capture args to `client.chat.completions.create()`. The mock structure:

```typescript
const mockCreate = mock(() => ({ choices: [{ message: { /* canned */ } }] }));
mock.module("openai", () => ({
  default: mock(function() { return { chat: { completions: { create: mockCreate } } }; }),
}));
```

- Message conversion (assert via captured `messages` arg):
  - Tool role → `{role: "tool", content, tool_call_id}`
  - Assistant with toolCalls → OpenAI `tool_calls` with `function` type
  - Standard role mapping (user, assistant, system)
- Tool conversion (assert via captured `tools` arg):
  - `LLMToolDefinition` → OpenAI `ChatCompletionTool` with `type: "function"`
- Response parsing (return canned completion response):
  - Extract text from `choices[0].message.content`
  - Extract function tool_calls (filter non-function types)
- Error handling: missing API key throws

**3c. `src/lib/ai/providers/__tests__/anthropic.test.ts`** — Anthropic provider

Mock `"@anthropic-ai/sdk"` → capture args to `client.messages.create()`. The mock structure:

```typescript
const mockCreate = mock(() => ({ content: [{ type: "text", text: "hi" }], usage: { /* canned */ } }));
mock.module("@anthropic-ai/sdk", () => ({
  default: mock(function() { return { messages: { create: mockCreate } }; }),
}));
```

- Message conversion (assert via captured `messages` arg):
  - System messages filtered out, passed via separate `system` parameter
  - Assistant toolCalls → `tool_use` content blocks
  - Tool role → user message with `tool_result` content block
- Tool conversion (assert via captured `tools` arg):
  - `LLMToolDefinition` → Anthropic `Tool` with `input_schema`
- Response parsing (return canned message response):
  - Extract text from `text` content blocks
  - Extract `tool_use` blocks with `block.id`
- Error handling: missing API key throws

**3d. `src/lib/ai/__tests__/router.test.ts`** — LLM router

Mock `@/lib/db` with Drizzle **relational query API** (NOT the builder chain). The actual code uses `db.query.llmConfigs.findFirst()`, so the mock must match:

```typescript
const mockFindFirst = mock(() => null);
mock.module("@/lib/db", () => ({
  db: { query: { llmConfigs: { findFirst: mockFindFirst } } },
  llmConfigs: { taskType: "taskType", isDefault: "isDefault" },
}));
```

Note: `resolveConfig()` calls `findFirst()` **twice** when no task-specific config is found (once for task type, once for `isDefault: true` fallback). The mock must return different values per call to test the fallback chain. Use `mockFindFirst.mockImplementationOnce()` to control per-call returns.

- `resolveConfig()`:
  - **Mock returns task-specific config on first call:** task-specific config from DB takes priority
  - **Mock returns null on first call, default config on second call:** falls back to `isDefault: true` config
  - **Mock returns null on both calls:** falls back to hardcoded default (gemini-3-flash-preview)
- `getLLMProvider()`:
  - Instantiates correct provider class based on config
  - Caches providers by `{provider}:{model}` key (assert reference equality on second call)
  - Returns same instance for same key
- **Module-level state isolation:** The `providerCache` Map persists across tests. Either re-import the module via `await import()` after `mock.module()` in each test, or accept that cache tests must run in a specific order. Prefer re-import for isolation.

### Step 4: Agent Core Tests (Heavier Mocking)

**4a. `src/lib/agent/__tests__/builtin-tools.test.ts`** — Built-in tools
- `BUILTIN_TOOLS` has exactly 5 entries with correct names
- `BUILTIN_TOOL_NAMES` matches BUILTIN_TOOLS
- `executeBuiltinTool("get_current_time")` — returns parseable date string
- `executeBuiltinTool("get_current_time", {timezone: "UTC"})` — respects timezone
- `executeBuiltinTool("list_directory", {path: testDir})` — lists files with sizes
- `executeBuiltinTool("read_file", {path: testFile})` — reads content
- `executeBuiltinTool("read_file", {path: testFile, maxBytes: 10})` — truncates
- `executeBuiltinTool("write_file", {path, content})` — creates file, creates parent dirs
- `executeBuiltinTool("get_file_info", {path})` — returns size, timestamps, permissions
- Error cases: nonexistent file, nonexistent directory, unknown tool name
- **Use real temp directories** (pattern from `agent-memory.test.ts`), not mocked fs

**4b. `src/lib/agent/__tests__/conversation-store.test.ts`** — Conversation store

**Important:** `dbMessageToLLM()` is a **private function** — it is not exported. Tests must exercise it indirectly through the exported `getConversation()` function, which requires mocking the DB.

Mock `@/lib/db` with Drizzle **relational query API** (NOT builder chain). The mock must provide **both** `db.query.conversations.findFirst` and `db.query.messages.findMany`, since `getConversation()` calls both in sequence. If only `messages.findMany` is mocked, the function returns `null` at line 28 before reaching the message conversion logic.

```typescript
const mockFindFirst = mock(() => ({ id: "conv-1", title: "Test" }));
const mockFindMany = mock(() => [/* canned message rows */]);
mock.module("@/lib/db", () => ({
  db: { query: { conversations: { findFirst: mockFindFirst }, messages: { findMany: mockFindMany } } },
  conversations: { id: "id" },
  messages: { conversationId: "conversationId", createdAt: "createdAt" },
}));
```

**Read path** (`getConversation()` → `dbMessageToLLM()`):
- Conversation not found → returns `null`
- User message DB row → `{role: "user", content}` in returned messages
- Assistant message DB row → `{role: "assistant", content}` in returned messages
- Assistant DB row with JSON `toolCalls` column → parsed into `LLMToolCall[]` on the returned message (verify `id`, `type: "function"`, `function.name`, `function.arguments`)
- Tool result DB row → `{role: "tool", content, toolCallId}` in returned messages
- DB row with `provider_data` JSON column → `_providerParts` populated on returned message

**Write path** (`addMessage()` serialization):
Mock `@/lib/db` with builder API for `db.insert().values()` and `db.update().set().where()`. Capture the arguments passed to `values()` and verify:
- `LLMMessage.toolCalls` → serialized as `ToolCallData[]` with `{id, name, arguments}` (note: `function.name` → `name`, `function.arguments` → `arguments`)
- `LLMMessage._providerParts` → stored as `providerData`
- `toolCallId` → stored with `|| null` fallback
- `modelUsed` → stored with `|| null` fallback

### Step 5: Runner Integration Tests

**5a. `src/lib/runner/__tests__/telegram-sender.test.ts`** — Telegram sender

Mock both `@/lib/db` (for config lookup) and `@/lib/notifications/telegram` (for send function):

- Message formatting: includes model, tokens, duration
- Output truncation to `TELEGRAM_SAFE_MSG_LEN`
- Error message formatting
- **Config resolution — two DB lookup paths (NO env var fallback):**
  `getAgentTelegramConfig()` queries the DB twice using the **builder API** (`db.select().from(notificationConfigs).where(and(...)).limit(1)`):
  1. **agentId path:** Queries with channel key `telegram-agent:{agentId}` — when found with valid `bot_token` and `chat_id` in config JSON, returns `{botToken, chatId}`
  2. **agentName fallback:** When agentId query returns no results (or agentId is undefined), queries with channel key `telegram-agent:{agentName}` — returns config if found
  3. **Neither found:** Returns `null`
  - Test all three cases. The mock must support the `select → from → where → limit` chain and return different `[{ config: { bot_token, chat_id }, enabled: true }]` arrays per call.
  - **There is NO env var fallback in this function.** The env var fallback (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`) exists in a different file (`notifications/telegram.ts` → `getTelegramConfig()`) for global config, not per-agent config.

**5b. `src/lib/runner/__tests__/run-log.test.ts`** — Run logging (P3, minimal value)

Mock `@/lib/db` and capture arguments passed to `db.insert().values().returning()`. **Important:** `logRun()` chains `.returning()` after `.values()` and destructures the first element (`const [run] = await ...`). The mock must return `[{ id: "run-id" }]` from `.returning()`, otherwise the destructuring fails and the conditional `agentRunToolUses` insert is skipped.

```typescript
const mockReturning = mock(() => [{ id: "run-id" }]);
const mockValues = mock(() => ({ returning: mockReturning }));
const mockInsert = mock(() => ({ values: mockValues }));
mock.module("@/lib/db", () => ({
  db: { insert: mockInsert },
  agentRuns: {},
  agentRunToolUses: {},
}));
```

- Correct field mapping from `RunResult` to `agentRuns` insert (agentName, status, output, model, tokens, etc.)
- `|| null` coercion: undefined optional fields become null
- Conditional tool use insert: when `result.toolUses.length > 0`, inserts into `agentRunToolUses` with `runId` from the `.returning()` result
- Empty `toolUses` array: no `agentRunToolUses` insert call
- **Note:** This file contains NO truncation logic — truncation happens in `agent-runner.ts`. Do not write truncation tests here.

### Step 6: MCP Client Tests

**6a. `src/lib/mcp/__tests__/client.test.ts`** — MCP client manager

Mock `@modelcontextprotocol/sdk/client/index.js` and `@modelcontextprotocol/sdk/client/stdio.js` to avoid spawning real subprocesses. The mock must provide:

```typescript
const mockConnect = mock(() => {});
const mockClose = mock(() => {});
const mockListTools = mock(() => ({ tools: [{ name: "tool1", description: "desc", inputSchema: {} }] }));
const mockCallTool = mock(() => ({ content: [{ type: "text", text: "result" }] }));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: mock(function() {
    return { connect: mockConnect, close: mockClose, listTools: mockListTools, callTool: mockCallTool };
  }),
}));
mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: mock(function() { return {}; }),
}));
```

- `getConnectedServers()` returns empty initially
- `isConnected()` returns false for unknown servers
- `connect()` creates transport and client, calls `client.connect(transport, { timeout: 120_000 })`
- After `connect()`, `getConnectedServers()` includes the server name and `isConnected()` returns true
- `listTools()` calls `client.listTools()` and maps results to `MCPToolDefinition` format
- Tool cache: second call to `listTools()` does NOT call `client.listTools()` again (cache hit)
- `callTool()` dispatches to the correct server based on cached tool list
- `disconnect()` calls `client.close()` and **removes the entire server entry** (both connection and cached tools are gone — there is no separate "cache invalidation")
- `disconnectAll()` clears all servers
- `callTool()` for unknown tool returns error result with `isError: true`

---

## New Files to Create

```
src/lib/validations/__tests__/agent.test.ts          # Step 1a
src/lib/validations/__tests__/project.test.ts        # Step 1b
src/lib/validations/__tests__/issue.test.ts          # Step 1c
src/lib/validations/__tests__/repository.test.ts     # Step 1d
src/lib/utils/__tests__/format.test.ts               # Step 1e
src/lib/agent/__tests__/system-prompt.test.ts        # Step 1f
src/lib/runner/__tests__/run-events.test.ts          # Step 1g
src/lib/claude/__tests__/utils.test.ts               # Step 1h
src/lib/notifications/__tests__/telegram.test.ts     # Step 2a
src/lib/api/__tests__/utils.test.ts                  # Step 2b
src/lib/auth/__tests__/auth.test.ts                  # Step 2c
src/lib/ai/providers/__tests__/gemini.test.ts        # Step 3a
src/lib/ai/providers/__tests__/openai.test.ts        # Step 3b
src/lib/ai/providers/__tests__/anthropic.test.ts     # Step 3c
src/lib/ai/__tests__/router.test.ts                  # Step 3d
src/lib/agent/__tests__/builtin-tools.test.ts        # Step 4a
src/lib/agent/__tests__/conversation-store.test.ts   # Step 4b
src/lib/runner/__tests__/telegram-sender.test.ts     # Step 5a
src/lib/runner/__tests__/run-log.test.ts             # Step 5b
src/lib/mcp/__tests__/client.test.ts                 # Step 6a
```

**Total: 20 new test files**

## New Dependencies Needed

**None.** Bun's built-in test runner provides everything needed: `describe`, `test`, `expect`, `mock`, `beforeEach`, `afterEach`. The existing codebase patterns are sufficient.

## Testing Strategy

### What These Tests Catch

1. **Validation regressions** — Schema changes that accidentally accept invalid input or reject valid input (e.g., changing the agent name regex, removing cron validation)
2. **LLM provider contract breakage** — Changes to message/tool conversion that break API compatibility (e.g., Gemini thought signature handling, Anthropic tool_use block format)
3. **Data conversion bugs** — `dbMessageToLLM()` breaking when tool call JSON format changes, `_providerParts` not being preserved; `addMessage()` serialization corrupting stored data
4. **Security regressions** — Env var deny-list bypassed, token masking broken, auth token validation weakened, no-password bypass paths accidentally removed or extended
5. **Formatting breakage** — Telegram HTML output (including strikethrough, bullet lists, newline collapsing), cron human-readable display, duration formatting
6. **Event system correctness** — Run events not replaying, subscriptions leaking, concurrent run isolation, generation guard preventing stale timer cleanup
7. **Pure utility correctness** — Model name shortening (11 branches), path encoding/decoding lossy round-trip, JSONL parsing resilience

### Execution Order

Steps 1-2 can all be implemented in parallel (pure functions, no interdependencies). Steps 3-6 should be done sequentially as they build on mocking patterns established earlier. Within Step 3, provider tests (3a-3c) are independent and can be parallelized; 3d (router) depends on understanding the mock patterns from 3a-3c.

### Running Tests

```bash
bun test                              # Run all tests
bun test src/lib/validations          # Run validation tests only
bun test --watch                      # Watch mode during development
```

### Key Implementation Notes

1. **Always read the source file before writing its test** — export names, function signatures, and behavior may differ from this plan's descriptions. Trust the source code over this plan.
2. **For provider tests (Steps 3a-3c):** Mock the SDK module constructor (`@google/generative-ai`, `openai`, `@anthropic-ai/sdk`) using `mock.module()`. Create a fake client that captures arguments passed to the API call method (`generateContent`, `chat.completions.create`, `messages.create`) and returns canned responses. **For Gemini specifically:** the mock chain is three levels deep — `GoogleGenerativeAI` constructor → `.getGenerativeModel({model})` returns mock model → `.generateContent(args)` captures args. Assert conversion correctness by inspecting captured arguments. Import the provider class AFTER `mock.module()`.
3. **Two Drizzle mock patterns — use the one matching the source code:**
   - **Builder API** (Steps 5a, 5b): `db.select().from().where().limit()` for reads, `db.insert().values().returning()` for writes. Used by `telegram-sender.ts` and `run-log.ts`.
   - **Relational query API** (Steps 3d, 4b read path): `db.query.tableName.findFirst()` and `db.query.tableName.findMany()`. Used by `router.ts` and `conversation-store.ts`. Mock structure: `db: { query: { tableName: { findFirst: mockFn } } }`.
   - **Step 4b uses both patterns:** relational API for the read path (`getConversation`), builder API for the write path (`addMessage`).
4. **For filesystem tool tests (Step 4a):** Use real temp directories (pattern from `agent-memory.test.ts`), not mocked fs.
5. **Import order matters:** `mock.module()` must be called before `await import()` of the module under test.
6. **Module-level state isolation (Steps 1g, 3d):** For `run-events.ts`, call `endRun()` for all active runs in `afterEach` to prevent state leakage. For `router.ts`, re-import via dynamic `await import()` after each `mock.module()` call. The `run-events.ts` `nextGeneration` counter is not resettable — tests should not depend on absolute generation values, only on relative behavior (new generation != old generation).
7. **Env var management (Step 2c):** Save and restore `process.env.DOBBY_PASSWORD` around auth tests using the pattern from existing test files. Never rely on env vars being set or unset from a previous test.
8. **Timer handling (Step 1g):** The 5-second `setTimeout` in `endRun()` is a deferred cleanup. Assert state immediately after `endRun()` (before the timer fires) to verify the grace window. To test that the timer eventually cleans up, either use `Bun.sleep(5100)` in a dedicated slow test or verify the generation-guard logic by checking that a re-started run is not affected.
