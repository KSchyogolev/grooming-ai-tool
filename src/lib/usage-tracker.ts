export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  llmCalls: number;
}

const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5-20251101": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

function getModelPricing(model: string): { input: number; output: number } {
  const exact = PRICING_PER_MTOK[model];
  if (exact) return exact;
  for (const [key, pricing] of Object.entries(PRICING_PER_MTOK)) {
    const prefix = key.split("-2")[0] ?? key;
    if (model.startsWith(prefix)) return pricing;
  }
  return { input: 3, output: 15 };
}

export class UsageTracker {
  private entries: Array<{ model: string; usage: TokenUsage }> = [];

  record(model: string, usage: TokenUsage): void {
    this.entries.push({ model, usage });
  }

  summarize(): UsageSummary {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let estimatedCostUsd = 0;

    for (const { model, usage } of this.entries) {
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      const pricing = getModelPricing(model);
      estimatedCostUsd +=
        (usage.inputTokens / 1_000_000) * pricing.input +
        (usage.outputTokens / 1_000_000) * pricing.output;
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
      llmCalls: this.entries.length,
    };
  }
}
