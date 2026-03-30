import type Anthropic from "@anthropic-ai/sdk";
import { call } from "../lib/llm";
import type { UsageTracker } from "../lib/usage-tracker";
import { DOR_SYSTEM_PROMPT, buildDorComment, parseDorResult } from "../skills/dor-check";
import type { LinearIssue } from "../types";
import { STEP_CONFIG } from "./config";

export interface DorResult {
  passed: boolean;
  comment: string;
}

const EMPTY_DESCRIPTION_VERDICT = {
  passed: false,
  missing: [
    "Concrete Problem / Goal: description is missing or contains only a title",
    "Measurable Acceptance Criteria: no acceptance criteria provided",
    "Expected Behavior: expected behavior is not described",
  ],
};

const MIN_DESCRIPTION_LENGTH = 80;

export async function checkDor(
  client: Anthropic,
  issue: LinearIssue,
  tracker?: UsageTracker,
): Promise<DorResult> {
  const description = issue.description?.trim();

  if (!description || description.length < MIN_DESCRIPTION_LENGTH) {
    return { passed: false, comment: buildDorComment(issue, EMPTY_DESCRIPTION_VERDICT) };
  }

  const raw = await call(client, {
    model: STEP_CONFIG.dorGate.model,
    maxTokens: STEP_CONFIG.dorGate.maxTokens,
    temperature: STEP_CONFIG.dorGate.temperature,
    system: DOR_SYSTEM_PROMPT,
    prompt: `Task: ${issue.identifier}\nTitle: ${issue.title}\n\nDescription:\n${description}`,
    prefill: "{",
    tracker,
  });

  const verdict = parseDorResult(raw);

  if (verdict.passed) {
    return { passed: true, comment: "" };
  }

  return { passed: false, comment: buildDorComment(issue, verdict) };
}
