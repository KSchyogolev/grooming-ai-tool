import { describe, expect, test } from "bun:test";
import { buildCodeAnalysisContext, buildContextString } from "../src/lib/context-formatter";
import type { GatheredContext } from "../src/types";

function makeContext(overrides?: Partial<GatheredContext>): GatheredContext {
  return {
    issue: {
      id: "id-1",
      identifier: "ENG-1",
      title: "Test",
      description: "desc",
      stateName: "Backlog",
      labels: [],
      priority: 1,
      url: "https://linear.app/test",
    },
    relevantFiles: [],
    searchResults: [],
    docs: [],
    diff: { commits: [], hotspots: [] },
    codeAnalysis: { dependencies: [], ownership: [], complexity: [] },
    ...overrides,
  };
}

describe("buildContextString", () => {
  test("includes source files truncated to 1500 chars", () => {
    const longContent = "x".repeat(3000);
    const ctx = makeContext({
      relevantFiles: [{ filePath: "src/big.ts", content: longContent }],
    });
    const result = buildContextString(ctx);
    expect(result).toContain("[SOURCE: src/big.ts]");
    expect(result.length).toBeLessThan(longContent.length);
    expect(result).not.toContain("x".repeat(2000));
  });

  test("deduplicates search results that were already read", () => {
    const ctx = makeContext({
      relevantFiles: [{ filePath: "src/a.ts", content: "code" }],
      searchResults: [
        { filePath: "src/a.ts", snippet: "dup", score: 1 },
        { filePath: "src/b.ts", snippet: "unique", score: 1 },
      ],
    });
    const result = buildContextString(ctx);
    expect(result).toContain("[SOURCE: src/a.ts]");
    expect(result).toContain("src/b.ts");
    const searchSection = result.split("[SEARCH RESULTS")[1] ?? "";
    expect(searchSection).not.toContain("src/a.ts");
  });

  test("includes docs section for .md files", () => {
    const ctx = makeContext({
      docs: [{ filePath: "README.md", snippet: "# Hello", score: 1 }],
    });
    const result = buildContextString(ctx);
    expect(result).toContain("[DOCS]");
    expect(result).toContain("README.md");
  });

  test("includes hotspots", () => {
    const ctx = makeContext({
      diff: { commits: [], hotspots: ["src/hot.ts", "src/warm.ts"] },
    });
    const result = buildContextString(ctx);
    expect(result).toContain("High-churn files");
    expect(result).toContain("src/hot.ts");
  });

  test("handles empty context", () => {
    const ctx = makeContext();
    const result = buildContextString(ctx);
    expect(result).toBe("");
  });

  test("includes module dependencies", () => {
    const ctx = makeContext({
      codeAnalysis: {
        dependencies: [{ filePath: "src/a.ts", imports: ["src/b.ts"], importedBy: ["src/c.ts"] }],
        ownership: [],
        complexity: [],
      },
    });
    const result = buildContextString(ctx);
    expect(result).toContain("MODULE DEPENDENCIES");
    expect(result).toContain("src/a.ts");
    expect(result).toContain("imports: src/b.ts");
    expect(result).toContain("imported by: src/c.ts");
  });

  test("includes ownership", () => {
    const ctx = makeContext({
      codeAnalysis: {
        dependencies: [],
        ownership: [
          {
            filePath: "src/a.ts",
            topAuthors: [{ name: "Alice", commits: 10, percentage: 80 }],
            lastModified: "2025-01-01",
            totalCommits: 12,
          },
        ],
        complexity: [],
      },
    });
    const result = buildContextString(ctx);
    expect(result).toContain("CODE OWNERSHIP");
    expect(result).toContain("Alice (80%)");
  });

  test("includes complexity analysis", () => {
    const ctx = makeContext({
      codeAnalysis: {
        dependencies: [],
        ownership: [],
        complexity: [
          {
            filePath: "src/big.ts",
            lines: 500,
            functions: 20,
            maxIndentDepth: 8,
            longFunctions: ["process (120 lines)"],
            complexity: "high",
          },
        ],
      },
    });
    const result = buildContextString(ctx);
    expect(result).toContain("COMPLEXITY ANALYSIS");
    expect(result).toContain("high complexity");
    expect(result).toContain("process (120 lines)");
  });
});

describe("buildCodeAnalysisContext", () => {
  test("renders dependencies with imports and importedBy", () => {
    const ctx = makeContext({
      codeAnalysis: {
        dependencies: [{ filePath: "src/a.ts", imports: ["src/b.ts"], importedBy: ["src/c.ts"] }],
        ownership: [],
        complexity: [],
      },
    });
    const result = buildCodeAnalysisContext(ctx);
    expect(result).toContain("MODULE DEPENDENCIES");
    expect(result).toContain("imports [src/b.ts]");
    expect(result).toContain("imported by [src/c.ts]");
  });

  test("renders ownership with authors and percentages", () => {
    const ctx = makeContext({
      codeAnalysis: {
        dependencies: [],
        ownership: [
          {
            filePath: "src/x.ts",
            topAuthors: [{ name: "Bob", commits: 5, percentage: 50 }],
            lastModified: "2025-01-01",
            totalCommits: 10,
          },
        ],
        complexity: [],
      },
    });
    const result = buildCodeAnalysisContext(ctx);
    expect(result).toContain("CODE OWNERSHIP");
    expect(result).toContain("Bob (50%, 5 commits)");
  });

  test("renders complexity with long functions", () => {
    const ctx = makeContext({
      codeAnalysis: {
        dependencies: [],
        ownership: [],
        complexity: [
          {
            filePath: "src/y.ts",
            lines: 300,
            functions: 10,
            maxIndentDepth: 6,
            longFunctions: ["handleRequest (80 lines)"],
            complexity: "medium",
          },
        ],
      },
    });
    const result = buildCodeAnalysisContext(ctx);
    expect(result).toContain("COMPLEXITY ANALYSIS");
    expect(result).toContain("medium complexity");
    expect(result).toContain("long functions: handleRequest (80 lines)");
  });

  test("returns NEEDS INVESTIGATION for empty analysis", () => {
    const ctx = makeContext();
    const result = buildCodeAnalysisContext(ctx);
    expect(result).toContain("NEEDS INVESTIGATION");
  });
});
