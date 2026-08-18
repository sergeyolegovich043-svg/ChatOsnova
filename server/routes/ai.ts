import { Router, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth, type AuthenticatedRequest } from "../auth.js";
import { AiOrchestrator } from "../ai/orchestrator.js";
import { LunaProvider } from "../ai/provider.js";

const inputSchema = z.object({
  mode: z.enum(["search", "summary", "draft"]),
  prompt: z.string(),
  conversationId: z.string().uuid().optional()
}).superRefine((value, context) => {
  if (value.mode === "summary" && !value.conversationId) {
    context.addIssue({ code: "custom", path: ["conversationId"], message: "Для сводки выберите чат" });
  }
});

function sendEvent(response: Response, event: string, payload: unknown) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function createAiRouter() {
  const router = Router();
  const configured = config.ai.enabled && Boolean(config.ai.apiKey);
  const orchestrator = configured ? new AiOrchestrator(new LunaProvider(config.ai.apiKey)) : null;

  router.get("/status", requireAuth, (_request, response) => {
    response.json({
      enabled: configured,
      readOnly: true,
      model: configured ? config.ai.model : null,
      reason: configured ? null : config.ai.enabled ? "missing_server_key" : "disabled"
    });
  });

  router.post("/stream", requireAuth, async (request, response) => {
    if (!orchestrator) {
      response.status(503).json({ error: "Барсик ИИ не настроен на dev-сервере" });
      return;
    }

    let input: z.infer<typeof inputSchema>;
    try {
      input = inputSchema.parse(request.body);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Некорректный запрос" });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const controller = new AbortController();
    response.on("close", () => controller.abort());
    try {
      const authenticated = request as AuthenticatedRequest;
      for await (const event of orchestrator.run({
        userId: authenticated.user.id,
        mode: input.mode,
        prompt: input.prompt,
        conversationId: input.conversationId,
        signal: controller.signal
      })) {
        sendEvent(response, event.type, event);
      }
      sendEvent(response, "done", { ok: true });
    } catch (error) {
      if (!controller.signal.aborted) {
        sendEvent(response, "error", { error: error instanceof Error ? error.message : "Ошибка Барсика" });
      }
    } finally {
      response.end();
    }
  });

  return router;
}
