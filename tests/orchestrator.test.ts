import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { GatheredContext, GithubFileContent, GithubSearchResult } from "../src/types";

const mockSearchCode = mock(() => Promise.resolve([] as GithubSearchResult[]));
const mockReadFile = mock(() =>
  Promise.resolve({ filePath: "src/index.ts", content: "code" } as GithubFileContent),
);
const mockGetDiff = mock(() =>
  Promise.resolve({
    commits: [] as Array<{ sha: string; message: string; author: string; filesChanged: string[] }>,
    hotspots: [] as string[],
  }),
);
const mockAnalyzeFile = mock(() =>
  Promise.resolve({
    dependencies: { filePath: "src/index.ts", imports: [], importedBy: [] },
    complexity: {
      filePath: "src/index.ts",
      lines: 10,
      functions: 1,
      maxIndentDepth: 1,
      longFunctions: [],
      complexity: "low",
    },
  }),
);
const mockGetOwnershipMap = mock(() => Promise.resolve([]));
const mockGetRepoTree = mock(() => Promise.resolve(["src/index.ts", "src/utils.ts", "README.md"]));

mock.module("../src/connectors/github", () => ({
  searchCode: mockSearchCode,
  readFile: mockReadFile,
  getDiff: mockGetDiff,
  analyzeFile: mockAnalyzeFile,
  getOwnershipMap: mockGetOwnershipMap,
  getRepoTree: mockGetRepoTree,
  clearFileCache: mock(() => {}),
  requestReviewers: mock(() => Promise.resolve()),
  createPR: mock(() =>
    Promise.resolve({ prUrl: "https://github.com/test/pr/1", prNumber: 1, authorLogin: "bot" }),
  ),
}));

process.env.GITHUB_REPO = "test/repo";

const orchestratorModule: {
  runOrchestrator: typeof import("../src/agent/orchestrator").runOrchestrator;
} = require("../src/agent/orchestrator");
const { runOrchestrator } = orchestratorModule;

const issue = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Test issue",
  description: "Test description",
  stateName: "Backlog",
  labels: [],
  priority: 1,
  url: "https://linear.app/test",
};

function makeToolUseResponse(toolCalls: Array<{ name: string; input: Record<string, unknown> }>) {
  return {
    content: toolCalls.map((tc, i) => ({
      type: "tool_use" as const,
      id: `call-${i}`,
      name: tc.name,
      input: tc.input,
    })),
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: "tool_use" as const,
  };
}

function makeEndTurnResponse(text = "Done gathering context.") {
  return {
    content: [{ type: "text" as const, text }],
    usage: { input_tokens: 50, output_tokens: 20 },
    stop_reason: "end_turn" as const,
  };
}

describe("orchestrator", () => {
  beforeEach(() => {
    mockSearchCode.mockClear();
    mockReadFile.mockClear();
    mockGetDiff.mockClear();
    mockAnalyzeFile.mockClear();
    mockGetOwnershipMap.mockClear();
    mockGetRepoTree.mockClear();
  });

  test("stops on end_turn", async () => {
    const client = {
      messages: { create: mock(() => Promise.resolve(makeEndTurnResponse())) },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.issue.identifier).toBe("ENG-1");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  test("executes tool calls and collects file results", async () => {
    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_read_file", input: { file_path: "src/index.ts" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(result.relevantFiles.length).toBe(1);
    expect(result.relevantFiles[0]?.filePath).toBe("src/index.ts");
  });

  test("deduplicates search results by filePath", async () => {
    mockSearchCode
      .mockResolvedValueOnce([
        { filePath: "src/a.ts", snippet: "first", score: 1 },
        { filePath: "src/b.ts", snippet: "second", score: 0.8 },
      ])
      .mockResolvedValueOnce([
        { filePath: "src/a.ts", snippet: "duplicate", score: 0.9 },
        { filePath: "src/c.ts", snippet: "third", score: 0.7 },
      ]);

    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_search_code", input: { query: "test" } }]),
      )
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_search_code", input: { query: "more" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.searchResults.length).toBe(3);
  });

  test("separates .md files into docs", async () => {
    mockSearchCode.mockResolvedValueOnce([
      { filePath: "README.md", snippet: "# Docs", score: 1 },
      { filePath: "src/app.ts", snippet: "code", score: 0.8 },
    ]);

    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_search_code", input: { query: "setup" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.docs.length).toBe(1);
    expect(result.docs[0]?.filePath).toBe("README.md");
    expect(result.searchResults.length).toBe(1);
    expect(result.searchResults[0]?.filePath).toBe("src/app.ts");
  });

  test("handles tool errors gracefully", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("404 Not Found"));

    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_read_file", input: { file_path: "nonexistent.ts" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.relevantFiles.length).toBe(0);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test("validates tool inputs — rejects empty query", async () => {
    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_search_code", input: { query: "" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.searchResults.length).toBe(0);
  });

  test("validates tool inputs — rejects empty file_path", async () => {
    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_read_file", input: { file_path: "" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.relevantFiles.length).toBe(0);
  });

  test("collects diff data", async () => {
    mockGetDiff.mockImplementationOnce(() =>
      Promise.resolve({
        commits: [{ sha: "abc1234", message: "fix", author: "Alice", filesChanged: ["src/a.ts"] }],
        hotspots: ["src/a.ts"],
      }),
    );

    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([{ name: "github_get_diff", input: { path_filter: "src" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.diff.hotspots).toContain("src/a.ts");
    expect(result.diff.commits.length).toBe(1);
  });

  test("collects code analysis data", async () => {
    const createMock = mock()
      .mockResolvedValueOnce(
        makeToolUseResponse([
          { name: "github_analyze_file", input: { file_path: "src/index.ts" } },
          {
            name: "github_ownership_map",
            input: { paths: ["src/index.ts"] },
          },
        ]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse());

    const client = {
      messages: { create: createMock },
    } as unknown as Parameters<typeof runOrchestrator>[0];

    const result = await runOrchestrator(client, issue);
    expect(result.codeAnalysis.dependencies.length).toBe(1);
    expect(result.codeAnalysis.complexity.length).toBe(1);
  });
});
