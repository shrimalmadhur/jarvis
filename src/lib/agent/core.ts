import { getLLMProvider } from "@/lib/ai";
import type { LLMMessage, LLMToolDefinition } from "@/lib/ai/types";
import { getMCPClientManager } from "@/lib/mcp/client";
import { loadMCPServerConfigs } from "@/lib/mcp/config";
import { buildSystemPrompt } from "./system-prompt";
import {
  createConversation,
  getConversation,
  addMessage,
  updateConversationTitle,
} from "./conversation-store";
import { BUILTIN_TOOLS, BUILTIN_TOOL_NAMES, executeBuiltinTool } from "./builtin-tools";
import type { AgentRequest, AgentResponse } from "./types";

const MAX_TOOL_ITERATIONS = 10;

// Track MCP servers that recently failed to connect.
// Prevents blocking every request with 120s timeout retries.
const mcpFailureCache = new Map<string, number>();
const MCP_RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Run the agent for a single request.
 * Implements the agentic loop: message → LLM → tools → LLM → response.
 */
export async function runAgent(request: AgentRequest): Promise<AgentResponse> {
  // Get or create conversation
  let conversationId = request.conversationId;
  let conversationMessages: LLMMessage[] = [];

  if (conversationId) {
    const conv = await getConversation(conversationId);
    if (conv) {
      conversationMessages = conv.messages;
    } else {
      conversationId = undefined;
    }
  }

  if (!conversationId) {
    const conv = await createConversation();
    conversationId = conv.id;
  }

  // Ensure enabled MCP servers are connected
  const mcpManager = getMCPClientManager();
  const enabledConfigs = await loadMCPServerConfigs();
  const connectedNames = new Set(mcpManager.getConnectedServers());
  const now = Date.now();

  for (const config of enabledConfigs) {
    if (connectedNames.has(config.name)) continue;

    // Skip servers that recently failed (avoid 120s timeout on every request)
    const lastFailure = mcpFailureCache.get(config.name);
    if (lastFailure && now - lastFailure < MCP_RETRY_INTERVAL_MS) continue;

    try {
      await mcpManager.connect(config);
      mcpFailureCache.delete(config.name);
    } catch (error) {
      mcpFailureCache.set(config.name, now);
      console.error(`Failed to connect MCP server "${config.name}":`, error);
    }
  }

  // Disconnect servers that are no longer enabled
  const enabledNames = new Set(enabledConfigs.map((c) => c.name));
  for (const name of connectedNames) {
    if (!enabledNames.has(name)) {
      await mcpManager.disconnect(name);
    }
  }

  // Gather tools: built-in + MCP
  const mcpTools = await mcpManager.listTools();
  const mcpToolNames = new Set(mcpTools.map((t) => t.name));

  const allToolDefs: LLMToolDefinition[] = [
    ...BUILTIN_TOOLS,
    ...mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
  ];

  // Build message array
  const llmMessages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...conversationMessages,
    { role: "user", content: request.message },
  ];

  // Save user message
  await addMessage(conversationId, { role: "user", content: request.message });

  // Agentic loop
  let iterations = 0;
  const { provider, config } = await getLLMProvider("chat");

  while (iterations < MAX_TOOL_ITERATIONS) {
    const response = await provider.chat({
      messages: llmMessages,
      tools: allToolDefs.length > 0 ? allToolDefs : undefined,
      temperature: config.temperature,
    });

    if (
      response.finishReason === "tool_calls" &&
      response.message.toolCalls?.length
    ) {
      // Save assistant's tool-calling message
      llmMessages.push(response.message);
      await addMessage(conversationId, response.message, response.model);

      // Execute each tool call
      for (const toolCall of response.message.toolCalls) {
        const args = JSON.parse(toolCall.function.arguments);
        let resultContent: string;

        if (BUILTIN_TOOL_NAMES.has(toolCall.function.name)) {
          // Built-in tool
          resultContent = await executeBuiltinTool(toolCall.function.name, args);
        } else if (mcpToolNames.has(toolCall.function.name)) {
          // MCP tool
          const result = await mcpManager.callTool(
            toolCall.function.name,
            args
          );
          resultContent = result.content
            .map((c) => c.text || JSON.stringify(c))
            .join("\n");
        } else {
          resultContent = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
        }

        const toolMessage: LLMMessage = {
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.function.name,
          content: resultContent,
        };

        llmMessages.push(toolMessage);
        await addMessage(conversationId, toolMessage);
      }

      iterations++;
      continue;
    }

    // Final text response
    const assistantContent = response.message.content || "";
    await addMessage(conversationId, response.message, response.model);

    // Auto-title the conversation if it's new (first user message)
    if (conversationMessages.length === 0) {
      const title =
        request.message.length > 60
          ? request.message.substring(0, 57) + "..."
          : request.message;
      await updateConversationTitle(conversationId, title);
    }

    return {
      conversationId,
      message: assistantContent,
      model: response.model,
    };
  }

  // Hit max iterations
  const fallback =
    "I've reached the maximum number of tool calls for this request. Here's what I was working on - could you try rephrasing your request?";
  await addMessage(conversationId, { role: "assistant", content: fallback });

  return {
    conversationId,
    message: fallback,
    model: "system",
  };
}
