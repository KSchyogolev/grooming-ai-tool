import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { resetWriter, setWriter } from "../src/logger";

beforeAll(() => setWriter(() => {}));
afterAll(() => resetWriter());

const { checkDor } = require("../src/agent/dor-gate") as typeof import("../src/agent/dor-gate");

function makeClient(responseText: string) {
  return {
    messages: {
      create: mock(() =>
        Promise.resolve({
          content: [{ type: "text" as const, text: responseText }],
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
      ),
    },
  } as unknown as Anthropic;
}

const baseIssue = {
  id: "uuid-1",
  identifier: "ENG-1",
  title: "Add rate limiting",
  description:
    "Add rate limiting to POST /api/messages. Max 10 req/min per user, return 429 with Retry-After header.",
  stateName: "Ready for Grooming",
  labels: [] as string[],
  priority: 2,
  url: "https://linear.app/team/ENG-1",
};

describe("checkDor", () => {
  test("rejects short description without calling LLM", async () => {
    const client = makeClient('{"passed": true, "missing": []}');
    const issue = { ...baseIssue, description: "Fix bug" };
    const result = await checkDor(client, issue);
    expect(result.passed).toBe(false);
    expect(result.comment).toContain("[AI-DOR-CHECK]");
    expect(result.comment).toContain("description is missing");
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  test("rejects empty description without calling LLM", async () => {
    const client = makeClient('{"passed": true, "missing": []}');
    const issue = { ...baseIssue, description: "" };
    const result = await checkDor(client, issue);
    expect(result.passed).toBe(false);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  test("passes when LLM returns passed=true", async () => {
    const client = makeClient('"passed": true, "missing": []}');
    const result = await checkDor(client, baseIssue);
    expect(result.passed).toBe(true);
    expect(result.comment).toBe("");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  test("fails when LLM returns passed=false with missing items", async () => {
    const client = makeClient('"passed": false, "missing": ["Concrete Problem: too vague"]}');
    const result = await checkDor(client, baseIssue);
    expect(result.passed).toBe(false);
    expect(result.comment).toContain("[AI-DOR-CHECK]");
    expect(result.comment).toContain("too vague");
  });

  test("fails safely when LLM returns unparseable response", async () => {
    const client = makeClient("this is not json at all");
    const result = await checkDor(client, baseIssue);
    expect(result.passed).toBe(false);
    expect(result.comment).toContain("fail-safe");
  });

  test("sends prompt containing issue identifier and title", async () => {
    const client = makeClient('"passed": true, "missing": []}');
    await checkDor(client, baseIssue);
    const args = (client.messages.create as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const userMsg = args.messages.find((m) => typeof m.content === "string");
    expect(userMsg?.content).toContain("ENG-1");
    expect(userMsg?.content).toContain("Add rate limiting");
  });

  test("uses prefill to force JSON output", async () => {
    const client = makeClient('"passed": true, "missing": []}');
    await checkDor(client, baseIssue);
    const args = (client.messages.create as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const assistantMsg = args.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toBe("{");
  });
});
