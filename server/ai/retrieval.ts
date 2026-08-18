import { filterUntrustedChunks } from "./guardrails.js";
import { findAccessibleChunks } from "../repositories/ai.js";

export async function retrieveAuthorizedContext(input: {
  userId: string;
  prompt: string;
  conversationId?: string;
  limit?: number;
}) {
  const chunks = await findAccessibleChunks({
    userId: input.userId,
    search: input.prompt,
    conversationId: input.conversationId,
    limit: input.limit
  });
  return filterUntrustedChunks(chunks);
}
