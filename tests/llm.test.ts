import { describe, expect, mock, test } from "bun:test";
import { call, callWithThinking } from "../src/lib/llm";
import { UsageTracker } from "../src/lib/usage-tracker";

function mockClient(textResponse: string, usage = { input_tokens: 100, output_tokens: 50 }) {
  return {
    messages: {
      create: mock(() =>
        Promise.resolve({
          content: [{ type: "text" as const, text: textResponse }],
          usage,
        }),
      ),
    },
  } as unknown as Parameters<typeof call>[0];
}

function mockClientThinking(
  textResponse: string,
  usage = { input_tokens: 200, output_tokens: 100 },
) {
  return {
    messages: {
      create: mock(() =>
        Promise.resolve({
          content: [
            { type: "thinking" as const, thinking: "internal reasoning..." },
            { type: "text" as const, text: textResponse },
          ],
          usage,
        }),
      ),
    },
  } as unknown as Parameters<typeof callWithThinking>[0];
}

function mockClientEmpty() {
  return {
    messages: {
      create: mock(() =>
        Promise.resolve({
          content: [{ type: "tool_use" as const, id: "x", name: "y", input: {} }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
    },
  } as unknown as Parameters<typeof call>[0];
}

describe("call", () => {
  test("sends messages with user prompt", async () => {
    const client = mockClient("hello world");
    const result = await call(client, {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1024,
      system: "You are helpful.",
      prompt: "Say hi",
    });
    expect(result).toBe("hello world");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  test("prepends prefill to response text", async () => {
    const client = mockClient(" world");
    const result = await call(client, {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1024,
      system: "sys",
      prompt: "test",
      prefill: "hello",
    });
    expect(result).toBe("hello world");
  });

  test("passes temperature when specified", async () => {
    const client = mockClient("ok");
    await call(client, {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1024,
      system: "sys",
      prompt: "test",
      temperature: 0.5,
    });
    const createCall = (client.messages.create as ReturnType<typeof mock>).mock.calls[0];
    const params = createCall?.[0] as Record<string, unknown>;
    expect(params.temperature).toBe(0.5);
  });

  test("records usage in tracker", async () => {
    const client = mockClient("ok", { input_tokens: 150, output_tokens: 75 });
    const tracker = new UsageTracker();
    await call(client, {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1024,
      system: "sys",
      prompt: "test",
      tracker,
    });
    const summary = tracker.summarize();
    expect(summary.totalInputTokens).toBe(150);
    expect(summary.totalOutputTokens).toBe(75);
    expect(summary.llmCalls).toBe(1);
  });

  test("throws on response without text block", async () => {
    const client = mockClientEmpty();
    await expect(
      call(client, {
        model: "claude-haiku-4-5-20251001",
        maxTokens: 1024,
        system: "sys",
        prompt: "test",
      }),
    ).rejects.toThrow("No text in response");
  });
});

describe("callWithThinking", () => {
  test("returns text from thinking response", async () => {
    const client = mockClientThinking("architecture plan");
    const result = await callWithThinking(client, {
      system: "sys",
      prompt: "generate adr",
    });
    expect(result).toBe("architecture plan");
  });

  test("records usage in tracker", async () => {
    const client = mockClientThinking("plan", { input_tokens: 300, output_tokens: 200 });
    const tracker = new UsageTracker();
    await callWithThinking(client, {
      system: "sys",
      prompt: "test",
      tracker,
    });
    const summary = tracker.summarize();
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(200);
    expect(summary.llmCalls).toBe(1);
  });

  test("enables thinking with budget from STEP_CONFIG", async () => {
    const client = mockClientThinking("ok");
    await callWithThinking(client, { system: "sys", prompt: "test" });
    const createCall = (client.messages.create as ReturnType<typeof mock>).mock.calls[0];
    const params = createCall?.[0] as Record<string, unknown>;
    expect(params.thinking).toBeDefined();
    const thinking = params.thinking as { type: string; budget_tokens: number };
    expect(thinking.type).toBe("enabled");
    expect(thinking.budget_tokens).toBeGreaterThan(0);
  });

  test("throws on response without text block", async () => {
    const client = {
      messages: {
        create: mock(() =>
          Promise.resolve({
            content: [{ type: "thinking" as const, thinking: "hmm..." }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      },
    } as unknown as Parameters<typeof callWithThinking>[0];

    await expect(callWithThinking(client, { system: "sys", prompt: "test" })).rejects.toThrow(
      "No text in ADR response",
    );
  });
});
