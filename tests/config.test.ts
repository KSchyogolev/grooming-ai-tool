import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MODEL_HAIKU, MODEL_OPUS, MODEL_SONNET, STEP_CONFIG } from "../src/agent/config";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  const validEnv: Record<string, string> = {
    LINEAR_API_KEY: "lin_api_test",
    LINEAR_TEAM_KEY: "team-uuid",
    GITHUB_TOKEN: "ghp_test",
    GITHUB_REPO: "owner/repo",
    ANTHROPIC_API_KEY: "sk-ant-test",
  };

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear all relevant env vars
    for (const key of Object.keys(validEnv)) {
      delete process.env[key];
    }
    process.env.DRY_RUN = undefined;
    process.env.LINEAR_GROOMING_STATE = undefined;
  });

  afterEach(() => {
    // Restore original env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  test("loads valid config", () => {
    Object.assign(process.env, validEnv);
    const config = loadConfig();
    expect(config.linearApiKey).toBe("lin_api_test");
    expect(config.githubRepo).toBe("owner/repo");
    expect(config.dryRun).toBe(false);
  });

  test("throws on missing required vars", () => {
    // Only set some vars
    process.env.LINEAR_API_KEY = "test";
    expect(() => loadConfig()).toThrow("Missing env vars");
  });

  test("lists all missing vars in error", () => {
    try {
      loadConfig();
      expect(true).toBe(false); // Should not reach
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("LINEAR_API_KEY");
      expect(msg).toContain("GITHUB_TOKEN");
      expect(msg).toContain("ANTHROPIC_API_KEY");
    }
  });

  test("DRY_RUN=true enables dry run", () => {
    Object.assign(process.env, validEnv, { DRY_RUN: "true" });
    expect(loadConfig().dryRun).toBe(true);
  });

  test("DRY_RUN=false or unset means no dry run", () => {
    Object.assign(process.env, validEnv, { DRY_RUN: "false" });
    expect(loadConfig().dryRun).toBe(false);

    Object.assign(process.env, validEnv);
    process.env.DRY_RUN = undefined;
    expect(loadConfig().dryRun).toBe(false);
  });

  test("LINEAR_GROOMING_STATE defaults to Ready for Grooming", () => {
    Object.assign(process.env, validEnv);
    expect(loadConfig().linearGroomingState).toBe("Ready for Grooming");
  });

  test("LINEAR_GROOMING_STATE is configurable", () => {
    Object.assign(process.env, validEnv, { LINEAR_GROOMING_STATE: "Needs Grooming" });
    expect(loadConfig().linearGroomingState).toBe("Needs Grooming");
  });
});

describe("STEP_CONFIG", () => {
  test("has all pipeline steps", () => {
    const steps = Object.keys(STEP_CONFIG);
    expect(steps).toContain("orchestrator");
    expect(steps).toContain("dorGate");
    expect(steps).toContain("decomposition");
    expect(steps).toContain("adr");
    expect(steps).toHaveLength(4);
  });

  test("orchestrator uses Sonnet without thinking", () => {
    expect(STEP_CONFIG.orchestrator.model).toBe(MODEL_SONNET);
    expect(STEP_CONFIG.orchestrator.maxTokens).toBe(4096);
    expect(STEP_CONFIG.orchestrator).not.toHaveProperty("thinking");
  });

  test("dorGate uses Haiku with zero temperature", () => {
    expect(STEP_CONFIG.dorGate.model).toBe(MODEL_HAIKU);
    expect(STEP_CONFIG.dorGate.maxTokens).toBe(1024);
    expect(STEP_CONFIG.dorGate.temperature).toBe(0);
    expect(STEP_CONFIG.dorGate).not.toHaveProperty("thinking");
  });

  test("decomposition uses Haiku without thinking", () => {
    expect(STEP_CONFIG.decomposition.model).toBe(MODEL_HAIKU);
    expect(STEP_CONFIG.decomposition.maxTokens).toBe(4096);
    expect(STEP_CONFIG.decomposition).not.toHaveProperty("thinking");
  });

  test("adr uses Opus with thinking enabled", () => {
    expect(STEP_CONFIG.adr.model).toBe(MODEL_OPUS);
    expect(STEP_CONFIG.adr.maxTokens).toBe(16000);
    expect(STEP_CONFIG.adr.thinking).toBeDefined();
    expect(STEP_CONFIG.adr.thinking.budgetTokens).toBe(10000);
  });

  test("thinking budget is less than maxTokens", () => {
    expect(STEP_CONFIG.adr.thinking.budgetTokens).toBeLessThan(STEP_CONFIG.adr.maxTokens);
  });

  test("all steps have positive maxTokens", () => {
    for (const [, cfg] of Object.entries(STEP_CONFIG)) {
      expect(cfg.maxTokens).toBeGreaterThan(0);
    }
  });
});
