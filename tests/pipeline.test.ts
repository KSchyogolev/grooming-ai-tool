import { describe, expect, test } from "bun:test";
import { buildLinearComment } from "../src/lib/linear-comment";
import { buildAdrMetadata } from "../src/skills/adr-writer";
import { buildPrDescription } from "../src/skills/pr-description";
import { parseDecomposition, rollupSize } from "../src/skills/task-decomposition";
import type { SkillContext } from "../src/skills/types";
import type { GatheredContext, GroomingPlan, LinearIssue } from "../src/types";

/**
 * Integration test: simulates the planner assembly phase end-to-end
 * using realistic mock data. No real API calls.
 */
describe("pipeline integration", () => {
  const mockIssue: LinearIssue = {
    id: "uuid-123",
    identifier: "ENG-42",
    title: "Add rate limiting to API",
    description:
      "We need to add rate limiting to our public API endpoints to prevent abuse. Consider using a sliding window algorithm.",
    stateName: "Ready for Grooming",
    labels: ["backend", "security"],
    priority: 2,
    url: "https://linear.app/team/ENG-42",
  };

  const mockContext: GatheredContext = {
    issue: mockIssue,
    relevantFiles: [
      {
        filePath: "src/api/router.ts",
        content:
          "export function createRouter() {\n  return new Router();\n}\n// handles all API routes\n".repeat(
            10,
          ),
      },
      {
        filePath: "src/middleware/auth.ts",
        content: "export function authMiddleware(req, res, next) {\n  // validate token\n}\n",
      },
    ],
    searchResults: [{ filePath: "src/api/router.ts", snippet: "createRouter()", score: 10 }],
    docs: [{ filePath: "docs/api-design.md", snippet: "rate limiting strategy", score: 5 }],
    diff: {
      commits: [
        {
          sha: "abc1234",
          message: "fix: api timeout handling",
          author: "alice",
          filesChanged: ["src/api/router.ts"],
        },
        {
          sha: "def5678",
          message: "feat: add auth middleware",
          author: "bob",
          filesChanged: ["src/middleware/auth.ts"],
        },
      ],
      hotspots: ["src/api/router.ts"],
    },
    codeAnalysis: {
      dependencies: [
        {
          filePath: "src/api/router.ts",
          imports: ["src/middleware/auth", "src/db/connection"],
          importedBy: ["src/server.ts"],
        },
      ],
      ownership: [
        {
          filePath: "src/api/router.ts",
          topAuthors: [{ name: "alice", commits: 20, percentage: 65 }],
          lastModified: "2024-01-15T10:00:00Z",
          totalCommits: 30,
        },
      ],
      complexity: [
        {
          filePath: "src/api/router.ts",
          lines: 250,
          functions: 8,
          maxIndentDepth: 4,
          longFunctions: [],
          complexity: "medium" as const,
        },
      ],
    },
  };

  // Simulate LLM output (what Haiku would return — new format with subtasks + questions)
  const mockDecompositionJson = JSON.stringify({
    subtasks: [
      {
        title: "Create rate limiter module",
        userStory:
          "As a backend developer, I want a reusable rate limiter, so that any endpoint can use it",
        acceptanceCriteria: [
          "Sliding window algorithm implemented",
          "Configurable window size and max requests",
          "Returns 429 when limit exceeded",
        ],
        technicalDetails: "Create `src/middleware/rate-limiter.ts` with `RateLimiter` class",
        size: "M",
        estimateHours: 6,
        dependsOn: [],
      },
      {
        title: "Integrate rate limiter with router",
        userStory:
          "As an API consumer, I want rate limits enforced, so that the service stays available",
        acceptanceCriteria: [
          "All /api/* routes have rate limiting",
          "Rate limit headers in response (X-RateLimit-*)",
        ],
        technicalDetails: "Modify `src/api/router.ts` — add rate limiter middleware before routes",
        size: "S",
        estimateHours: 3,
        dependsOn: ["Create rate limiter module"],
      },
      {
        title: "Add rate limit configuration",
        userStory:
          "As an ops engineer, I want configurable rate limits, so that I can tune without deploy",
        acceptanceCriteria: ["Config loaded from env vars", "Different limits per endpoint group"],
        technicalDetails: "Add env vars RATE_LIMIT_WINDOW and RATE_LIMIT_MAX to config",
        size: "XS",
        estimateHours: 1,
        dependsOn: [],
      },
    ],
    questions: [
      "Should rate limiting be per-user or per-IP?",
      "Do we need distributed rate limiting (Redis) or is in-memory enough?",
    ],
  });

  test("full assembly pipeline produces valid GroomingPlan", () => {
    // Phase 1: Parse decomposition (simulates Haiku output)
    const { subtasks: decomposition, questions } = parseDecomposition(mockDecompositionJson);
    expect(decomposition).toHaveLength(3);
    expect(questions).toHaveLength(2);

    const epicSize = rollupSize(decomposition);
    expect(epicSize).toBe("L"); // M(4) + S(2) + XS(1) = 7 → L

    const estimateHours = decomposition.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);
    expect(estimateHours).toBe(10);

    // Phase 2: Mock ADR (simulates Sonnet output)
    const mockAdr = `## Context
The API currently has no rate limiting. High-traffic endpoints like \`/api/items\` (see: src/api/router.ts:1) are vulnerable.

## Decision
**We will use Option 1: Sliding window with in-memory store**
Simple, no external dependency. Move to Redis later if needed.

## Consequences
### Positive
- Quick to implement
### Negative
- Not shared across instances
### Risks
- Medium: Memory pressure under DDoS`;

    // Phase 3: Assembly (pure functions)
    const { filename: adrFilename, heading: adrHeading } = buildAdrMetadata(
      mockIssue.identifier,
      mockIssue.title,
    );

    expect(adrFilename).toMatch(/^docs\/grooming\/eng-42-/);
    expect(adrHeading).toContain("ADR: Add rate limiting to API");

    const analyzedFiles = mockContext.relevantFiles.map((f) => f.filePath);

    const skillCtx: SkillContext = {
      issueIdentifier: mockIssue.identifier,
      issueTitle: mockIssue.title,
      issueDescription: mockIssue.description,
      issueUrl: mockIssue.url,
      relevantFiles: mockContext.relevantFiles.map((f) => ({
        filePath: f.filePath,
        snippet: f.content.slice(0, 200),
      })),
      hotspots: mockContext.diff.hotspots,
      recentCommits: mockContext.diff.commits.slice(0, 5),
      architecturePlan: mockAdr,
      decomposition,
      codeAnalysis: mockContext.codeAnalysis,
      questions,
      taskComplexity: "L",
      analyzedFiles,
      estimateHours,
    };

    const prDescription = buildPrDescription(skillCtx);
    const fullDocument = `${adrHeading}\n\n---\n\n${mockAdr}`;

    const plan: GroomingPlan = {
      linearComment: buildLinearComment(
        decomposition,
        epicSize,
        estimateHours,
        questions,
        adrFilename,
        mockContext.issue.identifier,
        mockContext.issue.url,
      ),
      prDescription,
      fullDocument,
      adrFilename,
      suggestedReviewers: [],
    };

    // Validate plan structure
    expect(plan.linearComment).toContain("[AI-GROOMING]");
    expect(plan.linearComment).toContain("ENG-42");
    expect(plan.linearComment).toContain("Create rate limiter module");
    expect(plan.linearComment).toContain(`~${epicSize}`);
    expect(plan.linearComment).toContain("10h");
    expect(plan.linearComment).toContain("per-user or per-IP");
    expect(plan.linearComment).toContain("**Complexity:** L");
    expect(plan.linearComment).toContain("**Estimate:** ~10h");

    expect(plan.prDescription).toContain("ENG-42");
    expect(plan.prDescription).toContain("rate limiting");
    expect(plan.prDescription).toContain("Sliding window");
    expect(plan.prDescription).toContain("src/api/router.ts");
    expect(plan.prDescription).toContain("Open Questions");
    expect(plan.prDescription).toContain("## Code Context");
    expect(plan.prDescription).toContain("Files analyzed");
    expect(plan.prDescription).toContain("Suggested reviewers");
    expect(plan.prDescription).toContain("**Complexity:** L");

    expect(plan.fullDocument).toContain("ADR:");
    expect(plan.fullDocument).toContain("Draft");

    expect(plan.adrFilename).toMatch(/\.md$/);
  });

  test("pipeline handles empty context gracefully", () => {
    const emptyContext: GatheredContext = {
      issue: mockIssue,
      relevantFiles: [],
      searchResults: [],
      docs: [],
      diff: { commits: [], hotspots: [] },
      codeAnalysis: { dependencies: [], ownership: [], complexity: [] },
    };

    const minimalDecomp = JSON.stringify({
      subtasks: [
        {
          title: "Investigate rate limiting options",
          userStory:
            "As a developer, I want to research options, so that we make an informed decision",
          acceptanceCriteria: ["[NEEDS INVESTIGATION] Comparison document created"],
          technicalDetails: "[NEEDS INVESTIGATION]",
          size: "S",
          estimateHours: 3,
          dependsOn: [],
        },
      ],
      questions: ["Which rate limiting strategy to use?"],
    });

    const { subtasks: decomposition, questions } = parseDecomposition(minimalDecomp);
    const epicSize = rollupSize(decomposition);
    const estimateHours = decomposition.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);

    const skillCtx: SkillContext = {
      issueIdentifier: mockIssue.identifier,
      issueTitle: mockIssue.title,
      issueDescription: mockIssue.description,
      issueUrl: mockIssue.url,
      relevantFiles: [],
      hotspots: [],
      recentCommits: [],
      architecturePlan: "[NEEDS INVESTIGATION]",
      decomposition,
      codeAnalysis: { dependencies: [], ownership: [], complexity: [] },
      questions,
      taskComplexity: "S",
      analyzedFiles: [],
      estimateHours,
    };

    const prDescription = buildPrDescription(skillCtx);
    expect(prDescription).toContain("No code analysis performed");
    expect(prDescription).toContain("ENG-42");
    expect(prDescription).toContain("[NEEDS INVESTIGATION]");
    expect(prDescription).toContain("Which rate limiting strategy");

    const linearCmt = buildLinearComment(
      decomposition,
      epicSize,
      estimateHours,
      questions,
      "docs/grooming/eng-42.md",
      emptyContext.issue.identifier,
      emptyContext.issue.url,
    );
    expect(linearCmt).toContain("[AI-GROOMING]");
    expect(linearCmt).toContain("Which rate limiting strategy");
    expect(linearCmt).toContain("**Complexity:**");
    expect(linearCmt).toContain("**Estimate:**");
  });
});
