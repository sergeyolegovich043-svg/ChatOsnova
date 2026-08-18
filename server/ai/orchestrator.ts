import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import {
  acknowledgeAiNotifications,
  monthlyAiSpend,
  recordAiAudit,
  recordAiUsage
} from "../repositories/ai.js";
import { buildAiContext, type RetrievedChunk } from "./context.js";
import { sanitizeAuditError, validateUserPrompt } from "./guardrails.js";
import type { AiMode, AiProvider, DraftStyle, ProviderUsage } from "./provider.js";
import { AiProviderError } from "./provider.js";
import { retrieveAuthorizedContext } from "./retrieval.js";
import { calculateLunaCost, PerUserRateLimiter, ProviderCircuitBreaker } from "./usage.js";

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(12_000),
  citations: z.array(z.object({ sourceId: z.string(), label: z.string().max(160) })).max(12),
  highlights: z.array(z.string().trim().min(1).max(500)).max(12),
  decisions: z.array(z.string().trim().min(1).max(500)).max(12),
  questions: z.array(z.string().trim().min(1).max(500)).max(12),
  deadlines: z.array(z.object({
    text: z.string().trim().min(1).max(500),
    assignee: z.string().trim().max(120).nullable(),
    dueAt: z.string().trim().max(40).nullable(),
    sourceId: z.string().nullable()
  })).max(12),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(240),
    details: z.string().trim().max(1_000),
    assignee: z.string().trim().max(120).nullable(),
    dueAt: z.string().trim().max(40).nullable(),
    sourceId: z.string().nullable()
  })).max(20),
  draft: z.string().trim().max(4_000).nullable(),
  notification: z.object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(300),
    priority: z.enum(["normal", "important", "urgent"]),
    mentionsUser: z.boolean(),
    actionRequired: z.boolean()
  }).nullable()
});

export type AiAnswer = z.infer<typeof answerSchema>;
export type OrchestratorEvent =
  | { type: "status"; stage: "retrieval" | "generation" | "moderation" }
  | { type: "progress"; generatedChars: number }
  | { type: "result"; result: AiAnswer };

export type AiOrchestratorDependencies = {
  retrieve: typeof retrieveAuthorizedContext;
  monthlySpend: typeof monthlyAiSpend;
  recordUsage: typeof recordAiUsage;
  recordAudit: typeof recordAiAudit;
  acknowledgeNotifications: typeof acknowledgeAiNotifications;
};

const defaultDependencies: AiOrchestratorDependencies = {
  retrieve: retrieveAuthorizedContext,
  monthlySpend: monthlyAiSpend,
  recordUsage: recordAiUsage,
  recordAudit: recordAiAudit,
  acknowledgeNotifications: acknowledgeAiNotifications
};

function requestHash(userId: string, mode: AiMode, prompt: string) {
  return createHash("sha256").update(`${userId}:${mode}:${prompt}`).digest("hex");
}

function authoritativeCitations(answer: AiAnswer, sources: RetrievedChunk[], requireSource: boolean) {
  const allowed = new Map(sources.map((source) => [source.sourceId, source]));
  const seen = new Set<string>();
  const citations = answer.citations.flatMap((citation) => {
    const source = allowed.get(citation.sourceId);
    if (!source || seen.has(source.sourceId)) return [];
    seen.add(source.sourceId);
    return [{
      sourceId: source.sourceId,
      label: `${source.conversationTitle} · ${source.authorName} · ${source.createdAt.toLocaleDateString("ru-RU")}`
    }];
  });
  if (requireSource && citations.length === 0 && sources[0]) {
    throw new AiProviderError("Luna не указала проверяемый источник ответа", "invalid_response");
  }
  return citations;
}

function authoritativeSourceId(sourceId: string | null, sources: RetrievedChunk[]) {
  if (!sourceId) return null;
  return sources.some((source) => source.sourceId === sourceId) ? sourceId : null;
}

export class AiOrchestrator {
  private readonly limiter = new PerUserRateLimiter();
  private readonly circuit = new ProviderCircuitBreaker();

  constructor(
    private readonly provider: AiProvider,
    private readonly dependencies: AiOrchestratorDependencies = defaultDependencies
  ) {}

  async *run(input: {
    userId: string;
    mode: AiMode;
    prompt: string;
    conversationId?: string;
    scope?: "conversation" | "day";
    since?: Date;
    draftStyle?: DraftStyle;
    signal?: AbortSignal;
  }): AsyncGenerator<OrchestratorEvent> {
    const prompt = validateUserPrompt(input.prompt);
    const hash = requestHash(input.userId, input.mode, prompt);
    let sourceIds: string[] = [];
    let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      if (!this.limiter.check(input.userId)) throw new Error("Слишком много запросов к Барсику. Подождите минуту");
      if (!this.circuit.canRequest()) throw new Error("Барсик временно отдыхает после сбоя Luna");

      const spend = await this.dependencies.monthlySpend(input.userId);
      const budget = spend.customBudget ?? config.ai.monthlyBudgetUsd;
      if (spend.spent >= budget) throw new Error("Месячный лимит ИИ исчерпан");

      yield { type: "status", stage: "moderation" };
      if (await this.provider.moderate(prompt, input.signal)) {
        throw new AiProviderError("Запрос не прошёл проверку безопасности", "moderation");
      }

      yield { type: "status", stage: "retrieval" };
      const newestFirstMode = ["summary", "catchup", "draft", "tasks", "notification"].includes(input.mode);
      const limitByMode: Record<AiMode, number> = {
        search: 16,
        summary: 50,
        catchup: 60,
        draft: 24,
        tasks: 50,
        notification: 60
      };
      const sources = await this.dependencies.retrieve({
        userId: input.userId,
        prompt: newestFirstMode ? "" : prompt,
        conversationId: input.conversationId,
        limit: limitByMode[input.mode],
        since: input.since,
        pendingNotificationsOnly: input.mode === "catchup" || input.mode === "notification",
        includePrivate: input.scope === "day"
      });
      sourceIds = sources.map((source) => source.sourceId);
      const context = buildAiContext(input.mode, prompt, sources, config.ai.maxContextChars, {
        draftStyle: input.draftStyle
      });

      yield { type: "status", stage: "generation" };
      let generated = "";
      for await (const event of this.provider.stream({
        userId: input.userId,
        mode: input.mode,
        system: context.system,
        prompt: context.prompt
      }, input.signal)) {
        if (event.type === "delta") {
          generated += event.delta;
          yield { type: "progress", generatedChars: generated.length };
        } else {
          generated = event.text;
          usage = event.usage;
        }
      }

      const parsed = answerSchema.parse(JSON.parse(generated));
      const result: AiAnswer = {
        ...parsed,
        citations: authoritativeCitations(parsed, context.sources, input.mode !== "draft"),
        deadlines: parsed.deadlines.map((deadline) => ({
          ...deadline,
          sourceId: authoritativeSourceId(deadline.sourceId, context.sources)
        })),
        tasks: parsed.tasks.map((task) => ({
          ...task,
          sourceId: authoritativeSourceId(task.sourceId, context.sources)
        }))
      };
      const moderatedOutput = [result.answer, result.draft, result.notification?.body].filter(Boolean).join("\n");
      if (await this.provider.moderate(moderatedOutput, input.signal)) {
        throw new AiProviderError("Ответ не прошёл проверку безопасности", "moderation");
      }

      const costUsd = calculateLunaCost(usage.inputTokens, usage.outputTokens);
      await this.dependencies.recordUsage({
        userId: input.userId,
        provider: this.provider.name,
        model: this.provider.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd
      });
      await this.dependencies.recordAudit({
        userId: input.userId,
        requestHash: hash,
        action: input.mode,
        status: "completed",
        provider: this.provider.name,
        model: this.provider.model,
        sourceIds,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens
      });
      this.circuit.success();
      yield { type: "result", result };
      if (
        !input.signal?.aborted &&
        (input.mode === "catchup" || input.mode === "notification") &&
        sourceIds.length > 0
      ) {
        await this.dependencies.acknowledgeNotifications({
          userId: input.userId,
          conversationId: input.conversationId,
          messageIds: [...new Set(sourceIds)]
        }).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof AiProviderError && ["unavailable", "timeout"].includes(error.code)) this.circuit.failure();
      await this.dependencies.recordAudit({
        userId: input.userId,
        requestHash: hash,
        action: input.mode,
        status: input.signal?.aborted ? "cancelled" : "failed",
        provider: this.provider.name,
        model: this.provider.model,
        sourceIds,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        errorCode: sanitizeAuditError(error)
      }).catch(() => undefined);
      throw error;
    }
  }
}
