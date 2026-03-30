import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { resetWriter, setWriter } from "../src/logger";

beforeAll(() => setWriter(() => {}));
afterAll(() => resetWriter());

const mockPostComment = mock(() => Promise.resolve("comment-id-1"));
const mockCreatePR = mock(() =>
  Promise.resolve({
    prUrl: "https://github.com/org/repo/pull/42",
    prNumber: 42,
    authorLogin: "ai-bot",
  }),
);
const mockRequestReviewers = mock(() => Promise.resolve());

mock.module("../src/connectors/linear", () => ({
  postComment: mockPostComment,
  initLinear: mock(() => {}),
  getIssuesReadyForGrooming: mock(() => Promise.resolve([])),
  getIssueMarkers: mock(() => Promise.resolve({ hasGrooming: false, dorStatus: "none" })),
  updateIssueState: mock(() => Promise.resolve()),
  getIssueById: mock(() => Promise.resolve({})),
  getIssueByIdentifier: mock(() => Promise.resolve({})),
  getIssueIdForComment: mock(() => Promise.resolve(null)),
}));

mock.module("../src/connectors/github", () => ({
  createPR: mockCreatePR,
  requestReviewers: mockRequestReviewers,
  initGithub: mock(() => {}),
  getDefaultRepo: () => "test/repo",
  clearFileCache: mock(() => {}),
  getRepoTree: mock(() => Promise.resolve([])),
  searchCode: mock(() => Promise.resolve([])),
  readFile: mock(() => Promise.resolve({ filePath: "", content: "" })),
  getDiff: mock(() => Promise.resolve({ commits: [], hotspots: [] })),
  analyzeFile: mock(() => Promise.resolve({ dependencies: {}, complexity: {} })),
  getOwnershipMap: mock(() => Promise.resolve([])),
}));

const { runWriter } = require("../src/agent/writer") as typeof import("../src/agent/writer");

const mockIssue = {
  id: "uuid-1",
  identifier: "ENG-42",
  title: "Add caching",
  description: "Add caching layer",
  stateName: "Ready for Grooming",
  labels: [],
  priority: 2,
  url: "https://linear.app/team/ENG-42",
};

const mockPlan = {
  linearComment: "## AI Grooming Draft [AI-GROOMING]",
  prDescription: "## PR Description",
  fullDocument: "# ADR\n\n---\n\nContent",
  adrFilename: "docs/grooming/eng-42-add-caching.md",
  suggestedReviewers: ["alice", "bob"],
};

describe("runWriter", () => {
  beforeEach(() => {
    mockPostComment.mockClear();
    mockCreatePR.mockClear();
    mockRequestReviewers.mockClear();
  });

  test("posts comment and creates PR in parallel", async () => {
    const result = await runWriter(mockIssue, mockPlan);
    expect(mockPostComment).toHaveBeenCalledTimes(1);
    expect(mockPostComment).toHaveBeenCalledWith("uuid-1", mockPlan.linearComment);
    expect(mockCreatePR).toHaveBeenCalledTimes(1);
    expect(mockCreatePR).toHaveBeenCalledWith(
      "ENG-42",
      mockPlan.fullDocument,
      mockPlan.prDescription,
      mockPlan.adrFilename,
    );
    expect(result.commentId).toBe("comment-id-1");
    expect(result.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(result.prNumber).toBe(42);
  });

  test("requests reviewers excluding PR author", async () => {
    await runWriter(mockIssue, mockPlan);
    expect(mockRequestReviewers).toHaveBeenCalledTimes(1);
    expect(mockRequestReviewers).toHaveBeenCalledWith(42, ["alice", "bob"]);
  });

  test("filters out PR author from reviewers", async () => {
    mockCreatePR.mockResolvedValueOnce({
      prUrl: "https://github.com/org/repo/pull/42",
      prNumber: 42,
      authorLogin: "alice",
    });
    await runWriter(mockIssue, mockPlan);
    expect(mockRequestReviewers).toHaveBeenCalledWith(42, ["bob"]);
  });

  test("skips reviewer request when no reviewers left", async () => {
    const plan = { ...mockPlan, suggestedReviewers: [] };
    await runWriter(mockIssue, plan);
    expect(mockRequestReviewers).not.toHaveBeenCalled();
  });

  test("skips reviewer request when all reviewers are the PR author", async () => {
    mockCreatePR.mockResolvedValueOnce({
      prUrl: "https://github.com/org/repo/pull/42",
      prNumber: 42,
      authorLogin: "alice",
    });
    const plan = { ...mockPlan, suggestedReviewers: ["alice"] };
    await runWriter(mockIssue, plan);
    expect(mockRequestReviewers).not.toHaveBeenCalled();
  });
});
