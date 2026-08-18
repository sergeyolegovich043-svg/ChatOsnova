export const READ_ONLY_AI_TOOLS = ["search_messages", "summarize_conversation", "draft_message"] as const;
export const CONFIRMATION_REQUIRED_ACTIONS = ["send_message", "delete_message", "forward_message"] as const;

export function isReadOnlyTool(value: string) {
  return (READ_ONLY_AI_TOOLS as readonly string[]).includes(value);
}

export function requiresConfirmation(value: string) {
  return (CONFIRMATION_REQUIRED_ACTIONS as readonly string[]).includes(value);
}
