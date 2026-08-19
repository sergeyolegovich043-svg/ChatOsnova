export const CHAT_BOTTOM_THRESHOLD = 72;

export type ChatScrollMetrics = Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">;

export function chatDistanceFromBottom(metrics: ChatScrollMetrics) {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function isChatNearBottom(metrics: ChatScrollMetrics, threshold = CHAT_BOTTOM_THRESHOLD) {
  return chatDistanceFromBottom(metrics) <= threshold;
}

export function scrollTopAfterPrepend(previousScrollTop: number, previousScrollHeight: number, nextScrollHeight: number) {
  return previousScrollTop + Math.max(0, nextScrollHeight - previousScrollHeight);
}
