import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth, type AuthenticatedRequest } from "../auth.js";
import { AiOrchestrator } from "../ai/orchestrator.js";
import { LunaProvider } from "../ai/provider.js";
import {
  acknowledgeAiNotifications,
  createAiPersonalTask,
  deleteAiPersonalTask,
  listAiPersonalTasks,
  listPendingAiNotificationGroups,
  updateAiPersonalTaskStatus
} from "../repositories/ai.js";

const modeSchema = z.enum(["search", "summary", "catchup", "draft", "tasks", "notification"]);
const draftStyleSchema = z.enum(["short", "formal", "friendly", "detailed"]);

const inputSchema = z.object({
  mode: modeSchema,
  prompt: z.string().trim().max(4_000).optional(),
  conversationId: z.string().uuid().optional(),
  scope: z.enum(["conversation", "day"]).optional(),
  since: z.string().datetime().optional(),
  draftStyle: draftStyleSchema.optional()
}).superRefine((value, context) => {
  if (["summary", "draft", "tasks"].includes(value.mode) && !value.conversationId) {
    context.addIssue({ code: "custom", path: ["conversationId"], message: "Для этой функции выберите чат" });
  }
  if (value.mode === "catchup" && (value.scope ?? (value.conversationId ? "conversation" : "day")) === "conversation" && !value.conversationId) {
    context.addIssue({ code: "custom", path: ["conversationId"], message: "Для сводки по чату выберите чат" });
  }
  if (value.mode === "search" && !value.prompt) {
    context.addIssue({ code: "custom", path: ["prompt"], message: "Введите вопрос для поиска" });
  }
});

const createTaskSchema = z.object({
  clientId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  details: z.string().trim().max(1_000).default(""),
  assignee: z.string().trim().max(120).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional()
});

const taskStatusSchema = z.object({
  status: z.enum(["open", "done", "dismissed"])
});

const acknowledgeSchema = z.object({
  conversationId: z.string().uuid().optional(),
  messageIds: z.array(z.string().uuid()).max(100).optional()
});

const defaultPrompts: Record<z.infer<typeof modeSchema>, string> = {
  search: "Найди ответ в доступных переписках.",
  summary: "Кратко подведи итог выбранного чата.",
  catchup: "Расскажи, что я пропустил: важное, решения, вопросы ко мне, сроки и ответственные.",
  draft: "Предложи подходящий черновик ответа с учётом переписки.",
  tasks: "Выдели решения, поручения, сроки и вопросы без ответа.",
  notification: "Сформируй одно полезное уведомление по новым сообщениям."
};

function sendEvent(response: Response, event: string, payload: unknown) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function authRequest(request: Request) {
  return request as AuthenticatedRequest;
}

function routeParam(request: Request, name: string) {
  const value = request.params[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parseSince(value: unknown) {
  const result = z.string().datetime().optional().safeParse(value);
  return result.success && result.data ? new Date(result.data) : undefined;
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
      reason: configured ? null : config.ai.enabled ? "missing_server_key" : "disabled",
      capabilities: ["catchup", "search", "draft", "tasks", "smart_notifications"],
      confirmationRequired: ["send_draft", "create_task"]
    });
  });

  router.get("/tasks", requireAuth, async (request, response, next) => {
    try {
      const status = z.enum(["open", "done", "dismissed"]).optional().parse(request.query.status);
      response.json({ tasks: await listAiPersonalTasks(authRequest(request).user.id, status) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks", requireAuth, async (request, response) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Некорректная задача" });
      return;
    }
    try {
      const task = await createAiPersonalTask({
        userId: authRequest(request).user.id,
        ...parsed.data,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null
      });
      response.status(201).json({ task });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Не удалось добавить задачу" });
    }
  });

  router.patch("/tasks/:taskId", requireAuth, async (request, response) => {
    const input = taskStatusSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "Некорректный статус задачи" });
      return;
    }
    const task = await updateAiPersonalTaskStatus(
      authRequest(request).user.id,
      routeParam(request, "taskId"),
      input.data.status
    );
    if (!task) {
      response.status(404).json({ error: "Задача не найдена" });
      return;
    }
    response.json({ task });
  });

  router.delete("/tasks/:taskId", requireAuth, async (request, response) => {
    const deleted = await deleteAiPersonalTask(authRequest(request).user.id, routeParam(request, "taskId"));
    if (!deleted) {
      response.status(404).json({ error: "Задача не найдена" });
      return;
    }
    response.status(204).end();
  });

  router.get("/notifications/pending", requireAuth, async (request, response) => {
    const since = parseSince(request.query.since);
    response.json({ groups: await listPendingAiNotificationGroups(authRequest(request).user.id, since) });
  });

  router.post("/notifications/ack", requireAuth, async (request, response) => {
    const input = acknowledgeSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "Некорректный запрос подтверждения" });
      return;
    }
    const acknowledged = await acknowledgeAiNotifications({
      userId: authRequest(request).user.id,
      ...input.data
    });
    response.json({ acknowledged });
  });

  router.post("/stream", requireAuth, async (request, response) => {
    if (!orchestrator) {
      response.status(503).json({ error: "Барсик ИИ не настроен на dev-сервере" });
      return;
    }

    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Некорректный запрос" });
      return;
    }
    const input = parsed.data;
    const scope = input.scope ?? (input.conversationId ? "conversation" : "day");
    const since = input.since
      ? new Date(input.since)
      : scope === "day" ? new Date(Date.now() - 24 * 60 * 60 * 1_000) : undefined;
    let prompt = input.prompt || defaultPrompts[input.mode];
    if (input.mode === "catchup" || input.mode === "notification") {
      const groups = (await listPendingAiNotificationGroups(authRequest(request).user.id, since))
        .filter((group) => !input.conversationId || group.conversationId === input.conversationId);
      const messageCount = groups.reduce((total, group) => total + group.messageCount, 0);
      const mentionCount = groups.reduce((total, group) => total + group.mentionCount, 0);
      const attentionCount = groups.filter((group) => group.needsAttention).length;
      prompt += ` Точные агрегаты сервера: ${messageCount} новых сообщений, ${mentionCount} упоминаний, ${groups.length} чатов, ${attentionCount} чатов требуют внимания.`;
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
      for await (const event of orchestrator.run({
        userId: authRequest(request).user.id,
        mode: input.mode,
        prompt,
        conversationId: input.conversationId,
        scope,
        since,
        draftStyle: input.draftStyle,
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
