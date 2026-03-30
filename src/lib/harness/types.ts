export const HARNESS_TYPES = ["claude", "codex"] as const;
export type HarnessType = (typeof HARNESS_TYPES)[number];

export interface HarnessPhaseOpts {
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  /** Claude: --session-id; Codex: ignored (auto-generated, returned via thread_id) */
  sessionId?: string;
  /** Claude: --resume <id>; Codex: codex exec resume <thread_id> */
  resumeSessionId?: string;
  /** Extra env vars merged into the harness-specific allowlist */
  envOverrides?: Record<string, string>;
  /** Claude only: pass -w <name> on first phase to let Claude create a worktree */
  worktreeName?: string;
}

export interface HarnessPhaseResult {
  success: boolean;
  output: string;
  /** Claude: the UUID passed in or generated; Codex: thread_id from stream */
  sessionId?: string;
  hasQuestions?: boolean;
  questions?: string;
  timedOut?: boolean;
}
