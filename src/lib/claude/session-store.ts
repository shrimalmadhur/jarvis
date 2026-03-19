import { db } from "@/lib/db";
import {
  claudeSessions,
  claudeSessionTimeline,
  claudeSessionSubAgents,
  claudeSessionTasks,
} from "@/lib/db/schema";
import { eq, and, desc, isNull, lt } from "drizzle-orm";
import { getSetting } from "@/lib/db/app-settings";
import type {
  AgentSession,
  SessionDetailResponse,
  TimelineEntry,
  SubAgentInfo,
  TaskInfo,
} from "./types";

// ── Persist session list data ────────────────────────────────

export function persistSessions(sessions: AgentSession[]) {
  for (const s of sessions) {
    const existing = db
      .select({ sessionId: claudeSessions.sessionId })
      .from(claudeSessions)
      .where(eq(claudeSessions.sessionId, s.sessionId))
      .get();

    const data = {
      projectPath: s.projectPath,
      projectName: s.projectName,
      projectDir: s.projectDir,
      workspaceName: s.workspaceName,
      slug: s.slug,
      model: s.model,
      gitBranch: s.gitBranch,
      status: s.status,
      lastActivity: s.lastActivity,
      lastAction: s.lastAction,
      lastToolName: s.lastToolName,
      inputTokens: s.tokenUsage.inputTokens,
      outputTokens: s.tokenUsage.outputTokens,
      cacheReadTokens: s.tokenUsage.cacheReadTokens,
      cacheCreationTokens: s.tokenUsage.cacheCreationTokens,
      messageCount: s.messageCount,
      isSubagent: s.isSubagent,
      updatedAt: new Date(),
    };

    if (existing) {
      db.update(claudeSessions)
        .set(data)
        .where(eq(claudeSessions.sessionId, s.sessionId))
        .run();
    } else {
      db.insert(claudeSessions)
        .values({ sessionId: s.sessionId, ...data })
        .run();
    }
  }
}

// ── Persist session detail data ──────────────────────────────

export function persistSessionDetail(
  detail: SessionDetailResponse,
  projectDir: string,
  subagentId?: string | null
) {
  const { session, timeline, subAgents, tasks } = detail;

  // Upsert session metadata
  const existing = db
    .select({ sessionId: claudeSessions.sessionId })
    .from(claudeSessions)
    .where(eq(claudeSessions.sessionId, session.sessionId))
    .get();

  const sessionData = {
    projectPath: session.projectPath,
    projectName: session.projectName,
    projectDir: projectDir,
    workspaceName: "",
    slug: session.slug,
    model: session.model,
    gitBranch: session.gitBranch,
    status: session.status,
    lastActivity: session.lastActivity,
    created: session.created,
    inputTokens: session.totalTokens.inputTokens,
    outputTokens: session.totalTokens.outputTokens,
    cacheReadTokens: session.totalTokens.cacheReadTokens,
    cacheCreationTokens: session.totalTokens.cacheCreationTokens,
    updatedAt: new Date(),
  };

  if (existing) {
    db.update(claudeSessions)
      .set(sessionData)
      .where(eq(claudeSessions.sessionId, session.sessionId))
      .run();
  } else {
    db.insert(claudeSessions)
      .values({ sessionId: session.sessionId, messageCount: 0, ...sessionData })
      .run();
  }

  // Replace timeline entries for this session+subagent combo
  if (subagentId) {
    db.delete(claudeSessionTimeline)
      .where(
        and(
          eq(claudeSessionTimeline.sessionId, session.sessionId),
          eq(claudeSessionTimeline.projectDir, projectDir),
          eq(claudeSessionTimeline.subagentId, subagentId)
        )
      )
      .run();
  } else {
    db.delete(claudeSessionTimeline)
      .where(
        and(
          eq(claudeSessionTimeline.sessionId, session.sessionId),
          eq(claudeSessionTimeline.projectDir, projectDir),
          isNull(claudeSessionTimeline.subagentId)
        )
      )
      .run();
  }

  if (timeline.length > 0) {
    db.insert(claudeSessionTimeline)
      .values(
        timeline.map((t) => ({
          sessionId: session.sessionId,
          projectDir,
          subagentId: subagentId || null,
          timestamp: t.timestamp,
          kind: t.kind,
          text: t.text,
          toolName: t.toolName || null,
          isError: t.isError || false,
          agentId: t.agentId || null,
          inputTokens: t.tokenUsage?.inputTokens || null,
          outputTokens: t.tokenUsage?.outputTokens || null,
          cacheReadTokens: t.tokenUsage?.cacheReadTokens || null,
          cacheCreationTokens: t.tokenUsage?.cacheCreationTokens || null,
        }))
      )
      .run();
  }

  // Replace sub-agents (only for parent sessions)
  if (!subagentId && subAgents.length > 0) {
    db.delete(claudeSessionSubAgents)
      .where(
        and(
          eq(claudeSessionSubAgents.sessionId, session.sessionId),
          eq(claudeSessionSubAgents.projectDir, projectDir)
        )
      )
      .run();

    db.insert(claudeSessionSubAgents)
      .values(
        subAgents.map((a) => ({
          sessionId: session.sessionId,
          projectDir,
          agentId: a.agentId,
          prompt: a.prompt,
          model: a.model,
          messageCount: a.messageCount,
          inputTokens: a.tokenUsage.inputTokens,
          outputTokens: a.tokenUsage.outputTokens,
          cacheReadTokens: a.tokenUsage.cacheReadTokens,
          cacheCreationTokens: a.tokenUsage.cacheCreationTokens,
        }))
      )
      .run();
  }

  // Replace tasks (only for parent sessions)
  if (!subagentId && tasks.length > 0) {
    db.delete(claudeSessionTasks)
      .where(
        and(
          eq(claudeSessionTasks.sessionId, session.sessionId),
          eq(claudeSessionTasks.projectDir, projectDir)
        )
      )
      .run();

    db.insert(claudeSessionTasks)
      .values(
        tasks.map((t) => ({
          sessionId: session.sessionId,
          projectDir,
          taskId: t.id,
          subject: t.subject,
          status: t.status,
          activeForm: t.activeForm || null,
        }))
      )
      .run();
  }
}

// ── Load historical sessions from DB ─────────────────────────

export function loadHistoricalSessions(): AgentSession[] {
  const rows = db
    .select()
    .from(claudeSessions)
    .orderBy(desc(claudeSessions.lastActivity))
    .all();

  return rows.map((r) => ({
    sessionId: r.sessionId,
    projectPath: r.projectPath,
    projectName: r.projectName,
    projectDir: r.projectDir,
    workspaceName: r.workspaceName,
    slug: r.slug,
    model: r.model,
    gitBranch: r.gitBranch,
    status: "completed" as const,
    lastActivity: r.lastActivity,
    lastAction: r.lastAction,
    lastToolName: r.lastToolName,
    tokenUsage: {
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreationTokens: r.cacheCreationTokens,
    },
    messageCount: r.messageCount,
    isSubagent: r.isSubagent,
  }));
}

// ── Load session detail from DB ──────────────────────────────

export function loadSessionDetailFromDB(
  sessionId: string,
  projectDir: string,
  subagentId?: string | null
): SessionDetailResponse | null {
  const session = db
    .select()
    .from(claudeSessions)
    .where(eq(claudeSessions.sessionId, sessionId))
    .get();

  if (!session) return null;

  const timelineRows = subagentId
    ? db
        .select()
        .from(claudeSessionTimeline)
        .where(
          and(
            eq(claudeSessionTimeline.sessionId, sessionId),
            eq(claudeSessionTimeline.projectDir, projectDir),
            eq(claudeSessionTimeline.subagentId, subagentId)
          )
        )
        .all()
    : db
        .select()
        .from(claudeSessionTimeline)
        .where(
          and(
            eq(claudeSessionTimeline.sessionId, sessionId),
            eq(claudeSessionTimeline.projectDir, projectDir),
            isNull(claudeSessionTimeline.subagentId)
          )
        )
        .all();

  const timeline: TimelineEntry[] = timelineRows.map((r) => ({
    timestamp: r.timestamp,
    kind: r.kind as TimelineEntry["kind"],
    text: r.text,
    toolName: r.toolName || undefined,
    isError: r.isError || undefined,
    agentId: r.agentId || undefined,
    tokenUsage:
      r.inputTokens != null
        ? {
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens || 0,
            cacheReadTokens: r.cacheReadTokens || 0,
            cacheCreationTokens: r.cacheCreationTokens || 0,
          }
        : undefined,
  }));

  const subAgentRows = db
    .select()
    .from(claudeSessionSubAgents)
    .where(
      and(
        eq(claudeSessionSubAgents.sessionId, sessionId),
        eq(claudeSessionSubAgents.projectDir, projectDir)
      )
    )
    .all();

  const subAgents: SubAgentInfo[] = subAgentRows.map((r) => ({
    agentId: r.agentId,
    prompt: r.prompt,
    model: r.model,
    messageCount: r.messageCount,
    tokenUsage: {
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreationTokens: r.cacheCreationTokens,
    },
  }));

  const taskRows = db
    .select()
    .from(claudeSessionTasks)
    .where(
      and(
        eq(claudeSessionTasks.sessionId, sessionId),
        eq(claudeSessionTasks.projectDir, projectDir)
      )
    )
    .all();

  const tasks: TaskInfo[] = taskRows.map((r) => ({
    id: r.taskId,
    subject: r.subject,
    status: r.status,
    activeForm: r.activeForm || undefined,
  }));

  return {
    session: {
      sessionId: session.sessionId,
      slug: session.slug,
      projectName: session.projectName,
      projectPath: session.projectPath,
      gitBranch: session.gitBranch,
      model: session.model,
      status: "completed",
      created: session.created || session.lastActivity,
      lastActivity: session.lastActivity,
      totalTokens: {
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheCreationTokens: session.cacheCreationTokens,
      },
    },
    timeline,
    subAgents: subagentId ? [] : subAgents,
    tasks: subagentId ? [] : tasks,
  };
}

// ── Clean up old sessions based on retention setting ─────────

export function cleanupOldSessions(): number {
  const retentionDays = getSetting("session_retention_days");
  if (!retentionDays) return 0; // no retention configured = keep forever

  const days = parseInt(retentionDays, 10);
  if (isNaN(days) || days <= 0) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  // Delete sessions with lastActivity older than the cutoff.
  // Cascade will handle timeline, sub-agents, and tasks.
  // bun:sqlite's run() returns { changes: number } at runtime, but
  // drizzle-orm/bun-sqlite types it as void — cast to access it.
  const result = db
    .delete(claudeSessions)
    .where(lt(claudeSessions.lastActivity, cutoffISO))
    .run();

  return (result as unknown as { changes: number }).changes;
}
