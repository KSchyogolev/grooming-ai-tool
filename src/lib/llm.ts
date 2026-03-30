import type Anthropic from "@anthropic-ai/sdk";
import { STEP_CONFIG } from "../agent/config";
import type { UsageTracker } from "./usage-tracker";

export async function call(
  client: Anthropic,
  opts: {
    model: string;
    maxTokens: number;
    system: string;
    prompt: string;
    prefill?: string | undefined;
    temperature?: number | undefined;
    tracker?: UsageTracker | undefined;
  },
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
  if (opts.prefill) {
    messages.push({ role: "assistant", content: opts.prefill });
  }
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages,
  };
  if (opts.temperature !== undefined) {
    params.temperature = opts.temperature;
  }
  const res = await client.messages.create(params);
  opts.tracker?.record(opts.model, {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text in response");
  const text = opts.prefill ? opts.prefill + block.text : block.text;
  return text;
}

export async function callWithThinking(
  client: Anthropic,
  opts: { system: string; prompt: string; tracker?: UsageTracker | undefined },
): Promise<string> {
  const cfg = STEP_CONFIG.adr;
  const res = await client.messages.create({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    thinking: { type: "enabled", budget_tokens: cfg.thinking.budgetTokens },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  opts.tracker?.record(cfg.model, {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text in ADR response");
  return block.text;
}
