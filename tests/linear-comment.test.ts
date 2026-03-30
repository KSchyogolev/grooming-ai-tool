import { describe, expect, test } from "bun:test";
import { buildLinearComment } from "../src/lib/linear-comment";
import type { SubTask } from "../src/skills/types";

const subtask: SubTask = {
  title: "Add API endpoint",
  userStory: "As a developer, I need an endpoint.",
  acceptanceCriteria: ["returns 200"],
  technicalDetails: "Express handler",
  size: "M",
  dependsOn: [],
  estimateHours: 6,
};

describe("buildLinearComment", () => {
  test("contains AI-GROOMING marker", () => {
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      [],
      "adr/plan.md",
      "ENG-1",
      "https://example.com",
    );
    expect(result).toContain("[AI-GROOMING]");
  });

  test("contains subtask table", () => {
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      [],
      "adr/plan.md",
      "ENG-1",
      "https://example.com",
    );
    expect(result).toContain("Add API endpoint");
    expect(result).toContain("`M`");
    expect(result).toContain("6h");
  });

  test("contains open questions as checkboxes", () => {
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      ["What about auth?"],
      "adr/plan.md",
      "ENG-1",
      "https://example.com",
    );
    expect(result).toContain("- [ ] What about auth?");
  });

  test("shows no-questions message when empty", () => {
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      [],
      "adr/plan.md",
      "ENG-1",
      "https://example.com",
    );
    expect(result).toContain("No blocking questions");
  });

  test("includes stats footer when provided", () => {
    const stats = {
      usage: {
        totalInputTokens: 5000,
        totalOutputTokens: 2000,
        totalTokens: 7000,
        estimatedCostUsd: 0.15,
        llmCalls: 4,
      },
      durationMs: 45000,
    };
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      [],
      "adr/plan.md",
      "ENG-1",
      "https://example.com",
      stats,
    );
    expect(result).toContain("Tokens: 7000");
    expect(result).toContain("Cost: ~$0.15");
    expect(result).toContain("Time: 45s");
  });

  test("omits stats footer when not provided", () => {
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      [],
      "adr/plan.md",
      "ENG-1",
      "https://example.com",
    );
    expect(result).not.toContain("Tokens:");
    expect(result).not.toContain("Cost:");
  });

  test("contains issue link", () => {
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      [],
      "adr/plan.md",
      "ENG-1",
      "https://linear.app/eng-1",
    );
    expect(result).toContain("[ENG-1](https://linear.app/eng-1)");
  });

  test("references ADR filename", () => {
    const result = buildLinearComment(
      [subtask],
      "M",
      6,
      [],
      "adr/eng-1-plan.md",
      "ENG-1",
      "https://example.com",
    );
    expect(result).toContain("adr/eng-1-plan.md");
  });
});
