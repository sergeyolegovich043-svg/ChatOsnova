import { createHash } from "node:crypto";
import { config } from "../config.js";

export type AiMode = "search" | "summary" | "draft";

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ProviderStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "completed"; text: string; usage: ProviderUsage };

export type ProviderRequest = {
  userId: string;
  mode: AiMode;
  system: string;
  prompt: string;
};

export interface AiProvider {
  readonly name: "luna" | "mock";
  readonly model: string;
  moderate(input: string, signal?: AbortSignal): Promise<boolean>;
  embed(input: string, signal?: AbortSignal): Promise<number[]>;
  stream(request: ProviderRequest, signal?: AbortSignal): AsyncGenerator<ProviderStreamEvent>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "timeout" | "invalid_response" | "moderation" | "cancelled"
  ) {
    super(message);
  }
}

const answerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "citations"],
  properties: {
    answer: { type: "string", minLength: 1, maxLength: 12_000 },
    citations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "label"],
        properties: {
          sourceId: { type: "string" },
          label: { type: "string", maxLength: 160 }
        }
      }
    }
  }
} as const;

function safetyIdentifier(userId: string) {
  return createHash("sha256").update(`barsikchat:${userId}`).digest("hex");
}

function combinedSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(config.ai.timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchOpenAi(path: string, apiKey: string, init: RequestInit, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.openai.com/v1${path}`, {
        ...init,
        signal: combinedSignal(signal),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...init.headers
        }
      });
      if (response.ok || ![408, 409, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        return response;
      }
      await response.arrayBuffer().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw new AiProviderError("Генерация отменена", "cancelled");
      if (attempt === 2) {
        const timeout = error instanceof DOMException && error.name === "TimeoutError";
        throw new AiProviderError(timeout ? "Luna не ответила вовремя" : "Luna временно недоступна", timeout ? "timeout" : "unavailable");
      }
    }
  }
  throw lastError instanceof Error ? lastError : new AiProviderError("Luna временно недоступна", "unavailable");
}

async function responseError(response: Response): Promise<never> {
  const requestId = response.headers.get("x-request-id");
  const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  const detail = payload?.error?.code ? ` (${payload.error.code})` : requestId ? ` (${requestId})` : "";
  throw new AiProviderError(`Luna вернула ошибку ${response.status}${detail}`, "unavailable");
}

async function* parseSse(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new AiProviderError("Пустой поток Luna", "invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new AiProviderError("Повреждённый поток Luna", "invalid_response");
      }
    }
    if (done) break;
  }
}

export class LunaProvider implements AiProvider {
  readonly name = "luna" as const;
  readonly model = config.ai.model;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new AiProviderError("OPENAI_API_KEY не настроен на dev-сервере", "unavailable");
  }

  async moderate(input: string, signal?: AbortSignal) {
    const response = await fetchOpenAi("/moderations", this.apiKey, {
      method: "POST",
      body: JSON.stringify({ model: config.ai.moderationModel, input })
    }, signal);
    if (!response.ok) return responseError(response);
    const payload = await response.json() as { results?: Array<{ flagged?: boolean }> };
    return Boolean(payload.results?.[0]?.flagged);
  }

  async embed(input: string, signal?: AbortSignal) {
    const response = await fetchOpenAi("/embeddings", this.apiKey, {
      method: "POST",
      body: JSON.stringify({ model: config.ai.embeddingModel, input, encoding_format: "float" })
    }, signal);
    if (!response.ok) return responseError(response);
    const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding || embedding.length !== 1536) throw new AiProviderError("Некорректный embedding", "invalid_response");
    return embedding;
  }

  async *stream(request: ProviderRequest, signal?: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
    const response = await fetchOpenAi("/responses", this.apiKey, {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        store: false,
        stream: true,
        safety_identifier: safetyIdentifier(request.userId),
        reasoning: { effort: "low" },
        max_output_tokens: config.ai.maxOutputTokens,
        input: [
          { role: "system", content: [{ type: "input_text", text: request.system }] },
          { role: "user", content: [{ type: "input_text", text: request.prompt }] }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "barsik_answer",
            strict: true,
            schema: answerJsonSchema
          }
        }
      })
    }, signal);
    if (!response.ok) return responseError(response);

    let text = "";
    let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of parseSse(response)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
        yield { type: "delta", delta: event.delta };
      }
      if (event.type === "response.completed") {
        const completed = event.response as { usage?: { input_tokens?: number; output_tokens?: number }; output_text?: string } | undefined;
        if (!text && completed?.output_text) text = completed.output_text;
        usage = {
          inputTokens: completed?.usage?.input_tokens ?? 0,
          outputTokens: completed?.usage?.output_tokens ?? 0
        };
      }
    }
    if (!text) throw new AiProviderError("Luna не вернула ответ", "invalid_response");
    yield { type: "completed", text, usage };
  }
}

export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly model = "barsik-test-mock";

  constructor(
    private readonly answer = "Готово. Это тестовый ответ Барсика.",
    private readonly citations: Array<{ sourceId: string; label: string }> = []
  ) {}

  async moderate(input: string) {
    return input.includes("[BLOCKED]");
  }

  async embed() {
    return Array.from({ length: 1536 }, () => 0);
  }

  async *stream(_request: ProviderRequest, signal?: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
    if (signal?.aborted) throw new AiProviderError("Генерация отменена", "cancelled");
    const text = JSON.stringify({ answer: this.answer, citations: this.citations });
    yield { type: "delta", delta: text };
    yield { type: "completed", text, usage: { inputTokens: 32, outputTokens: 16 } };
  }
}
