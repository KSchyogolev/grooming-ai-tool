import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { APIError, RateLimitError } from "@anthropic-ai/sdk";
import { type RetryConfig, withRetry } from "../src/lib/anthropic-retry";
import { resetWriter, setWriter } from "../src/logger";

beforeAll(() => setWriter(() => {}));
afterAll(() => resetWriter());

const FAST: RetryConfig = {
  maxRetries: 4,
  rateLimitDelays: [10, 20, 30, 40],
  serverErrorDelays: [10, 20, 30, 40],
};

type SdkHeaders = Record<string, string | null | undefined>;

function makeRateLimitError(retryAfter?: string): RateLimitError {
  const headers: SdkHeaders = {};
  if (retryAfter) headers["retry-after"] = retryAfter;
  return new RateLimitError(
    429,
    { type: "error", error: { type: "rate_limit_error", message: "rate limited" } },
    "rate limited",
    headers,
  );
}

function makeServerError(status: number): APIError {
  return new APIError(
    status,
    { type: "error", error: { type: "api_error", message: "server error" } },
    "server error",
    {} as SdkHeaders,
  );
}

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const fn = mock(() => Promise.resolve("ok"));
    const result = await withRetry(fn, "test", FAST);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on RateLimitError and succeeds", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls <= 2) return Promise.reject(makeRateLimitError());
      return Promise.resolve("recovered");
    });

    const result = await withRetry(fn, "test", FAST);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("retries on 5xx and succeeds", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls === 1) return Promise.reject(makeServerError(500));
      return Promise.resolve("recovered");
    });

    const result = await withRetry(fn, "test", FAST);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("retries on 529 overloaded", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls === 1) return Promise.reject(makeServerError(529));
      return Promise.resolve("ok");
    });

    const result = await withRetry(fn, "test", FAST);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("throws after max retries exhausted", async () => {
    const err = makeRateLimitError();
    const fn = mock(() => Promise.reject(err));

    await expect(withRetry(fn, "test", FAST)).rejects.toThrow("rate limited");
    expect(fn).toHaveBeenCalledTimes(5);
  });

  test("does not retry on non-retryable errors", async () => {
    const fn = mock(() => Promise.reject(new Error("bad input")));

    await expect(withRetry(fn, "test", FAST)).rejects.toThrow("bad input");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("does not retry on 4xx errors other than 429", async () => {
    const err = new APIError(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "bad" } },
      "bad request",
      {} as SdkHeaders,
    );
    const fn = mock(() => Promise.reject(err));

    await expect(withRetry(fn, "test", FAST)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("respects retry-after header", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls === 1) return Promise.reject(makeRateLimitError("0.01"));
      return Promise.resolve("ok");
    });

    const result = await withRetry(fn, "test", FAST);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("uses default config when none provided", async () => {
    const fn = mock(() => Promise.resolve("ok"));
    const result = await withRetry(fn, "test");
    expect(result).toBe("ok");
  });

  test("custom maxRetries limits attempts", async () => {
    const err = makeRateLimitError();
    const fn = mock(() => Promise.reject(err));

    await expect(withRetry(fn, "test", { ...FAST, maxRetries: 1 })).rejects.toThrow("rate limited");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
