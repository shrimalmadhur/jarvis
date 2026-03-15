# Plan: Project → Agents Hierarchy

## Summary

Move from filesystem-based agents (`agents/` directory) to a DB-backed **Project → Agents** hierarchy. Projects and agents are created/managed entirely from the UI.

## Review Summary

**Adversarial Review**: Passed (round 2) — 15 issues found and addressed. Key fixes: Telegram channel key migration, agentRuns data integrity, unique constraints, dedup strategy, type safety.
**Completeness Review**: Passed (round 2) — 15 gaps found and addressed. Key additions: RunResult type update, request validation, edit UX, redirect mechanism, shared cronToHuman utility.
**Revision rounds**: 1
**Unresolved notes**: No automated tests (project has no test infrastructure). Manual verification plan provided.

---

## Phase 1: Database Schema

### Task 1.1: Add `projects` table

**File**: `src/lib/db/schema.ts`

Add after the `notificationConfigs` table (line 94):

```typescript
// ── Projects ──────────────────────────────────────────────────
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),  // unique constraint
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});
```

### Task 1.2: Add `agents` table

**File**: `src/lib/db/schema.ts`

Add after the `projects` table. Flatten LLM config (no nested object) — mapping to/from `AgentConfig.llm` happens in the loader.

```typescript
// ── Agents (DB-managed) ───────────────────────────────────────
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  soul: text("soul").notNull(),           // system prompt (was soul.md)
  skill: text("skill").notNull(),         // task instructions (was skill.md)
  schedule: text("schedule").notNull(),   // cron expression
  timezone: text("timezone"),
  provider: text("provider").default("gemini"),
  model: text("model").default("gemini-3-flash-preview"),
  temperature: real("temperature").default(0.7),
  maxTokens: integer("max_tokens"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});
```

**Note**: Drizzle ORM with SQLite does not natively support composite unique constraints via the schema builder. Add a unique index via SQL after push, or enforce uniqueness in the API layer (check before insert: `SELECT 1 FROM agents WHERE project_id = ? AND name = ?`).

### Task 1.3: Add `agentId` column to `agentRuns`

**File**: `src/lib/db/schema.ts`

Add an optional `agentId` column. This is an additive `ALTER TABLE ADD COLUMN` — existing data is unaffected.

```typescript
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentName: text("agent_name").notNull(),  // ALWAYS set to human-readable name
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  // ... rest unchanged
});
```

**Invariant**: `agentRuns.agentName` is ALWAYS populated with the human-readable agent name for ALL runs (both filesystem and DB). The `agentId` is supplementary, used for precise FK lookups on DB agents.

### Task 1.4: Push schema

```bash
bun run drizzle-kit push
```

**Verify**: `bun run tsc --noEmit`

---

## Phase 2: Shared Utilities

### Task 2.1: Extract `cronToHuman()` to shared utility

**New file**: `src/lib/utils/cron.ts`

Move `cronToHuman()` from `src/app/api/cron-agents/route.ts` into this shared file so it can be used both server-side (API routes) and client-side (create/edit forms).

```typescript
export function cronToHuman(cron: string): string {
  // ... existing implementation from api/cron-agents/route.ts
}
```

Update `src/app/api/cron-agents/route.ts` to import from `@/lib/utils/cron`.

### Task 2.2: Add Zod validation schemas

**New file**: `src/lib/validations/project.ts`

```typescript
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();
```

**New file**: `src/lib/validations/agent.ts`

```typescript
import { z } from "zod";

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  soul: z.string().min(1),
  skill: z.string().min(1),
  schedule: z.string().min(1),  // cron expression, validated with regex
  timezone: z.string().optional(),
  provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();
```

Add cron validation: use a regex or `cron-parser` package to validate the schedule field.

---

## Phase 3: API Routes — Projects CRUD

### Task 3.1: GET/POST `/api/projects`

**New file**: `src/app/api/projects/route.ts`

- **GET**: List all projects. For each project, include agent count (subquery or join on `agents` table, count grouped by projectId).
- **POST**: Create a new project. Validate body with `createProjectSchema`. Check name uniqueness.

### Task 3.2: GET/PATCH/DELETE `/api/projects/[id]`

**New file**: `src/app/api/projects/[id]/route.ts`

- **GET**: Single project with its agents list (join agents table).
- **PATCH**: Update project name/description. Validate body with `updateProjectSchema`. **Must explicitly set `updatedAt: new Date()`** in the `.set()` call (Drizzle `$defaultFn` only fires on INSERT).
- **DELETE**: Delete project. Warn: cascades to agents. Run history is preserved but `agentId` set to null.

---

## Phase 4: API Routes — Agents CRUD

Use flatter routes (`/api/agents/...`) since `agentId` is globally unique (UUID). The `projectId` is validated by checking the agent's FK.

### Task 4.1: GET/POST `/api/projects/[id]/agents`

**New file**: `src/app/api/projects/[id]/agents/route.ts`

- **GET**: List agents for this project. Include last run status (left join on `agentRuns` where `agentId` matches or `agentName` matches, ordered by `createdAt` desc, limit 1 per agent). Include `cronToHuman(schedule)`.
- **POST**: Create agent. Validate body with `createAgentSchema`. **Check uniqueness of `(projectId, name)`** before insert.

### Task 4.2: GET/PATCH/DELETE `/api/agents/[agentId]`

**New file**: `src/app/api/agents/[agentId]/route.ts`

- **GET**: Agent detail (all fields).
- **PATCH**: Update any agent fields. Validate with `updateAgentSchema`. **Set `updatedAt: new Date()`**. If `name` is changed, also update all `agentRuns.agentName` rows for this agent to maintain linkage.
- **DELETE**: Delete agent. Run history preserved (agentId set to null).

### Task 4.3: GET `/api/agents/[agentId]/runs`

**New file**: `src/app/api/agents/[agentId]/runs/route.ts`

- Paginated run history. Query by `agentId` (preferred) with fallback to `agentName`.

### Task 4.4: Telegram routes for DB agents

**New files**:
- `src/app/api/agents/[agentId]/telegram/route.ts` (GET/POST/DELETE)
- `src/app/api/agents/[agentId]/telegram/setup/route.ts` (POST)
- `src/app/api/agents/[agentId]/telegram/test/route.ts` (POST)

Mirror existing `/api/cron-agents/[name]/telegram/*` routes. Use `telegram-agent:{agentId}` as the `notificationConfigs.channel` key for DB-backed agents.

---

## Phase 5: Update Agent Runner

### Task 5.1: Update `RunResult` type

**File**: `src/lib/runner/types.ts`

Add optional `agentId` field:

```typescript
export interface RunResult {
  agentName: string;
  agentId?: string;    // NEW: set for DB-backed agents
  // ... rest unchanged
}
```

Also update `AgentDefinition` to make `directory` optional:

```typescript
export interface AgentDefinition {
  config: AgentConfig;
  soul: string;
  skill: string;
  directory?: string;   // Was required. Optional for DB-backed agents.
  agentId?: string;      // NEW: DB agent id
}
```

### Task 5.2: Add DB-based agent loader

**New file**: `src/lib/runner/db-config-loader.ts`

Separate file to keep `config-loader.ts` (filesystem) clean and avoid adding DB imports to it.

```typescript
import { db } from "@/lib/db";
import { agents, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { AgentDefinition } from "./types";

export async function loadAgentDefinitionsFromDB(
  options?: { includeDisabled?: boolean; projectId?: string; projectName?: string }
): Promise<AgentDefinition[]> {
  // Build query (optionally filter by projectId or projectName via join)
  // Map each row to AgentDefinition:
  //   config: { name, enabled, schedule, timezone, llm: { provider, model, temperature }, maxTokens }
  //   soul: row.soul
  //   skill: row.skill
  //   directory: undefined (not filesystem-based)
  //   agentId: row.id
}
```

### Task 5.3: Update `scripts/run-agents.ts`

**File**: `scripts/run-agents.ts`

- Import `loadAgentDefinitionsFromDB` from new file
- Load from both FS and DB
- **Dedup strategy**: DB agents take precedence. Skip any filesystem agent whose name matches a DB agent name.
- Support `--project <name>` flag: resolve project name → ID, then filter DB agents
- When calling `runAgentTask()`, the returned `RunResult` carries `agentId` for DB agents
- Pass `agentId` through to `logRun()` and telegram lookup

### Task 5.4: Update `agent-runner.ts`

**File**: `src/lib/runner/agent-runner.ts`

- Propagate `agentId` from `AgentDefinition` to `RunResult`:
  ```typescript
  return {
    agentName: definition.config.name,
    agentId: definition.agentId,  // NEW
    // ...
  };
  ```

### Task 5.5: Update `run-log.ts`

**File**: `src/lib/runner/run-log.ts`

- Update `logRun()` to include `agentId` from `RunResult`:
  ```typescript
  await db.insert(agentRuns).values({
    agentName: result.agentName,
    agentId: result.agentId || null,  // NEW
    // ...
  });
  ```
- Update `getRecentOutputs()` to accept optional `agentId`:
  ```typescript
  export async function getRecentOutputs(
    agentName: string,
    days?: number,
    agentId?: string
  ): Promise<string[]> {
    // If agentId provided, query by agentId. Otherwise query by agentName.
  }
  ```

### Task 5.6: Update `telegram-sender.ts`

**File**: `src/lib/runner/telegram-sender.ts`

- Update `getAgentTelegramConfig()` to accept optional `agentId`:
  ```typescript
  export async function getAgentTelegramConfig(
    agentName: string,
    agentId?: string
  ): Promise<{ botToken: string; chatId: string } | null> {
    // If agentId provided, try telegram-agent:{agentId} first
    // Fall back to telegram-agent:{agentName}
  }
  ```

---

## Phase 6: UI — Projects & Agents

### Task 6.1: Projects list page

**New file**: `src/app/(app)/projects/page.tsx`

- Fetch GET `/api/projects` → display cards (name, description, agent count, created date)
- "Create Project" button → inline form at top (name + description fields, save/cancel buttons)
- Each card links to `/projects/[id]`
- Empty state: "No projects yet. Create one to get started."
- Style: match existing agents page aesthetic (same card style, grid layout)

### Task 6.2: Project detail page

**New file**: `src/app/(app)/projects/[id]/page.tsx`

- Header: project name, description, edit inline (pencil icon → editable fields), delete button (with confirmation dialog)
- "Create Agent" button → links to `/projects/[id]/agents/new`
- Agent cards grid (adapt `AgentCard` from existing agents page — add project context)
- Each agent card links to `/projects/[id]/agents/[agentId]`

### Task 6.3: Agent form component (reusable for create + edit)

**New file**: `src/components/agents/agent-form.tsx`

Reusable form component with fields:
- Name (text input)
- Soul / System Prompt (textarea)
- Skill / Task Instructions (textarea)
- Schedule (cron expression input + `cronToHuman()` preview below)
- Timezone (text input or select)
- LLM Provider (select: gemini/openai/anthropic)
- Model (text input)
- Temperature (number input, 0-2, step 0.1)
- Max Tokens (number input, optional)
- Enabled (toggle)

Props: `initialValues?: Partial<AgentFormData>`, `onSubmit: (data: AgentFormData) => Promise<void>`, `submitLabel: string`

Import `cronToHuman` from `@/lib/utils/cron` for client-side preview.

### Task 6.4: Create agent page

**New file**: `src/app/(app)/projects/[id]/agents/new/page.tsx`

- Uses `AgentForm` with no initial values
- On submit: POST to `/api/projects/[id]/agents`, redirect to agent detail on success

### Task 6.5: Agent detail page (within project)

**New file**: `src/app/(app)/projects/[id]/agents/[agentId]/page.tsx`

- Back link → `/projects/[id]`
- Header with agent name, enabled badge
- "Edit" button → toggles form mode using `AgentForm` with current values pre-filled. On submit: PATCH to `/api/agents/[agentId]`.
- "Delete" button with confirmation
- Meta info: schedule (human-readable), timezone, model, provider
- Collapsible sections for Soul and Skill (read-only view, editable in edit mode)
- Telegram section (reuse `TelegramSection` from existing agent detail, update API URLs)
- Run history (paginated, from `/api/agents/[agentId]/runs`)

### Task 6.6: Update navigation

**File**: `src/components/layout/top-nav.tsx`

Replace the "Agents" nav item:
```typescript
import { FolderKanban } from "lucide-react";  // ADD to imports

// In navItems array:
{ href: "/projects", label: "Projects", icon: FolderKanban },
```

Update `isActive` to match `/projects` prefix.

### Task 6.7: Redirect old agents route

**File**: `src/app/(app)/agents/page.tsx`

Convert to a server component that redirects:
```typescript
import { redirect } from "next/navigation";
export default function AgentsPage() {
  redirect("/projects");
}
```

Remove the "use client" directive and all existing client code.

---

## Phase 7: Migration & Cleanup

### Task 7.1: Migration script for filesystem agents

**New file**: `scripts/migrate-fs-agents.ts`

1. Load all filesystem agent definitions via `loadAgentDefinitions(undefined, { includeDisabled: true, resolveEnv: false })`
2. Create a "Default" project if none exists
3. For each agent definition:
   a. Insert into `agents` table under "Default" project
   b. If a `notificationConfigs` row exists with channel `telegram-agent:{agentName}`, update its channel to `telegram-agent:{newAgentId}`
4. Print summary of migrated agents
5. Recommend: after verifying DB agents work, disable or remove filesystem agent folders

Run: `bun run scripts/migrate-fs-agents.ts`

### Task 7.2: Update CLAUDE.md

**File**: `CLAUDE.md`

- Add `projects` and `agents` tables to Database section
- Add new API routes to Architecture/Project Structure
- Update agent runner section to mention DB-backed agents
- Note: filesystem agents are deprecated in favor of DB-backed agents

---

## File Change Summary

| Action | Path |
|--------|------|
| Edit | `src/lib/db/schema.ts` |
| New | `src/lib/utils/cron.ts` |
| New | `src/lib/validations/project.ts` |
| New | `src/lib/validations/agent.ts` |
| New | `src/app/api/projects/route.ts` |
| New | `src/app/api/projects/[id]/route.ts` |
| New | `src/app/api/projects/[id]/agents/route.ts` |
| New | `src/app/api/agents/[agentId]/route.ts` |
| New | `src/app/api/agents/[agentId]/runs/route.ts` |
| New | `src/app/api/agents/[agentId]/telegram/route.ts` |
| New | `src/app/api/agents/[agentId]/telegram/setup/route.ts` |
| New | `src/app/api/agents/[agentId]/telegram/test/route.ts` |
| Edit | `src/lib/runner/types.ts` |
| New | `src/lib/runner/db-config-loader.ts` |
| Edit | `src/lib/runner/agent-runner.ts` |
| Edit | `src/lib/runner/run-log.ts` |
| Edit | `src/lib/runner/telegram-sender.ts` |
| Edit | `scripts/run-agents.ts` |
| New | `src/components/agents/agent-form.tsx` |
| New | `src/app/(app)/projects/page.tsx` |
| New | `src/app/(app)/projects/[id]/page.tsx` |
| New | `src/app/(app)/projects/[id]/agents/new/page.tsx` |
| New | `src/app/(app)/projects/[id]/agents/[agentId]/page.tsx` |
| Edit | `src/components/layout/top-nav.tsx` |
| Edit | `src/app/(app)/agents/page.tsx` (redirect) |
| Edit | `src/app/api/cron-agents/route.ts` (import update) |
| New | `scripts/migrate-fs-agents.ts` |
| Edit | `CLAUDE.md` |

## Verification

After each phase:
```bash
bun run tsc --noEmit   # Type check
bun run dev            # Smoke test UI
```

Final end-to-end:
1. Create a project via UI → verify it appears in project list
2. Create an agent within that project via UI → verify form validation works
3. Edit the agent → verify PATCH updates correctly, `updatedAt` changes
4. Run `bun run run-agents` → verify DB agents are picked up, FS agents deduped
5. Check run history appears in agent detail page
6. Set up Telegram for a DB agent → verify notifications work
7. Run migration script → verify FS agents migrated, Telegram configs transferred
8. Delete project → verify cascade deletes agents, run history preserved with null agentId
