import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { resetWriter, setWriter } from "../src/logger";

beforeAll(() => setWriter(() => {}));
afterAll(() => resetWriter());

type IssueMarkers = { hasGrooming: boolean; dorStatus: "none" | "pending" | "interacted" };

const mockGetIssueMarkers = mock(
  (): Promise<IssueMarkers> => Promise.resolve({ hasGrooming: false, dorStatus: "none" }),
);
const mockPostComment = mock(() => Promise.resolve("comment-id"));
const mockUpdateIssueState = mock(() => Promise.resolve());

mock.module("../src/connectors/linear", () => ({
  getIssueMarkers: mockGetIssueMarkers,
  postComment: mockPostComment,
  updateIssueState: mockUpdateIssueState,
  getIssuesReadyForGrooming: mock(() => Promise.resolve([])),
  getIssueById: mock(() => Promise.resolve({})),
  getIssueByIdentifier: mock(() => Promise.resolve({})),
  getIssueIdForComment: mock(() => Promise.resolve(null)),
  initLinear: mock(() => {}),
}));

const mockClearFileCache = mock(() => {});
mock.module("../src/connectors/github", () => ({
  clearFileCache: mockClearFileCache,
  initGithub: mock(() => {}),
  getDefaultRepo: () => "test/repo",
  getRepoTree: mock(() => Promise.resolve(["src/index.ts"])),
  searchCode: mock(() => Promise.resolve([])),
  readFile: mock(() => Promise.resolve({ filePath: "src/index.ts", content: "code" })),
  getDiff: mock(() => Promise.resolve({ commits: [], hotspots: [] })),
  analyzeFile: mock(() =>
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
  ),
  getOwnershipMap: mock(() => Promise.resolve([])),
  requestReviewers: mock(() => Promise.resolve()),
  createPR: mock(() =>
    Promise.resolve({ prUrl: "https://github.com/test/pr/1", prNumber: 1, authorLogin: "bot" }),
  ),
}));

const mockCheckDor = mock(() => Promise.resolve({ passed: true, comment: "" }));
mock.module("../src/agent/dor-gate", () => ({
  checkDor: mockCheckDor,
}));

const mockRunOrchestrator = mock(() =>
  Promise.resolve({
    issue: {
      id: "uuid-1",
      identifier: "ENG-1",
      title: "Test",
      description: "Test desc",
      stateName: "Ready for Grooming",
      labels: [],
      priority: 1,
      url: "https://linear.app/test",
    },
    relevantFiles: [],
    searchResults: [],
    docs: [],
    diff: { commits: [], hotspots: [] },
    codeAnalysis: { dependencies: [], ownership: [], complexity: [] },
  }),
);
mock.module("../src/agent/orchestrator", () => ({
  runOrchestrator: mockRunOrchestrator,
}));

const mockRunPlanner = mock(() =>
  Promise.resolve({
    linearComment: "## AI Grooming [AI-GROOMING]",
    prDescription: "PR desc",
    fullDocument: "# ADR",
    adrFilename: "docs/grooming/eng-1.md",
    suggestedReviewers: [],
  }),
);
mock.module("../src/agent/planner", () => ({
  runPlanner: mockRunPlanner,
}));

const mockRunWriter = mock(() =>
  Promise.resolve({
    commentId: "comment-1",
    prUrl: "https://github.com/test/pr/1",
    prNumber: 1,
  }),
);
mock.module("../src/agent/writer", () => ({
  runWriter: mockRunWriter,
}));

const { processIssue } = require("../src/index") as typeof import("../src/index");

const mockClient = {} as Parameters<typeof processIssue>[0];

const issue = {
  id: "uuid-1",
  identifier: "ENG-1",
  title: "Test issue",
  description: "Detailed test description for the issue that is long enough to pass DOR check",
  stateName: "Ready for Grooming",
  labels: [],
  priority: 1,
  url: "https://linear.app/test",
};

const config = {
  linearApiKey: "key",
  linearTeamId: "TEAM",
  linearGroomingState: "Ready for Grooming",
  linearNeedReviewState: "Need Grooming Review",
  linearReadyForDevState: "Ready for Dev",
  githubToken: "ghp_test",
  githubRepo: "test/repo",
  anthropicApiKey: "sk-test",
  dryRun: false,
};

describe("processIssue", () => {
  beforeEach(() => {
    mockGetIssueMarkers.mockClear();
    mockPostComment.mockClear();
    mockUpdateIssueState.mockClear();
    mockClearFileCache.mockClear();
    mockCheckDor.mockClear();
    mockRunOrchestrator.mockClear();
    mockRunPlanner.mockClear();
    mockRunWriter.mockClear();
    mockGetIssueMarkers.mockResolvedValue({ hasGrooming: false, dorStatus: "none" });
    mockCheckDor.mockResolvedValue({ passed: true, comment: "" });
  });

  test("full happy path: DOR → orchestrator → planner → writer → state update", async () => {
    await processIssue(mockClient, issue, config);

    expect(mockClearFileCache).toHaveBeenCalledTimes(1);
    expect(mockGetIssueMarkers).toHaveBeenCalledWith("uuid-1");
    expect(mockCheckDor).toHaveBeenCalledTimes(1);
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockRunPlanner).toHaveBeenCalledTimes(1);
    expect(mockRunWriter).toHaveBeenCalledTimes(1);
    expect(mockPostComment).not.toHaveBeenCalled();
    expect(mockUpdateIssueState).toHaveBeenCalledWith("uuid-1", "Need Grooming Review");
  });

  test("skips already processed issue (idempotency)", async () => {
    mockGetIssueMarkers.mockResolvedValueOnce({ hasGrooming: true, dorStatus: "none" });
    await processIssue(mockClient, issue, config);

    expect(mockCheckDor).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  test("skips when DOR is pending and no user interaction", async () => {
    mockGetIssueMarkers.mockResolvedValueOnce({ hasGrooming: false, dorStatus: "pending" });
    await processIssue(mockClient, issue, config);

    expect(mockCheckDor).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  test("stops pipeline when DOR fails and posts feedback", async () => {
    mockCheckDor.mockResolvedValueOnce({
      passed: false,
      comment: "## DOR Check [AI-DOR-CHECK]\nNot enough detail",
    });
    await processIssue(mockClient, issue, config);

    expect(mockPostComment).toHaveBeenCalledWith(
      "uuid-1",
      expect.stringContaining("[AI-DOR-CHECK]"),
    );
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockRunPlanner).not.toHaveBeenCalled();
  });

  test("DOR recheck requires 'interacted' status", async () => {
    mockGetIssueMarkers.mockResolvedValueOnce({ hasGrooming: false, dorStatus: "none" });
    await processIssue(mockClient, issue, config, "dor_recheck");

    expect(mockCheckDor).not.toHaveBeenCalled();
  });

  test("DOR recheck proceeds when dorStatus is 'interacted'", async () => {
    mockGetIssueMarkers.mockResolvedValueOnce({ hasGrooming: false, dorStatus: "interacted" });
    await processIssue(mockClient, issue, config, "dor_recheck");

    expect(mockCheckDor).toHaveBeenCalledTimes(1);
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
  });

  test("dry run prints to console instead of publishing", async () => {
    const dryConfig = { ...config, dryRun: true };
    const consoleSpy = mock(() => {});
    const origLog = console.log;
    console.log = consoleSpy;

    await processIssue(mockClient, issue, dryConfig);

    console.log = origLog;
    expect(mockRunWriter).not.toHaveBeenCalled();
    expect(mockRunPlanner).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("DOR fail in dry run prints to console instead of posting comment", async () => {
    mockCheckDor.mockResolvedValueOnce({
      passed: false,
      comment: "DOR failed content",
    });
    const dryConfig = { ...config, dryRun: true };
    const consoleSpy = mock(() => {});
    const origLog = console.log;
    console.log = consoleSpy;

    await processIssue(mockClient, issue, dryConfig);

    console.log = origLog;
    expect(mockPostComment).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
