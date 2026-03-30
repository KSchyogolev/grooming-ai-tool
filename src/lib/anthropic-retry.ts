import { APIError, RateLimitError } from "@anthropic-ai/sdk";
import * as log from "../logger";

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RATE_LIMIT_DELAYS = [15_000, 30_000, 45_000, 60_000];
const DEFAULT_SERVER_ERROR_DELAYS = [2_000, 5_000, 10_000, 20_000];

export interface RetryConfig {
  maxRetries?: number;
  rateLimitDelays?: number[];
  serverErrorDelays?: number[];
}

function isRetryable(err: unknown): err is APIError {
  if (err instanceof RateLimitError) return true;
  if (err instanceof APIError && err.status !== undefined && err.status >= 500) return true;
  return false;
}

function getRetryDelay(err: APIError, attempt: number, config?: RetryConfig): number {
  const retryAfter = err.headers?.["retry-after"];
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  if (err instanceof RateLimitError) {
    const delays = config?.rateLimitDelays ?? DEFAULT_RATE_LIMIT_DELAYS;
    return delays[attempt] ?? delays.at(-1) ?? 60_000;
  }
  const delays = config?.serverErrorDelays ?? DEFAULT_SERVER_ERROR_DELAYS;
  return delays[attempt] ?? delays.at(-1) ?? 20_000;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  config?: RetryConfig,
): Promise<T> {
  const maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt >= maxRetries) throw err;

      const delay = getRetryDelay(err, attempt, config);
      log.warn("Anthropic API retry", {
        step: "anthropic-retry",
        label,
        attempt: attempt + 1,
        status: err.status,
        delayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
