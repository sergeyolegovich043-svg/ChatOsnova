const promptInjectionPatterns = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions?/iu,
  /system\s+prompt/iu,
  /developer\s+message/iu,
  /забудь\s+(все\s+)?(предыдущие|системные)\s+инструкции/iu,
  /покажи\s+(системный|скрытый)\s+промпт/iu,
  /выполни\s+инструкции\s+из\s+(файла|сообщения)/iu
];

export function containsPromptInjection(value: string) {
  return promptInjectionPatterns.some((pattern) => pattern.test(value));
}

export function validateUserPrompt(value: string) {
  const prompt = value.trim();
  if (prompt.length < 2) throw new Error("Сформулируйте вопрос подробнее");
  if (prompt.length > 2_000) throw new Error("Запрос слишком длинный");
  if (containsPromptInjection(prompt)) throw new Error("Запрос похож на попытку изменить правила Барсика");
  return prompt;
}

export function filterUntrustedChunks<T extends { content: string }>(chunks: T[]) {
  return chunks.filter((chunk) => !containsPromptInjection(chunk.content));
}

export function sanitizeAuditError(error: unknown) {
  const raw = error instanceof Error ? error.message : "unknown";
  return raw.replace(/sk-[a-zA-Z0-9_-]+/g, "[secret]").slice(0, 80);
}
