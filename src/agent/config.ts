export const MODEL_SONNET = "claude-sonnet-4-20250514";
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";
export const MODEL_OPUS = "claude-opus-4-5-20251101";

export const MAX_ORCHESTRATOR_ITERATIONS = 12;

export const STEP_CONFIG = {
  orchestrator: {
    model: MODEL_SONNET,
    maxTokens: 4096,
  },
  dorGate: {
    model: MODEL_HAIKU,
    maxTokens: 1024,
    temperature: 0,
  },
  decomposition: {
    model: MODEL_HAIKU,
    maxTokens: 4096,
  },
  adr: {
    model: MODEL_OPUS,
    maxTokens: 16000,
    thinking: {
      budgetTokens: 10000,
    },
  },
} as const satisfies Record<string, LlmStepConfig>;

interface LlmStepConfig {
  model: string;
  maxTokens: number;
  thinking?: {
    budgetTokens: number;
  };
  temperature?: number;
}

export type StepName = keyof typeof STEP_CONFIG;
