import { filterUntrustedChunks } from "./guardrails.js";
import { findAccessibleChunks } from "../repositories/ai.js";

export async function retrieveAuthorizedContext(input: {
  userId: string;
  prompt: string;
  conversationId?: string;
  limit?: number;
  since?: Date;
  pendingNotificationsOnly?: boolean;
  includePrivate?: boolean;
}) {
  const chunks = await findAccessibleChunks({
    userId: input.userId,
    search: input.prompt,
    conversationId: input.conversationId,
    limit: input.limit,
    since: input.since,
    pendingNotificationsOnly: input.pendingNotificationsOnly,
    includePrivate: input.includePrivate
  });
  return filterUntrustedChunks(chunks);
}
