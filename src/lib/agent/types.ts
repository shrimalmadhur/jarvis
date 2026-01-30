export interface AgentRequest {
  conversationId?: string;
  message: string;
}

export interface AgentResponse {
  conversationId: string;
  message: string;
  model: string;
}
