export const ISSUE_STATUSES = [
  "pending", "planning", "reviewing_plan_1", "reviewing_plan_2",
  "implementing", "reviewing_code_1", "reviewing_code_2",
  "creating_pr", "completed", "failed", "waiting_for_input",
] as const;
export type IssueStatus = typeof ISSUE_STATUSES[number];

export const PHASE_STATUS_MAP: Record<number, IssueStatus> = {
  0: "pending",
  1: "planning",
  2: "reviewing_plan_1",
  3: "reviewing_plan_2",
  4: "implementing",
  5: "reviewing_code_1",
  6: "reviewing_code_2",
  7: "creating_pr",
};

export const MAX_PLAN_ITERATIONS = 3;
export const PHASE_TIMEOUT_MS = 15 * 60 * 1000;  // 15 min
export const IMPL_TIMEOUT_MS = 30 * 60 * 1000;   // 30 min
export const QA_TIMEOUT_MS = 30 * 60 * 1000;      // 30 min wait for reply

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    reply_to_message?: {
      message_id: number;
    };
  };
}

export interface PipelinePhaseResult {
  success: boolean;
  output: string;
  sessionId?: string;
  hasQuestions?: boolean;
  questions?: string;
}

export interface IssuesTelegramConfig {
  botToken: string;
  chatId: string;
}
