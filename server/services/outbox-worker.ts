import { config } from "../config.js";
import { LunaProvider } from "../ai/provider.js";
import { sanitizeAuditError } from "../ai/guardrails.js";
import {
  deleteAiConversation,
  deleteAiSource,
  deleteAiUserConversation,
  enqueueAiNotifications,
  findChunksMissingEmbeddings,
  isIndexableMessage,
  readIndexableAttachment,
  readIndexableMessage,
  removeAiNotificationsForMessage,
  saveEmbedding,
  upsertAiChunk
} from "../repositories/ai.js";
import { claimOutboxEvents, completeOutboxEvent, failOutboxEvent, type OutboxEvent } from "../repositories/outbox.js";

const provider = config.ai.enabled && config.ai.apiKey ? new LunaProvider(config.ai.apiKey) : null;

async function embedChunk(chunkId: string, content: string) {
  if (!provider) return;
  const embedding = await provider.embed(content);
  await saveEmbedding(chunkId, config.ai.embeddingModel, embedding);
}

async function processMessage(event: OutboxEvent) {
  const message = await readIndexableMessage(event.aggregateId);
  if (event.eventType === "message.deleted" || !isIndexableMessage(message) || !message) {
    await deleteAiSource("message", event.aggregateId);
    await removeAiNotificationsForMessage(event.aggregateId);
    return;
  }
  // Notification grouping is deterministic and must keep working even if the
  // external embedding provider is unavailable.
  await enqueueAiNotifications(message.id);
  const content = message.body.trim().slice(0, 8_000);
  if (content) {
    const chunkId = await upsertAiChunk({
      conversationId: message.conversationId,
      sourceKind: "message",
      sourceId: message.id,
      sourceMessageId: message.id,
      private: message.conversationKind === "direct",
      content
    });
    await embedChunk(chunkId, content);
  } else {
    await deleteAiSource("message", event.aggregateId);
  }
}

async function processAttachment(event: OutboxEvent) {
  const attachment = await readIndexableAttachment(event.aggregateId);
  if (event.payload.operation === "delete" || !isIndexableMessage(attachment) || !attachment) {
    await deleteAiSource("attachment", event.aggregateId);
    return;
  }
  // Intentionally index metadata only. The pilot never opens documents or unpacks archives.
  const content = `Вложение: ${attachment.originalName}; MIME: ${attachment.mimeType}; размер: ${attachment.sizeBytes} байт.`;
  const chunkId = await upsertAiChunk({
    conversationId: attachment.conversationId,
    sourceKind: "attachment",
    sourceId: attachment.id,
    sourceMessageId: attachment.messageId,
    private: attachment.conversationKind === "direct",
    content
  });
  await embedChunk(chunkId, content);
}

async function processEvent(event: OutboxEvent) {
  switch (event.eventType) {
    case "message.created":
    case "message.updated":
    case "message.deleted":
      await processMessage(event);
      break;
    case "attachment.ready":
      await processAttachment(event);
      break;
    case "member.removed":
      if (event.payload.userId && event.payload.conversationId) {
        await deleteAiUserConversation(event.payload.userId, event.payload.conversationId);
      }
      break;
    case "conversation.deleted":
      await deleteAiConversation(event.aggregateId);
      break;
  }
}

export async function runOutboxBatch() {
  const events = await claimOutboxEvents();
  for (const event of events) {
    try {
      await processEvent(event);
      await completeOutboxEvent(event.id);
    } catch (error) {
      await failOutboxEvent(event.id, sanitizeAuditError(error), event.attempts);
    }
  }
  return events.length;
}

export async function backfillEmbeddings() {
  if (!provider) return 0;
  const chunks = await findChunksMissingEmbeddings();
  for (const chunk of chunks) await embedChunk(chunk.id, chunk.content);
  return chunks.length;
}
