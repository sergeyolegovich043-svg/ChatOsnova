import { config } from "../config.js";

export function calculateLunaCost(inputTokens: number, outputTokens: number) {
  return (
    inputTokens * config.ai.inputUsdPerMillion / 1_000_000 +
    outputTokens * config.ai.outputUsdPerMillion / 1_000_000
  );
}

export class PerUserRateLimiter {
  private readonly windows = new Map<string, number[]>();

  check(userId: string, now = Date.now()) {
    const cutoff = now - 60_000;
    const recent = (this.windows.get(userId) ?? []).filter((time) => time > cutoff);
    if (recent.length >= config.ai.requestsPerMinute) return false;
    recent.push(now);
    this.windows.set(userId, recent);
    return true;
  }
}

export class ProviderCircuitBreaker {
  private failures = 0;
  private disabledUntil = 0;

  canRequest(now = Date.now()) {
    return now >= this.disabledUntil;
  }

  success() {
    this.failures = 0;
    this.disabledUntil = 0;
  }

  failure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= 3) this.disabledUntil = now + 60_000;
  }
}
