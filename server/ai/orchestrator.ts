import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import {
  monthlyAiSpend,
  recordAiAudit,
  recordAiUsage
} from "../repositories/ai.js";
import { buildAiContext, type RetrievedChunk } from "./context.js";
import { sanitizeAuditError, validateUserPrompt } from "./guardrails.js";
import type { AiMode, AiProvider, ProviderUsage } from "./provider.js";
import { AiProviderError } from "./provider.js";
import { retrieveAuthorizedContext } from "./retrieval.js";
import { calculateLunaCost, PerUserRateLimiter, ProviderCircuitBreaker } from "./usage.js";

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(12_000),
  citations: z.array(z.object({ sourceId: z.string(), label: z.string().max(160) })).max(12)
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
};

const defaultDependencies: AiOrchestratorDependencies = {
  retrieve: retrieveAuthorizedContext,
  monthlySpend: monthlyAiSpend,
  recordUsage: recordAiUsage,
  recordAudit: recordAiAudit
};

function requestHash(userId: string, mode: AiMode, prompt: string) {
  return createHash("sha256").update(`${userId}:${mode}:${prompt}`).digest("hex");
}

function authoritativeCitations(answer: AiAnswer, sources: RetrievedChunk[]) {
  const allowed = new Map(sources.map((source) => [source.sourceId, source]));
  const seen = new Set<string>();
  return answer.citations.flatMap((citation) => {
    const source = allowed.get(citation.sourceId);
    if (!source || seen.has(source.sourceId)) return [];
    seen.add(source.sourceId);
    return [{
      sourceId: source.sourceId,
      label: `${source.conversationTitle} · ${source.authorName} · ${source.createdAt.toLocaleDateString("ru-RU")}`
    }];
  });
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
      const sources = await this.dependencies.retrieve({
        userId: input.userId,
        prompt: input.mode === "summary" ? "" : prompt,
        conversationId: input.conversationId,
        limit: input.mode === "summary" ? 40 : 12
      });
      sourceIds = sources.map((source) => source.sourceId);
      const context = buildAiContext(input.mode, prompt, sources, config.ai.maxContextChars);

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
      const result = { ...parsed, citations: authoritativeCitations(parsed, context.sources) };
      if (await this.provider.moderate(result.answer, input.signal)) {
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
