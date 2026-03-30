import { describe, expect, test } from "bun:test";
import { buildAdrMetadata } from "../src/skills/adr-writer";
import { buildPrDescription } from "../src/skills/pr-description";
import { parseDecomposition, rollupSize } from "../src/skills/task-decomposition";
import type { SkillContext, SubTask } from "../src/skills/types";

// --- parseDecomposition ---

describe("parseDecomposition", () => {
  test("parses new format with subtasks + questions", () => {
    const input = JSON.stringify({
      subtasks: [
        {
          title: "Add auth middleware",
          userStory: "As a developer, I want auth middleware, so that endpoints are secure",
          acceptanceCriteria: ["returns 401 without token"],
          technicalDetails: "Modify src/middleware.ts",
          size: "S",
          estimateHours: 3,
          dependsOn: [],
        },
      ],
      questions: ["What auth provider to use?"],
    });
    const result = parseDecomposition(input);
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]?.title).toBe("Add auth middleware");
    expect(result.subtasks[0]?.size).toBe("S");
    expect(result.subtasks[0]?.estimateHours).toBe(3);
    expect(result.questions).toEqual(["What auth provider to use?"]);
  });

  test("parses legacy JSON array format (backward compat)", () => {
    const input = JSON.stringify([
      {
        title: "Add auth middleware",
        userStory: "As a developer, I want auth middleware, so that endpoints are secure",
        acceptanceCriteria: ["returns 401 without token"],
        technicalDetails: "Modify src/middleware.ts",
        size: "S",
        dependsOn: [],
      },
    ]);
    const result = parseDecomposition(input);
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]?.title).toBe("Add auth middleware");
    expect(result.questions).toEqual([]);
  });

  test("extracts JSON object from markdown fences", () => {
    const input = `Here:\n\`\`\`json\n{"subtasks":[{"title":"Task 1","userStory":"As a user, I want X","acceptanceCriteria":[],"technicalDetails":"","size":"XS","dependsOn":[]}],"questions":["Q1"]}\n\`\`\``;
    const result = parseDecomposition(input);
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]?.title).toBe("Task 1");
    expect(result.questions).toEqual(["Q1"]);
  });

  test("throws on non-JSON input", () => {
    expect(() => parseDecomposition("not json at all")).toThrow("Decomposition not JSON");
  });

  test("throws on object without subtasks array", () => {
    expect(() => parseDecomposition('{"title":"no subtasks"}')).toThrow("missing subtasks array");
  });

  test("throws on missing title", () => {
    const input = JSON.stringify({
      subtasks: [{ userStory: "As a user", size: "S" }],
      questions: [],
    });
    expect(() => parseDecomposition(input)).toThrow("SubTask missing title");
  });

  test("throws on invalid size", () => {
    const input = JSON.stringify({
      subtasks: [{ title: "Task", userStory: "As a user", size: "HUGE", dependsOn: [] }],
      questions: [],
    });
    expect(() => parseDecomposition(input)).toThrow('Invalid size "HUGE"');
  });

  test("accepts all valid sizes", () => {
    const sizes = ["XS", "S", "M", "L", "XL"] as const;
    for (const size of sizes) {
      const input = JSON.stringify({
        subtasks: [
          { title: `Task ${size}`, userStory: "As a user, I want X", size, dependsOn: [] },
        ],
        questions: [],
      });
      const result = parseDecomposition(input);
      expect(result.subtasks[0]?.size).toBe(size);
    }
  });

  test("defaults missing optional fields", () => {
    const input = JSON.stringify({ subtasks: [{ title: "Minimal", size: "XS" }], questions: [] });
    const result = parseDecomposition(input);
    expect(result.subtasks[0]?.userStory).toBe("");
    expect(result.subtasks[0]?.acceptanceCriteria).toEqual([]);
    expect(result.subtasks[0]?.technicalDetails).toBe("");
    expect(result.subtasks[0]?.dependsOn).toEqual([]);
    expect(result.subtasks[0]?.estimateHours).toBeUndefined();
  });

  test("parses estimateHours when present", () => {
    const input = JSON.stringify({
      subtasks: [{ title: "Task", size: "M", estimateHours: 6 }],
      questions: [],
    });
    const result = parseDecomposition(input);
    expect(result.subtasks[0]?.estimateHours).toBe(6);
  });

  test("ignores invalid estimateHours (0 or negative)", () => {
    const input = JSON.stringify({
      subtasks: [{ title: "Task", size: "M", estimateHours: 0 }],
      questions: [],
    });
    const result = parseDecomposition(input);
    expect(result.subtasks[0]?.estimateHours).toBeUndefined();
  });

  test("filters non-string questions", () => {
    const input = JSON.stringify({
      subtasks: [{ title: "Task", size: "XS" }],
      questions: ["Valid?", 42, null, "Also valid?"],
    });
    const result = parseDecomposition(input);
    expect(result.questions).toEqual(["Valid?", "Also valid?"]);
  });
});

// --- rollupSize ---

describe("rollupSize", () => {
  function task(size: SubTask["size"]): SubTask {
    return {
      title: "t",
      userStory: "",
      acceptanceCriteria: [],
      technicalDetails: "",
      size,
      dependsOn: [],
    };
  }

  test("single XS = S", () => {
    expect(rollupSize([task("XS")])).toBe("S");
  });

  test("two S = M (2+2=4)", () => {
    expect(rollupSize([task("S"), task("S")])).toBe("M");
  });

  test("three M = L (4+4+4=12)", () => {
    expect(rollupSize([task("M"), task("M"), task("M")])).toBe("L");
  });

  test("two L = XL (8+8=16)", () => {
    expect(rollupSize([task("L"), task("L")])).toBe("XL");
  });

  test("two XL = XXL (16+16=32)", () => {
    expect(rollupSize([task("XL"), task("XL")])).toContain("XXL");
  });

  test("empty array = S (0 points)", () => {
    expect(rollupSize([])).toBe("S");
  });
});

// --- buildAdrMetadata ---

describe("buildAdrMetadata", () => {
  test("generates slug from title", () => {
    const result = buildAdrMetadata("ENG-123", "Add OAuth Integration");
    expect(result.filename).toMatch(/^docs\/grooming\/eng-123-add-oauth-integration\.md$/);
  });

  test("truncates long titles to 50 chars in slug", () => {
    const longTitle =
      "This is a very long title that should be truncated to fit within the slug limit";
    const result = buildAdrMetadata("ENG-1", longTitle);
    const slug = result.filename.replace("docs/grooming/eng-1-", "").replace(".md", "");
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  test("strips special characters from slug", () => {
    const result = buildAdrMetadata("ENG-5", "Fix: auth (v2) & logging!");
    expect(result.filename).toMatch(/^docs\/grooming\/eng-5-fix-auth-v2-logging\.md$/);
  });

  test("heading contains identifier and title", () => {
    const result = buildAdrMetadata("ENG-42", "My Feature");
    expect(result.heading).toContain("# ADR: My Feature");
    expect(result.heading).toContain("ENG-42");
    expect(result.heading).toContain("Status:** Draft");
  });

  test("heading contains today's date", () => {
    const today = new Date().toISOString().split("T")[0] as string;
    const result = buildAdrMetadata("ENG-1", "Test");
    expect(result.heading).toContain(today);
  });
});

// --- buildPrDescription ---

describe("buildPrDescription", () => {
  const baseCtx: SkillContext = {
    issueIdentifier: "ENG-100",
    issueTitle: "Add caching layer",
    issueDescription: "We need Redis caching for the API",
    issueUrl: "https://linear.app/team/ENG-100",
    relevantFiles: [
      {
        filePath: "src/api/handler.ts",
        snippet: "export function handle()",
      },
    ],
    hotspots: ["src/api/handler.ts"],
    recentCommits: [{ sha: "abc1234", message: "fix: api timeout", author: "Alice" }],
    architecturePlan: "## Decision\nUse Redis.",
    decomposition: [
      {
        title: "Set up Redis client",
        userStory: "As a developer, I want a Redis client, so that I can cache responses",
        acceptanceCriteria: ["Redis connects on startup", "Graceful fallback if Redis down"],
        technicalDetails: "Add redis client in src/cache.ts",
        size: "S" as const,
        estimateHours: 3,
        dependsOn: [],
      },
      {
        title: "Add cache middleware",
        userStory: "As a user, I want faster responses, so that the app feels snappy",
        acceptanceCriteria: ["GET /api/items returns cached result"],
        technicalDetails: "Wrap handler in src/api/handler.ts",
        size: "M" as const,
        estimateHours: 6,
        dependsOn: ["Set up Redis client"],
      },
    ],
    codeAnalysis: {
      dependencies: [
        {
          filePath: "src/api/handler.ts",
          imports: ["src/db/client", "src/utils/logger"],
          importedBy: ["src/api/router.ts", "src/api/v2/router.ts"],
        },
      ],
      ownership: [
        {
          filePath: "src/api/handler.ts",
          topAuthors: [
            { name: "Alice", commits: 15, percentage: 60 },
            { name: "Bob", commits: 10, percentage: 40 },
          ],
          lastModified: "2024-01-15T10:00:00Z",
          totalCommits: 25,
        },
      ],
      complexity: [
        {
          filePath: "src/api/handler.ts",
          lines: 320,
          functions: 12,
          maxIndentDepth: 6,
          longFunctions: ["processRequest (65 lines)"],
          complexity: "medium" as const,
        },
      ],
    },
    questions: ["Which Redis instance to use — managed or self-hosted?", "Cache TTL policy?"],
    taskComplexity: "M",
    analyzedFiles: ["src/api/handler.ts", "src/api/router.ts"],
    estimateHours: 9,
  };

  test("contains issue link and complexity", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("[ENG-100](https://linear.app/team/ENG-100)");
    expect(result).toContain("**Complexity:** M");
    expect(result).toContain("**Estimate:** ~9h");
  });

  test("contains open questions", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("Open Questions");
    expect(result).toContain("Which Redis instance to use");
    expect(result).toContain("Cache TTL policy?");
  });

  test("contains decomposition table with estimates", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("## Decomposition");
    expect(result).toContain("Set up Redis client");
    expect(result).toContain("Add cache middleware");
    expect(result).toContain("`S`");
    expect(result).toContain("`M`");
    expect(result).toContain("3h");
    expect(result).toContain("6h");
    expect(result).toContain("Total estimate");
  });

  test("contains architecture section", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("## Architecture");
    expect(result).toContain("Use Redis.");
  });

  test("contains code context with analyzed files", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("## Code Context");
    expect(result).toContain("Files analyzed");
    expect(result).toContain("src/api/handler.ts");
    expect(result).toContain("src/api/router.ts");
  });

  test("code context shows module dependencies", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("Module dependencies");
    expect(result).toContain("2 imports");
    expect(result).toContain("2 dependents");
  });

  test("code context shows suggested reviewers from ownership", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("Suggested reviewers");
    expect(result).toContain("**Alice**");
  });

  test("code context shows complexity notes for elevated complexity", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("Complexity notes");
    expect(result).toContain("medium");
    expect(result).toContain("320 lines");
  });

  test("code context shows high-churn files", () => {
    const result = buildPrDescription(baseCtx);
    expect(result).toContain("High-churn files");
    expect(result).toContain("src/api/handler.ts");
  });

  test("filters out hotspots not relevant to affected files", () => {
    const ctx: SkillContext = {
      ...baseCtx,
      hotspots: [
        ".cursor/rules/backend-architect.mdc",
        "unrelated/config.ts",
        "src/api/handler.ts",
      ],
    };
    const result = buildPrDescription(ctx);
    expect(result).not.toContain(".cursor/rules/backend-architect.mdc");
    expect(result).not.toContain("unrelated/config.ts");
    expect(result).toContain("src/api/handler.ts");
  });

  test("handles empty context gracefully", () => {
    const emptyCtx: SkillContext = {
      ...baseCtx,
      relevantFiles: [],
      hotspots: [],
      decomposition: [],
      questions: [],
      analyzedFiles: [],
      codeAnalysis: { dependencies: [], ownership: [], complexity: [] },
    };
    const result = buildPrDescription(emptyCtx);
    expect(result).toContain("No subtasks identified");
    expect(result).toContain("No blocking questions identified");
    expect(result).toContain("No code analysis performed");
  });
});
