import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import {
  handleGithubWebhook,
  handleLinearWebhook,
  verifyGithubSignature,
  verifyLinearSignature,
} from "../src/webhook";

// --- Signature verification (pure functions, no env needed) ---

describe("verifyLinearSignature", () => {
  const secret = "test-secret-123";

  function sign(body: string): string {
    return crypto.createHmac("sha256", secret).update(body).digest("hex");
  }

  test("accepts valid signature", () => {
    const body = '{"type":"Issue"}';
    expect(verifyLinearSignature(body, sign(body), secret)).toBe(true);
  });

  test("rejects wrong signature", () => {
    const wrong = "0".repeat(64);
    expect(verifyLinearSignature('{"a":1}', wrong, secret)).toBe(false);
  });

  test("rejects empty secret", () => {
    expect(verifyLinearSignature("body", "sig", "")).toBe(false);
  });

  test("rejects signature with different length", () => {
    expect(verifyLinearSignature("body", "short", secret)).toBe(false);
  });
});

describe("verifyGithubSignature", () => {
  const secret = "gh-secret-456";

  function sign(body: string): string {
    return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  }

  test("accepts valid signature", () => {
    const body = '{"action":"closed"}';
    expect(verifyGithubSignature(body, sign(body), secret)).toBe(true);
  });

  test("rejects wrong signature", () => {
    const wrongSig = `sha256=${"0".repeat(64)}`;
    expect(verifyGithubSignature('{"action":"closed"}', wrongSig, secret)).toBe(false);
  });

  test("rejects empty secret", () => {
    expect(verifyGithubSignature("body", "sig", "")).toBe(false);
  });
});

// --- Linear webhook dispatch ---
// These tests exercise the routing/filtering logic.
// We disable webhook secret verification by clearing LINEAR_WEBHOOK_SECRET.

describe("handleLinearWebhook", () => {
  let savedEnv: Record<string, string | undefined>;

  const testEnv: Record<string, string> = {
    LINEAR_API_KEY: "lin_api_test",
    LINEAR_TEAM_KEY: "TEST",
    GITHUB_TOKEN: "ghp_test",
    GITHUB_REPO: "test/repo",
    ANTHROPIC_API_KEY: "sk-ant-test",
    LINEAR_GROOMING_STATE: "Ready for Grooming",
    LINEAR_NEED_REVIEW_STATE: "Need Grooming Review",
    LINEAR_READY_FOR_DEV_STATE: "Ready for Dev",
  };

  beforeEach(() => {
    savedEnv = { ...process.env };
    Object.assign(process.env, testEnv);
    process.env.LINEAR_WEBHOOK_SECRET = undefined;
    process.env.GITHUB_WEBHOOK_SECRET = undefined;
  });

  afterEach(() => {
    for (const key of Object.keys(testEnv)) {
      delete process.env[key];
    }
    process.env.LINEAR_WEBHOOK_SECRET = undefined;
    process.env.GITHUB_WEBHOOK_SECRET = undefined;
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) process.env[key] = val;
    }
  });

  function issuePayload(override: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: "Issue",
      action: "update",
      updatedFrom: { stateId: "old-state-id" },
      data: {
        id: "uuid-1",
        identifier: "STA-1",
        title: "Test task",
        description: "Detailed description for testing",
        state: { id: "new-state-id", name: "Ready for Grooming" },
        labels: [],
        priority: 2,
        url: "https://linear.app/team/STA-1",
      },
      ...override,
    });
  }

  test("rejects invalid JSON", async () => {
    const result = await handleLinearWebhook("not-json{", null);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("Invalid JSON");
  });

  test("ignores Issue update without state change (no updatedFrom.stateId)", async () => {
    const body = issuePayload({ updatedFrom: {} });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.action).toBe("ignored");
  });

  test("ignores Issue update to wrong state", async () => {
    const body = issuePayload({
      data: {
        id: "uuid-1",
        identifier: "STA-1",
        title: "Test",
        state: { id: "s", name: "In Progress" },
        labels: [],
        priority: 2,
        url: "https://linear.app/team/STA-1",
      },
    });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("wrong state");
  });

  test("ignores non-Issue, non-Comment, non-Reaction events", async () => {
    const body = JSON.stringify({
      type: "Project",
      action: "create",
      data: { id: "x", identifier: "", title: "", priority: 0, url: "" },
    });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.action).toBe("ignored");
  });

  // --- Bot comment loop prevention ---

  test("ignores bot DOR comment (prevents infinite loop)", async () => {
    const body = JSON.stringify({
      type: "Comment",
      action: "create",
      data: {
        id: "comment-1",
        body: "## DOR Check — STA-1   [AI-DOR-CHECK]\n\nTask description is not detailed enough",
        issueId: "uuid-1",
        identifier: "",
        title: "",
        priority: 0,
        url: "",
      },
    });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("bot comment");
  });

  test("ignores bot grooming comment", async () => {
    const body = JSON.stringify({
      type: "Comment",
      action: "create",
      data: {
        id: "comment-2",
        body: "## AI Grooming Draft — STA-1   [AI-GROOMING]\n\nSubtasks...",
        issueId: "uuid-1",
        identifier: "",
        title: "",
        priority: 0,
        url: "",
      },
    });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("bot comment");
  });

  test("ignores comment without issueId", async () => {
    const body = JSON.stringify({
      type: "Comment",
      action: "create",
      data: {
        id: "comment-3",
        body: "A regular user comment",
        identifier: "",
        title: "",
        priority: 0,
        url: "",
      },
    });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("no issueId");
  });

  // --- Reaction trigger ---

  test("ignores reaction without issueId", async () => {
    const body = JSON.stringify({
      type: "Reaction",
      action: "create",
      data: {
        id: "reaction-1",
        emoji: "👍",
        comment: { id: "c-1" },
        identifier: "",
        title: "",
        priority: 0,
        url: "",
      },
    });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("no issueId on reaction");
  });

  test("ignores reaction on non-DOR comment", async () => {
    const body = JSON.stringify({
      type: "Reaction",
      action: "create",
      data: {
        id: "reaction-2",
        emoji: "👍",
        comment: { id: "c-2", body: "Just a regular comment", issueId: "uuid-1" },
        identifier: "",
        title: "",
        priority: 0,
        url: "",
      },
    });
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("reaction not on DOR comment");
  });

  // --- Signature verification integration ---

  test("rejects webhook with invalid signature when secret is set", async () => {
    process.env.LINEAR_WEBHOOK_SECRET = "my-secret";
    const body = issuePayload();
    const result = await handleLinearWebhook(body, "wrong-signature");
    expect(result.status).toBe(401);
  });

  test("rejects webhook with no signature when secret is set", async () => {
    process.env.LINEAR_WEBHOOK_SECRET = "my-secret";
    const body = issuePayload();
    const result = await handleLinearWebhook(body, null);
    expect(result.status).toBe(401);
  });
});

// --- GitHub webhook ---

describe("handleGithubWebhook", () => {
  let savedEnv: Record<string, string | undefined>;

  const testEnv: Record<string, string> = {
    LINEAR_API_KEY: "lin_api_test",
    LINEAR_TEAM_KEY: "TEST",
    GITHUB_TOKEN: "ghp_test",
    GITHUB_REPO: "test/repo",
    ANTHROPIC_API_KEY: "sk-ant-test",
  };

  beforeEach(() => {
    savedEnv = { ...process.env };
    Object.assign(process.env, testEnv);
    process.env.GITHUB_WEBHOOK_SECRET = undefined;
    process.env.LINEAR_WEBHOOK_SECRET = undefined;
  });

  afterEach(() => {
    for (const key of Object.keys(testEnv)) {
      delete process.env[key];
    }
    process.env.GITHUB_WEBHOOK_SECRET = undefined;
    process.env.LINEAR_WEBHOOK_SECRET = undefined;
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) process.env[key] = val;
    }
  });

  test("rejects invalid JSON", async () => {
    const result = await handleGithubWebhook("{broken", null);
    expect(result.status).toBe(400);
  });

  test("ignores PR opened (not closed)", async () => {
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        merged: false,
        title: "[AI Grooming] STA-42",
        number: 123,
        html_url: "https://github.com/org/repo/pull/123",
        labels: [],
        head: { ref: "ai-grooming/sta-42" },
      },
    });
    const result = await handleGithubWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("not a merge");
  });

  test("ignores PR closed without merge", async () => {
    const body = JSON.stringify({
      action: "closed",
      pull_request: {
        merged: false,
        title: "[AI Grooming] STA-42",
        number: 123,
        html_url: "https://github.com/org/repo/pull/123",
        labels: [],
        head: { ref: "ai-grooming/sta-42" },
      },
    });
    const result = await handleGithubWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("not a merge");
  });

  test("ignores merged PR without [AI Grooming] tag", async () => {
    const body = JSON.stringify({
      action: "closed",
      pull_request: {
        merged: true,
        title: "fix: some regular PR",
        number: 456,
        html_url: "https://github.com/org/repo/pull/456",
        labels: [],
        head: { ref: "fix/something" },
      },
    });
    const result = await handleGithubWebhook(body, null);
    expect(result.status).toBe(200);
    expect(result.body.reason).toBe("no [AI Grooming] tag");
  });

  test("extracts issue identifier from PR title", () => {
    const titles = [
      { input: "[AI Grooming] STA-42 — Add feature", expected: "STA-42" },
      { input: "[AI Grooming] ENG-123", expected: "ENG-123" },
      { input: "[AI Grooming]  TEAM-1 extra text", expected: "TEAM-1" },
    ];
    for (const { input, expected } of titles) {
      const match = input.match(/\[AI Grooming\]\s+(\w+-\d+)/);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe(expected);
    }
  });

  test("rejects webhook with invalid signature when secret is set", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "my-gh-secret";
    const body = JSON.stringify({
      action: "closed",
      pull_request: {
        merged: true,
        title: "[AI Grooming] STA-42",
        number: 1,
        html_url: "url",
        labels: [],
        head: { ref: "branch" },
      },
    });
    const result = await handleGithubWebhook(body, "sha256=wrong");
    expect(result.status).toBe(401);
  });
});
